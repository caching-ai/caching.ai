import type pg from "pg";
import { computeCost, decrypt, type Usage } from "@caching/shared";
import { emptyUsage, mergeUsage } from "./logic/usageTap.js";
import { upgradeCacheControlTo1h } from "./logic/cacheControl.js";
import { insertRequestLog, type CostBreakdown } from "./store.js";

// Warming pings are ANTHROPIC-ONLY, by measurement (bench run-20260718):
//   · Anthropic explicit caches provably refresh on read — S2 sparse landed
//     at 33% of direct cost, pings included. Worth doing.
//   · gpt-4o held an 88% hit rate through 6-9 min idle gaps WITHOUT pings —
//     upstream retention is long; pings only burned budget.
//   · pre-GPT-5.6 models keep the cache ~24h upstream; nothing to warm.
//   · GPT-5.6+ showed 0% cross-suffix prefix hits over 3,240 calls — a ping
//     (different suffix) cannot refresh the caller's cache there.
//   · Gemini implicit caching produced 0 hits from pings.
//   · Grok pings are unproven and burn separately-billed reasoning tokens.
//
// Economics (PRD): a cache kept warm by cheap pings beats a full rewrite as
// long as the prefix is reused within ~62.5 minutes of the last real request.
export const PING_AFTER_MS = 4 * 60 * 1000;
export const GIVE_UP_AFTER_MS = 62.5 * 60 * 1000;
// Anthropic 1h TTL: reads refresh the full hour, so one ping near the end of
// each window keeps it warm. Break-even mirrors the 5m math: 2.0x rewrite /
// 0.1x ping = 20 pings ≈ 20 hours of idle coverage.
export const PING_AFTER_1H_MS = 55 * 60 * 1000;
export const GIVE_UP_1H_MS = 20 * 60 * 60 * 1000;
// Long warm holds on a 5m-TTL key are cheaper as ONE 1h-TTL cache write (2x,
// then a 0.1x refresh per 55m window) than as 0.1x pings every 4 minutes.
// Measured (prod e2e 2026-07-18): a 1h marker on a still-warm 5m entry only
// READS it — Anthropic does not upgrade an entry's TTL on read. The upgrade
// write must therefore wait until the 5m entry has EXPIRED (cold write lands
// as a fresh 1h entry; cache gap ≤ one sweep interval), which prices the
// upgrade at a full 2x. Break-even vs the 1.5x/hour ping cadence is ~85 min —
// shorter holds stay on pings.
export const HOLD_UPGRADE_MIN_MS = 90 * 60 * 1000;
export const TTL_5M_MS = 5 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

export interface KeepaliveDeps {
  pool: pg.Pool;
  upstreamUrl: string; // Anthropic
  encryptionKey: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface Candidate {
  api_key_id: number;
  org_id: number | null;
  tenant_id: string;
  slot: string;
  prefix_sha: string | null;
  model: string;
  encrypted_prefix: string;
  encrypted_headers: string | null;
  anthropic_key_encrypted: string | null;
  upstream_gateway_url: string | null;
  keepalive_budget_usd_daily: string;
  /** per-tenant daily budget (policy row); NULL = key budget only */
  tenant_budget_usd_daily: string | null;
  anthropic_cache_ttl: "5m" | "1h";
  keepalive_hold_until: Date | null;
  /** per-slot hold (tenant hold command) — max() with the key-level hold */
  slot_hold_until: Date | null;
  last_request_at: Date;
  last_ping_at: Date | null;
  last_1h_write_at: Date | null;
  pings_today: number;
  spend_today_usd: string;
  spend_day: string;
}

interface PingResult {
  status: number;
  usage: Usage;
  cost: CostBreakdown;
}

async function pingAnthropic(
  deps: KeepaliveDeps, prefix: any, apiKey: string, doFetch: typeof fetch,
  upstreamUrl?: string | null, extraHeaders?: Record<string, string> | null
): Promise<PingResult> {
  const body: any = {
    model: prefix.model,
    max_tokens: 1,
    messages: [...(prefix.messages ?? []), { role: "user", content: "ping" }],
  };
  if (prefix.system !== undefined) body.system = prefix.system;
  if (prefix.tools !== undefined) body.tools = prefix.tools;

  // gateway pings replay the live request's custom headers (captured at
  // request time) so routing/attribution at the gateway matches the tenant
  const headers: Record<string, string> = {
    ...(extraHeaders ?? {}),
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };

  const res = await doFetch(new URL("/v1/messages", upstreamUrl ?? deps.upstreamUrl), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const usage = emptyUsage();
  try {
    mergeUsage(usage, (await res.json())?.usage);
  } catch { /* ignore */ }
  return { status: res.status, usage, cost: computeCost(prefix.model, usage) };
}

/**
 * One sweep of the keep-alive engine (Anthropic only — see header).
 * Returns the number of pings sent. Runs on an interval in the proxy
 * process; directly callable from tests with a fake clock and upstreams.
 */
export async function keepaliveSweep(deps: KeepaliveDeps): Promise<number> {
  const { pool, encryptionKey } = deps;
  const doFetch = deps.fetchImpl ?? fetch;
  const now = deps.now ? deps.now() : Date.now();

  // Effective settings come from the same policy resolution as the request
  // path (enforced org policies override key settings); org keys use the org
  // provider key and answer to the ORG's billing lock, never the member's.
  // Sub-tenant slots resolve keepalive per row, MOST SPECIFIC FIRST — the
  // per-request X-Cache-Keepalive captured on the slot (mirrors the request
  // path where a header beats the tenant policy), then the tenant policy row,
  // then the key's effective (org-policy-resolved) setting. Untagged legacy
  // rows (tenant '') have no header flag and no tenant policy — key rules.
  const { rows } = await pool.query<Candidate>(
    `SELECT ks.api_key_id, k.org_id, ks.tenant_id, ks.slot, ks.prefix_sha, ks.model,
            ks.encrypted_prefix, ks.encrypted_headers,
            ks.hold_until AS slot_hold_until,
            ks.last_request_at, ks.last_ping_at,
            ks.last_1h_write_at, ks.pings_today, ks.spend_today_usd,
            to_char(ks.spend_day, 'YYYY-MM-DD') AS spend_day,
            k.upstream_gateway_url,
            COALESCE(k.anthropic_key_encrypted,
                     CASE WHEN k.org_id IS NULL THEN ua.key_encrypted ELSE oa.key_encrypted END)
              AS anthropic_key_encrypted,
            COALESCE(CASE WHEN pm.enforce THEN pm.keepalive_budget_usd_daily END,
                     CASE WHEN pd.enforce THEN pd.keepalive_budget_usd_daily END,
                     CASE WHEN po.enforce THEN po.keepalive_budget_usd_daily END,
                     k.keepalive_budget_usd_daily) AS keepalive_budget_usd_daily,
            tp.keepalive_budget_usd_daily AS tenant_budget_usd_daily,
            COALESCE(tp.anthropic_cache_ttl,
                     CASE WHEN pm.enforce THEN pm.anthropic_cache_ttl END,
                     CASE WHEN pd.enforce THEN pd.anthropic_cache_ttl END,
                     CASE WHEN po.enforce THEN po.anthropic_cache_ttl END,
                     k.anthropic_cache_ttl) AS anthropic_cache_ttl,
            k.keepalive_hold_until
       FROM keepalive_state ks
       JOIN api_keys k ON k.id = ks.api_key_id
       JOIN users u ON u.id = k.user_id
       LEFT JOIN organizations org ON org.id = k.org_id
       LEFT JOIN user_provider_keys ua ON ua.user_id = k.user_id AND ua.provider = 'anthropic'
       LEFT JOIN org_provider_keys oa ON oa.org_id = k.org_id AND oa.provider = 'anthropic'
       LEFT JOIN org_cache_policies po ON po.org_id = k.org_id AND po.scope = 'org'
       LEFT JOIN org_cache_policies pd ON pd.org_id = k.org_id AND pd.scope = 'department'
            AND pd.department_id = u.org_department_id
       LEFT JOIN org_cache_policies pm ON pm.org_id = k.org_id AND pm.scope = 'member'
            AND pm.member_user_id = k.user_id
       LEFT JOIN key_tenant_policies tp ON tp.api_key_id = ks.api_key_id
            AND ks.tenant_id <> '' AND tp.tenant_id = ks.tenant_id
      WHERE COALESCE(ks.header_keepalive, tp.keepalive_enabled,
                     CASE WHEN pm.enforce THEN pm.keepalive_enabled END,
                     CASE WHEN pd.enforce THEN pd.keepalive_enabled END,
                     CASE WHEN po.enforce THEN po.keepalive_enabled END,
                     k.keepalive_enabled) = true
        AND ((k.org_id IS NULL AND u.billing_locked = false)
          OR (k.org_id IS NOT NULL AND org.billing_locked = false AND org.deleted_at IS NULL))
        AND k.revoked_at IS NULL
        AND ks.provider = 'anthropic'
        AND ks.encrypted_prefix IS NOT NULL
        AND ks.last_request_at IS NOT NULL`
  );

  // The daily budget belongs to the KEY (that's what the console and the
  // budget-alert email promise) — sum today's spend across the key's rows so
  // concurrent state rows can't each burn the full budget. A tenant policy
  // budget additionally caps that tenant's own slots.
  const today = new Date(now).toISOString().slice(0, 10);
  const keySpend = new Map<number, number>();
  const tenantSpend = new Map<string, number>();
  const tenantOf = (r: Candidate) => `${r.api_key_id}:${r.tenant_id}`;
  for (const row of rows) {
    const spent = row.spend_day === today ? Number(row.spend_today_usd) : 0;
    keySpend.set(row.api_key_id, (keySpend.get(row.api_key_id) ?? 0) + spent);
    if (row.tenant_id !== "") {
      tenantSpend.set(tenantOf(row), (tenantSpend.get(tenantOf(row)) ?? 0) + spent);
    }
  }

  // Shared-warming dedupe: candidates behind the same provider account with
  // the same prefix hash point at the SAME provider cache entry — one ping
  // warms it for everyone. Scope: the org (shared org provider key), or the
  // single key for tenant slots on a personal/enterprise key. Keep one
  // candidate per group: a held one if any (so warm holds survive dedupe),
  // else the most recently active.
  const chosen = new Map<string, Candidate>();
  const dropped = new Set<Candidate>();
  for (const row of rows) {
    if (!row.prefix_sha || !row.anthropic_key_encrypted) continue;
    if (row.org_id == null && row.tenant_id === "") continue; // solo key, solo slot
    const scope = row.org_id != null ? `o${row.org_id}` : `k${row.api_key_id}`;
    const groupKey = `${scope}:${row.anthropic_key_encrypted}:${row.prefix_sha}`;
    const cur = chosen.get(groupKey);
    if (!cur) {
      chosen.set(groupKey, row);
      continue;
    }
    const held = (r: Candidate) =>
      (r.keepalive_hold_until && new Date(r.keepalive_hold_until).getTime() > now) ||
      (r.slot_hold_until && new Date(r.slot_hold_until).getTime() > now);
    const better =
      (held(row) && !held(cur)) ||
      (held(row) === held(cur) &&
        new Date(row.last_request_at).getTime() > new Date(cur.last_request_at).getTime());
    if (better) {
      dropped.add(cur);
      chosen.set(groupKey, row);
    } else {
      dropped.add(row);
    }
  }

  let pinged = 0;
  for (const row of rows) {
    if (dropped.has(row)) continue;
    const lastReq = new Date(row.last_request_at).getTime();
    const sinceReq = now - lastReq;
    const holdUntil = Math.max(
      row.keepalive_hold_until ? new Date(row.keepalive_hold_until).getTime() : 0,
      row.slot_hold_until ? new Date(row.slot_hold_until).getTime() : 0
    );
    const held = holdUntil > now;

    const longTtl = row.anthropic_cache_ttl === "1h";
    const last1h = row.last_1h_write_at ? new Date(row.last_1h_write_at).getTime() : 0;
    // a 1h cache entry we wrote (or refreshed) less than an hour ago is still
    // alive — one ping per 55m window keeps it warm regardless of key TTL
    const oneHourAlive = last1h > 0 && now - last1h < ONE_HOUR_MS;
    // long hold on a 5m key: ONE 1h write instead of a 4-minute ping cadence.
    // The write only lands as a 1h entry once the old 5m entry is cold (see
    // header) — until then, stay silent and let it expire.
    const lastPing = row.last_ping_at ? new Date(row.last_ping_at).getTime() : 0;
    const cold5m = now - Math.max(lastReq, lastPing) >= TTL_5M_MS;
    const wantUpgrade =
      held && !longTtl && !oneHourAlive && cold5m && holdUntil - now >= HOLD_UPGRADE_MIN_MS;
    const holdWaitingFor5mExpiry =
      held && !longTtl && !oneHourAlive && !cold5m && holdUntil - now >= HOLD_UPGRADE_MIN_MS;

    const pingAfter = longTtl || oneHourAlive ? PING_AFTER_1H_MS : PING_AFTER_MS;
    const giveUp = longTtl ? GIVE_UP_1H_MS : GIVE_UP_AFTER_MS;

    if (holdWaitingFor5mExpiry) continue; // no 4-min cadence — the upgrade is imminent
    if (!wantUpgrade) {
      if (sinceReq < pingAfter) continue;
      // an active warm hold overrides the give-up window (budget still applies)
      if (sinceReq >= giveUp && !held) continue;
      if (now - lastPing < pingAfter) continue; // cache still warm from last ping
    }

    // daily budget guard: key-level, resets daily (UTC); a tenant policy
    // budget additionally caps that tenant's slots
    const budget = Number(row.keepalive_budget_usd_daily);
    if ((keySpend.get(row.api_key_id) ?? 0) >= budget) continue;
    const tBudget = row.tenant_budget_usd_daily == null ? null : Number(row.tenant_budget_usd_daily);
    if (tBudget != null && (tenantSpend.get(tenantOf(row)) ?? 0) >= tBudget) continue;

    if (!row.anthropic_key_encrypted) continue;

    // atomic claim: only one sweep/replica may ping this slot's window, and
    // the key-level (and tenant-level, if set) budget is re-checked against
    // the live DB so concurrent replicas can't each admit pings off a stale
    // snapshot. An upgrade ping claims on last_1h_write_at (its cadence
    // column) instead of last_ping_at. 1h-marker pings: the hold upgrade
    // itself, and refreshes of a still-alive 1h entry on a 5m key. Keys
    // already set to the 1h TTL are left untouched (their saved prefix
    // carries 1h markers from injection time).
    const use1h = !longTtl && (wantUpgrade || oneHourAlive);
    const identityClause = `AND tenant_id = $6 AND slot = $7`;
    const tenantBudgetClause = tBudget == null ? `` : `
              AND (SELECT COALESCE(sum(CASE WHEN ks3.spend_day = $4::date
                                            THEN ks3.spend_today_usd ELSE 0 END), 0)
                     FROM keepalive_state ks3
                    WHERE ks3.api_key_id = $1 AND ks3.tenant_id = $6) < $8`;
    const claimParams: unknown[] = [
      row.api_key_id, now, now - (wantUpgrade ? PING_AFTER_1H_MS : pingAfter), today, budget,
      row.tenant_id, row.slot, ...(tBudget == null ? [] : [tBudget]),
    ];
    const claim = await pool.query(
      wantUpgrade
        ? `UPDATE keepalive_state
              SET last_ping_at = to_timestamp($2 / 1000.0),
                  last_1h_write_at = to_timestamp($2 / 1000.0)
            WHERE api_key_id = $1 AND provider = 'anthropic' ${identityClause}
              AND (last_1h_write_at IS NULL OR last_1h_write_at <= to_timestamp($3 / 1000.0))
              AND (SELECT COALESCE(sum(CASE WHEN ks2.spend_day = $4::date
                                            THEN ks2.spend_today_usd ELSE 0 END), 0)
                     FROM keepalive_state ks2 WHERE ks2.api_key_id = $1) < $5${tenantBudgetClause}`
        : `UPDATE keepalive_state
              SET last_ping_at = to_timestamp($2 / 1000.0)` +
              (use1h ? `, last_1h_write_at = to_timestamp($2 / 1000.0)` : ``) + `
            WHERE api_key_id = $1 AND provider = 'anthropic' ${identityClause}
              AND (last_ping_at IS NULL OR last_ping_at <= to_timestamp($3 / 1000.0))
              AND (SELECT COALESCE(sum(CASE WHEN ks2.spend_day = $4::date
                                            THEN ks2.spend_today_usd ELSE 0 END), 0)
                     FROM keepalive_state ks2 WHERE ks2.api_key_id = $1) < $5${tenantBudgetClause}`,
      claimParams
    );
    if (!claim.rowCount) continue;

    let prefix: any;
    let providerKey: string;
    let extraHeaders: Record<string, string> | null = null;
    try {
      prefix = JSON.parse(decrypt(row.encrypted_prefix, encryptionKey));
      providerKey = decrypt(row.anthropic_key_encrypted, encryptionKey);
      if (row.encrypted_headers) {
        extraHeaders = JSON.parse(decrypt(row.encrypted_headers, encryptionKey));
      }
    } catch {
      console.error(`keepalive: decrypt failed for key ${row.api_key_id}/anthropic`);
      continue;
    }
    // upgrade/refresh pings carry 1h markers so the write (or refresh) lands
    // on the 1h TTL; plain 5m-cadence pings replay the prefix untouched
    if (use1h && !longTtl) prefix = upgradeCacheControlTo1h(prefix);

    let result: PingResult;
    try {
      result = await pingAnthropic(
        deps, prefix, providerKey, doFetch, row.upstream_gateway_url, extraHeaders);
    } catch (e) {
      console.error(`keepalive ping failed for ${row.api_key_id}/anthropic:`, (e as Error).message);
      continue;
    }

    await pool.query(
      `UPDATE keepalive_state
          SET last_ping_at = to_timestamp($2 / 1000.0),
              pings_today = CASE WHEN spend_day = $3::date THEN pings_today + 1 ELSE 1 END,
              spend_today_usd = CASE WHEN spend_day = $3::date THEN spend_today_usd + $4 ELSE $4 END,
              spend_day = $3::date
        WHERE api_key_id = $1 AND provider = 'anthropic' AND tenant_id = $5 AND slot = $6`,
      [row.api_key_id, now, today, result.cost.actualUsd, row.tenant_id, row.slot]
    );
    keySpend.set(row.api_key_id, (keySpend.get(row.api_key_id) ?? 0) + result.cost.actualUsd);
    if (row.tenant_id !== "") {
      tenantSpend.set(tenantOf(row), (tenantSpend.get(tenantOf(row)) ?? 0) + result.cost.actualUsd);
    }
    await insertRequestLog(pool, {
      apiKeyId: row.api_key_id,
      provider: "anthropic",
      model: prefix.model,
      status: result.status,
      latencyMs: 0,
      isStream: false,
      isKeepalive: true,
      usage: result.usage,
      cost: result.cost,
      prefixHashes: null,
      breakerDetected: false,
      tenantId: row.tenant_id === "" ? null : row.tenant_id,
    });
    if (result.status < 400) pinged++;
  }
  return pinged;
}

// ---------- immediate pre-warm (chat cache command) ----------
// A cache command ("keep my cache warm for 2 hours") arrives ON the very
// conversation it wants kept warm, so the proxy can make the cache real right
// away instead of waiting out the sweep's first ping window — or, worse,
// telling the user to go send a normal request first. One write now, then the
// sweep takes over the refresh cadence.
//
// Metered exactly like a warming ping: the key's daily warming budget is the
// guard, the spend lands on the same slot row, and the call shows up in the
// dashboard as a keep-alive request.

export interface PrewarmParams {
  apiKeyId: number;
  /** '' = the key's own (legacy) slot */
  tenantId: string;
  slot: string;
  /** prefix to write upstream — already carries its cache_control markers */
  prefix: any;
  /** encrypted Anthropic key (per-key or workspace default, already resolved) */
  providerKeyEncrypted: string | null;
  upstreamGatewayUrl?: string | null;
  extraHeaders?: Record<string, string> | null;
  /** effective daily warming budget for the key, USD */
  budgetUsd: number;
  /** write on the 1h TTL — a long hold is cheaper as one 1h write than as a
   *  4-minute ping stream (see HOLD_UPGRADE_MIN_MS) */
  use1h: boolean;
}

export type PrewarmResult =
  /** the cache is live upstream now; `tokens` is what the provider reports cached */
  | { status: "warmed"; tokens: number }
  /** the provider cached nothing — the prefix is under its minimum size */
  | { status: "too_small" }
  /** this slot was warmed moments ago — it is warm, no second write needed */
  | { status: "recent" }
  | { status: "budget" }
  | { status: "no_key" }
  | { status: "failed" };

// One pre-warm write per slot per minute. A chat command now spends money, so
// repeating it in a loop must not: inside the window the cache is warm anyway.
export const PREWARM_COOLDOWN_MS = 60_000;

export async function prewarmNow(
  deps: KeepaliveDeps, p: PrewarmParams
): Promise<PrewarmResult> {
  const { pool, encryptionKey } = deps;
  const doFetch = deps.fetchImpl ?? fetch;
  const now = deps.now ? deps.now() : Date.now();
  const today = new Date(now).toISOString().slice(0, 10);

  if (!p.providerKeyEncrypted) return { status: "no_key" };
  if (!p.prefix?.model) return { status: "too_small" };

  // daily budget guard, summed across the key's slots (same rule as the sweep)
  const { rows } = await pool.query<{ spent: string }>(
    `SELECT COALESCE(sum(CASE WHEN spend_day = $2::date THEN spend_today_usd ELSE 0 END), 0) AS spent
       FROM keepalive_state WHERE api_key_id = $1`,
    [p.apiKeyId, today]
  );
  if (Number(rows[0]?.spent ?? 0) >= p.budgetUsd) return { status: "budget" };

  // atomic claim on this slot's ping window: it enforces the cooldown and, at
  // the same time, keeps two concurrent commands (or replicas) from each
  // paying for the same write
  const claim = await pool.query(
    `UPDATE keepalive_state SET last_ping_at = to_timestamp($2 / 1000.0)
      WHERE api_key_id = $1 AND provider = 'anthropic' AND tenant_id = $3 AND slot = $4
        AND (last_ping_at IS NULL OR last_ping_at <= to_timestamp($5 / 1000.0))`,
    [p.apiKeyId, now, p.tenantId, p.slot, now - PREWARM_COOLDOWN_MS]
  );
  if (!claim.rowCount) return { status: "recent" };

  let providerKey: string;
  try {
    providerKey = decrypt(p.providerKeyEncrypted, encryptionKey);
  } catch {
    console.error(`prewarm: decrypt failed for key ${p.apiKeyId}`);
    return { status: "failed" };
  }

  const prefix = p.use1h ? upgradeCacheControlTo1h(p.prefix) : p.prefix;
  let result: PingResult;
  try {
    result = await pingAnthropic(
      deps, prefix, providerKey, doFetch, p.upstreamGatewayUrl, p.extraHeaders);
  } catch (e) {
    console.error(`prewarm failed for ${p.apiKeyId}/anthropic:`, (e as Error).message);
    return { status: "failed" };
  }

  const written = result.usage.cache_creation_input_tokens;
  const read = result.usage.cache_read_input_tokens;
  // A 1h marker on a still-warm 5m entry only READS it (measured — see the
  // header): claiming a 1h entry exists when it doesn't would switch the sweep
  // to the 55-minute cadence and let the cache die in five. Only a real write
  // stamps last_1h_write_at.
  const wrote1h = p.use1h && written > 0;
  await pool.query(
    `UPDATE keepalive_state
        SET last_ping_at = to_timestamp($2 / 1000.0)` +
        (wrote1h ? `, last_1h_write_at = to_timestamp($2 / 1000.0)` : ``) + `,
            pings_today = CASE WHEN spend_day = $3::date THEN pings_today + 1 ELSE 1 END,
            spend_today_usd = CASE WHEN spend_day = $3::date THEN spend_today_usd + $4 ELSE $4 END,
            spend_day = $3::date
      WHERE api_key_id = $1 AND provider = 'anthropic' AND tenant_id = $5 AND slot = $6`,
    [p.apiKeyId, now, today, result.cost.actualUsd, p.tenantId, p.slot]
  );
  await insertRequestLog(pool, {
    apiKeyId: p.apiKeyId,
    provider: "anthropic",
    model: p.prefix.model,
    status: result.status,
    latencyMs: 0,
    isStream: false,
    isKeepalive: true,
    usage: result.usage,
    cost: result.cost,
    prefixHashes: null,
    breakerDetected: false,
    tenantId: p.tenantId === "" ? null : p.tenantId,
  });

  if (result.status >= 400) return { status: "failed" };
  // nothing cached means the prefix is below the provider's minimum — say so
  // rather than promising a warm cache that doesn't exist
  if (written + read === 0) return { status: "too_small" };
  return { status: "warmed", tokens: written + read };
}

export function startKeepaliveLoop(deps: KeepaliveDeps, intervalMs = 30_000): NodeJS.Timeout {
  let running = false; // a slow sweep must not overlap the next tick
  const t = setInterval(() => {
    if (running) return;
    running = true;
    keepaliveSweep(deps)
      .catch((e) => console.error("keepalive sweep error:", e.message))
      .finally(() => { running = false; });
  }, intervalMs);
  t.unref?.();
  return t;
}
