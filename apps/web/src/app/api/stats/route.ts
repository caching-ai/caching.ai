import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/org";
import { wastePerInputTokenUsd, type Provider } from "@caching/shared";

const WINDOWS = [7, 30, 90];

/**
 * Dashboard analytics (selectable 7/30/90-day window, all of the user's keys).
 *
 * Hit rate  = cache_read / (input + cache_creation + cache_read)
 * Saved     = Σ(no_cache_cost - actual_cost)  [stored per request]
 * Wasted    = Σ input_tokens × price × 0.9 over requests that had NO cache
 *             read — tokens that were paid at full price but could have been
 *             served at 0.1x with a stable prefix. Estimated.
 * Latency   = end-to-end percentiles over successful non-keepalive requests.
 * Heatmap   = request counts by UTC weekday×hour; the client shifts to local time.
 */
export async function GET(req: NextRequest) {
  const ws = await getWorkspace();
  if (!ws) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const sess = ws.session;
  const pool = db();

  // workspace scope: personal keys only, or the member's own TEAM keys —
  // the org-wide view lives at /api/org/stats (admins)
  const scope = ws.org ? "k.user_id = $1 AND k.org_id = $3" : "k.user_id = $1 AND k.org_id IS NULL";
  const scopeShort = ws.org ? "k.user_id = $1 AND k.org_id = $2" : "k.user_id = $1 AND k.org_id IS NULL";
  const winParams = ws.org ? (extra: number) => [sess.uid, extra, ws.org!.orgId] : (extra: number) => [sess.uid, extra];
  const plainParams = ws.org ? [sess.uid, ws.org.orgId] : [sess.uid];

  const days = Number(req.nextUrl.searchParams.get("days") ?? 30);
  if (!WINDOWS.includes(days)) {
    return NextResponse.json({ error: "days must be 7, 30 or 90." }, { status: 400 });
  }

  const daily = await pool.query(
    `SELECT date_trunc('day', ts)::date::text AS day, provider, model,
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
      WHERE ${scope} AND ts > now() - make_interval(days => $2)
      GROUP BY 1, 2, 3 ORDER BY 1`,
    winParams(days)
  );

  // End-to-end latency percentiles: overall (model IS NULL row) + per model.
  const latency = await pool.query(
    `SELECT rl.model,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY rl.latency_ms)::int AS p50,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY rl.latency_ms)::int AS p95,
            count(*)::int AS sample
       FROM request_logs rl
       JOIN api_keys k ON k.id = rl.api_key_id
      WHERE ${scope} AND ts > now() - make_interval(days => $2)
        AND NOT rl.is_keepalive AND rl.status < 400 AND rl.latency_ms IS NOT NULL
      GROUP BY GROUPING SETS ((rl.model), ())`,
    winParams(days)
  );

  const heatmapQ = await pool.query(
    `SELECT extract(dow from ts)::int AS dow, extract(hour from ts)::int AS hour,
            count(*)::int AS requests
       FROM request_logs rl
       JOIN api_keys k ON k.id = rl.api_key_id
      WHERE ${scope} AND ts > now() - make_interval(days => $2)
        AND NOT rl.is_keepalive
      GROUP BY 1, 2`,
    winParams(days)
  );

  const recent = await pool.query(
    `SELECT rl.ts, rl.provider, rl.model, rl.status, rl.latency_ms, rl.is_stream, rl.is_keepalive,
            rl.input_tokens, rl.output_tokens, rl.cache_read_tokens, rl.cache_creation_tokens,
            rl.saved_usd::float AS saved_usd, rl.cache_breaker_detected
       FROM request_logs rl
       JOIN api_keys k ON k.id = rl.api_key_id
      WHERE ${scopeShort}
      ORDER BY rl.ts DESC LIMIT 20`,
    plainParams
  );

  const breakerWindow = await pool.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE cache_breaker_detected)::int AS breakers
       FROM (SELECT rl.cache_breaker_detected
               FROM request_logs rl JOIN api_keys k ON k.id = rl.api_key_id
              WHERE ${scopeShort} AND NOT rl.is_keepalive
              ORDER BY rl.ts DESC LIMIT 100) w`,
    plainParams
  );

  // per-day + per-model rollups, waste computed with the pricing table
  const dayMap = new Map<string, any>();
  const models = new Map<string, any>();
  let totals = {
    requests: 0, inputTokens: 0, cacheRead: 0, cacheCreation: 0,
    savedUsd: 0, wastedUsd: 0, costUsd: 0, keepaliveCost: 0, keepalivePings: 0,
  };

  for (const r of daily.rows) {
    const waste = Number(r.uncached_input) * wastePerInputTokenUsd(r.provider as Provider, r.model);

    const d = dayMap.get(r.day) ?? { day: r.day, requests: 0, saved: 0, wasted: 0, cacheRead: 0, input: 0, cacheCreation: 0, keepalivePings: 0, keepaliveCost: 0 };
    d.requests += r.requests;
    d.saved += r.saved ?? 0;
    d.wasted += waste;
    d.cacheRead += Number(r.cache_read);
    d.input += Number(r.input_tokens);
    d.cacheCreation += Number(r.cache_creation);
    d.keepalivePings += r.keepalive_pings ?? 0;
    d.keepaliveCost += r.keepalive_cost ?? 0;
    dayMap.set(r.day, d);

    const m = models.get(r.model) ?? { model: r.model, requests: 0, saved: 0, wasted: 0, cacheRead: 0, input: 0, cacheCreation: 0, output: 0, cost: 0 };
    m.requests += r.requests;
    m.saved += r.saved ?? 0;
    m.wasted += waste;
    m.cacheRead += Number(r.cache_read);
    m.input += Number(r.input_tokens);
    m.cacheCreation += Number(r.cache_creation);
    m.output += Number(r.output_tokens);
    m.cost += r.cost ?? 0;
    models.set(r.model, m);

    totals.requests += r.requests;
    totals.inputTokens += Number(r.input_tokens);
    totals.cacheRead += Number(r.cache_read);
    totals.cacheCreation += Number(r.cache_creation);
    totals.savedUsd += r.saved ?? 0;
    totals.wastedUsd += waste;
    totals.costUsd += r.cost ?? 0;
    totals.keepaliveCost += r.keepalive_cost ?? 0;
    totals.keepalivePings += r.keepalive_pings ?? 0;
  }

  const denom = totals.inputTokens + totals.cacheRead + totals.cacheCreation;
  const hitRate = denom > 0 ? totals.cacheRead / denom : 0;

  const bw = breakerWindow.rows[0];
  const breakerRate = bw.total > 0 ? bw.breakers / bw.total : 0;

  // The () grouping set yields one grand-total row even over zero input rows —
  // a null percentile means "no successful requests", not "0 ms".
  const overallLatency = latency.rows.find((r) => r.model === null && r.p50 !== null) ?? null;
  const modelLatency = new Map(latency.rows.filter((r) => r.model !== null).map((r) => [r.model, r.p50]));

  return NextResponse.json({
    windowDays: days,
    totals: { ...totals, hitRate },
    days: [...dayMap.values()].map((d) => ({
      ...d,
      hitRate: d.input + d.cacheRead + d.cacheCreation > 0
        ? d.cacheRead / (d.input + d.cacheRead + d.cacheCreation)
        : 0,
    })),
    models: [...models.values()]
      .map((m) => ({ ...m, latencyP50: modelLatency.get(m.model) ?? null }))
      .sort((a, b) => b.requests - a.requests),
    recent: recent.rows,
    latency: overallLatency
      ? { p50: overallLatency.p50, p95: overallLatency.p95, sample: overallLatency.sample }
      : null,
    heatmap: heatmapQ.rows,
    breakerWarning: bw.total >= 5 && breakerRate >= 0.3 ? { rate: breakerRate, sample: bw.total } : null,
  });
}
