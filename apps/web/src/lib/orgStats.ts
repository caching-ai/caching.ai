import { db } from "@/lib/db";
import { wastePerInputTokenUsd, type Provider } from "@caching/shared";

// One source of truth for team analytics: the dashboard API, the xlsx export
// and the PDF report all consume this aggregate.

export const STAT_WINDOWS = [7, 30, 90];

export interface OrgStats {
  windowDays: number;
  totals: {
    requests: number; inputTokens: number; cacheRead: number; cacheCreation: number;
    savedUsd: number; wastedUsd: number; costUsd: number; keepaliveCost: number;
    keepalivePings: number; breakers: number; hitRate: number;
    sharedSavedUsd: number; sharedHits: number;
  };
  days: any[];
  departments: any[];
  members: any[];
  models: any[];
  recent: any[];
  opportunities: any[];
  tuning: any[];
}

export async function computeOrgStats(orgId: number, days: number): Promise<OrgStats> {
  const pool = db();

  const daily = await pool.query(
    `SELECT date_trunc('day', ts)::date::text AS day, provider, model,
            k.user_id, u.org_department_id AS department_id,
            count(*)::int AS requests,
            sum(input_tokens)::bigint AS input_tokens,
            sum(output_tokens)::bigint AS output_tokens,
            sum(cache_read_tokens)::bigint AS cache_read,
            sum(cache_creation_tokens)::bigint AS cache_creation,
            sum(cost_usd)::float AS cost,
            sum(saved_usd)::float AS saved,
            sum(CASE WHEN cache_read_tokens=0 AND NOT is_keepalive THEN input_tokens ELSE 0 END)::bigint AS uncached_input,
            count(*) FILTER (WHERE cache_breaker_detected)::int AS breakers,
            sum(cost_usd) FILTER (WHERE is_keepalive)::float AS keepalive_cost,
            count(*) FILTER (WHERE is_keepalive)::int AS keepalive_pings
       FROM request_logs rl
       JOIN api_keys k ON k.id = rl.api_key_id
       JOIN users u ON u.id = k.user_id
      WHERE k.org_id = $1 AND ts > now() - make_interval(days => $2)
      GROUP BY 1, 2, 3, 4, 5 ORDER BY 1`,
    [orgId, days]
  );

  const memberEmails = await pool.query(
    `SELECT u.id, u.email, u.org_department_id AS department_id, d.name AS department_name
       FROM users u LEFT JOIN org_departments d ON d.id = u.org_department_id
      WHERE u.org_id = $1`,
    [orgId]
  );
  const emailOf = new Map<number, { email: string; deptId: number | null; deptName: string | null }>(
    memberEmails.rows.map((m) => [m.id, { email: m.email, deptId: m.department_id, deptName: m.department_name }])
  );

  // shared-cache effect: reads whose prefix head was last written by ANOTHER
  // member — grouped by the member who benefited
  const shared = await pool.query(
    `WITH org_rows AS (
       SELECT rl.id, rl.ts, k.user_id, rl.saved_usd, rl.cache_read_tokens,
              rl.prefix_block_hashes->0->>'hash' AS head
         FROM request_logs rl
         JOIN api_keys k ON k.id = rl.api_key_id
        WHERE k.org_id = $1 AND rl.ts > now() - make_interval(days => $2)
          AND rl.prefix_block_hashes IS NOT NULL AND NOT rl.is_keepalive
     )
     SELECT w.user_id, COALESCE(sum(w.saved_usd), 0)::float AS shared_saved,
            count(*)::int AS shared_hits
       FROM (
         SELECT r.saved_usd, r.user_id, r.cache_read_tokens,
                lag(r.user_id) OVER (PARTITION BY r.head ORDER BY r.ts, r.id) AS prev_user
           FROM org_rows r
       ) w
      WHERE w.cache_read_tokens > 0 AND w.prev_user IS NOT NULL AND w.prev_user <> w.user_id
      GROUP BY w.user_id`,
    [orgId, days]
  );
  const sharedByMember = new Map<number, { saved: number; hits: number }>(
    shared.rows.map((s) => [s.user_id, { saved: s.shared_saved, hits: s.shared_hits }])
  );
  const sharedTotal = shared.rows.reduce((a, s) => a + s.shared_saved, 0);
  const sharedHits = shared.rows.reduce((a, s) => a + s.shared_hits, 0);

  const recent = await pool.query(
    `SELECT rl.ts, rl.provider, rl.model, rl.status, rl.latency_ms, rl.is_keepalive,
            rl.input_tokens, rl.output_tokens, rl.cache_read_tokens, rl.cache_creation_tokens,
            rl.saved_usd::float AS saved_usd, rl.cache_breaker_detected, k.user_id
       FROM request_logs rl
       JOIN api_keys k ON k.id = rl.api_key_id
      WHERE k.org_id = $1
      ORDER BY rl.ts DESC LIMIT 20`,
    [orgId]
  );

  // ---- opportunity diagnosis ----
  const oppKeys = await pool.query(
    `SELECT k.id, k.name, k.user_id, k.auto_cache_control, k.keepalive_enabled,
            count(rl.id) FILTER (WHERE NOT rl.is_keepalive)::int AS requests,
            COALESCE(sum(CASE WHEN rl.cache_read_tokens=0 AND NOT rl.is_keepalive THEN rl.input_tokens ELSE 0 END), 0)::bigint AS uncached_input,
            count(rl.id) FILTER (WHERE rl.cache_breaker_detected)::int AS breakers,
            (array_agg(rl.provider ORDER BY rl.ts DESC))[1] AS last_provider,
            (array_agg(rl.model ORDER BY rl.ts DESC))[1] AS last_model
       FROM api_keys k
       LEFT JOIN request_logs rl ON rl.api_key_id = k.id AND rl.ts > now() - make_interval(days => $2)
      WHERE k.org_id = $1 AND k.revoked_at IS NULL
      GROUP BY k.id, k.name, k.user_id, k.auto_cache_control, k.keepalive_enabled`,
    [orgId, days]
  );
  const opportunities: any[] = [];
  for (const k of oppKeys.rows) {
    if (k.requests < 20) continue;
    const waste =
      Number(k.uncached_input) *
      wastePerInputTokenUsd((k.last_provider ?? "anthropic") as Provider, k.last_model ?? "");
    const who = emailOf.get(k.user_id)?.email ?? "";
    if (!k.auto_cache_control && waste >= 0.5) {
      opportunities.push({ kind: "injection_off", key: k.name, member: who, wastedUsd: waste });
    }
    if (k.auto_cache_control && !k.keepalive_enabled && waste >= 1 &&
        (k.last_provider ?? "anthropic") === "anthropic") {
      opportunities.push({ kind: "warming_off", key: k.name, member: who, wastedUsd: waste });
    }
    if (k.requests >= 20 && k.breakers / k.requests >= 0.3) {
      opportunities.push({ kind: "breaker", key: k.name, member: who, rate: k.breakers / k.requests });
    }
  }
  const tuning = await pool.query(
    `SELECT k.name AS key_name, td.setting, td.old_value, td.new_value, td.created_at
       FROM tuning_decisions td JOIN api_keys k ON k.id = td.api_key_id
      WHERE k.org_id = $1 AND td.created_at > now() - make_interval(days => $2)
      ORDER BY td.created_at DESC LIMIT 10`,
    [orgId, days]
  );

  // ---- aggregation ----
  const dayMap = new Map<string, any>();
  const models = new Map<string, any>();
  const depts = new Map<string, any>();
  const members = new Map<number, any>();
  const totals = {
    requests: 0, inputTokens: 0, cacheRead: 0, cacheCreation: 0,
    savedUsd: 0, wastedUsd: 0, costUsd: 0, keepaliveCost: 0, keepalivePings: 0, breakers: 0,
  };

  for (const row of daily.rows) {
    const waste = Number(row.uncached_input) * wastePerInputTokenUsd(row.provider as Provider, row.model);
    const bump = (m: any) => {
      m.requests += row.requests;
      m.saved += row.saved ?? 0;
      m.wasted += waste;
      m.cost += row.cost ?? 0;
      m.cacheRead += Number(row.cache_read);
      m.input += Number(row.input_tokens);
      m.cacheCreation += Number(row.cache_creation);
      m.breakers += row.breakers ?? 0;
      m.keepalivePings += row.keepalive_pings ?? 0;
      m.keepaliveCost += row.keepalive_cost ?? 0;
      return m;
    };
    const blank = () => ({
      requests: 0, saved: 0, wasted: 0, cost: 0, cacheRead: 0, input: 0,
      cacheCreation: 0, breakers: 0, keepalivePings: 0, keepaliveCost: 0,
    });

    dayMap.set(row.day, bump(dayMap.get(row.day) ?? { day: row.day, ...blank() }));
    models.set(row.model, bump(models.get(row.model) ?? { model: row.model, ...blank() }));
    const deptName = row.department_id != null
      ? (emailOf.get(row.user_id)?.deptName ?? "?") : null;
    const deptKey = deptName ?? "__none__";
    depts.set(deptKey, bump(depts.get(deptKey) ?? { department: deptName, ...blank() }));
    members.set(row.user_id, bump(members.get(row.user_id) ?? {
      userId: row.user_id,
      email: emailOf.get(row.user_id)?.email ?? "(removed)",
      department: emailOf.get(row.user_id)?.deptName ?? null,
      ...blank(),
    }));

    totals.requests += row.requests;
    totals.inputTokens += Number(row.input_tokens);
    totals.cacheRead += Number(row.cache_read);
    totals.cacheCreation += Number(row.cache_creation);
    totals.savedUsd += row.saved ?? 0;
    totals.wastedUsd += waste;
    totals.costUsd += row.cost ?? 0;
    totals.keepaliveCost += row.keepalive_cost ?? 0;
    totals.keepalivePings += row.keepalive_pings ?? 0;
    totals.breakers += row.breakers ?? 0;
  }

  const hitRate = (m: { input: number; cacheRead: number; cacheCreation: number }) => {
    const d = m.input + m.cacheRead + m.cacheCreation;
    return d > 0 ? m.cacheRead / d : 0;
  };
  const denom = totals.inputTokens + totals.cacheRead + totals.cacheCreation;

  return {
    windowDays: days,
    totals: {
      ...totals,
      hitRate: denom > 0 ? totals.cacheRead / denom : 0,
      sharedSavedUsd: sharedTotal,
      sharedHits,
    },
    days: [...dayMap.values()].map((d) => ({ ...d, hitRate: hitRate(d) })),
    departments: [...depts.values()]
      .map((d) => ({ ...d, hitRate: hitRate(d) }))
      .sort((a, b) => b.cost - a.cost),
    members: [...members.values()]
      .map((m) => ({
        ...m,
        hitRate: hitRate(m),
        sharedSavedUsd: sharedByMember.get(m.userId)?.saved ?? 0,
        sharedHits: sharedByMember.get(m.userId)?.hits ?? 0,
      }))
      .sort((a, b) => b.cost - a.cost),
    models: [...models.values()].map((m) => ({ ...m, hitRate: hitRate(m) }))
      .sort((a, b) => b.requests - a.requests),
    recent: recent.rows.map((row) => ({ ...row, member: emailOf.get(row.user_id)?.email ?? "" })),
    opportunities: opportunities.sort((a, b) => (b.wastedUsd ?? 0) - (a.wastedUsd ?? 0)).slice(0, 12),
    tuning: tuning.rows,
  };
}
