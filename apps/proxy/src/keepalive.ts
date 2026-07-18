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
  prefix_sha: string | null;
  model: string;
  encrypted_prefix: string;
  anthropic_key_encrypted: string | null;
  keepalive_budget_usd_daily: string;
  anthropic_cache_ttl: "5m" | "1h";
  keepalive_hold_until: Date | null;
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
  deps: KeepaliveDeps, prefix: any, apiKey: string, doFetch: typeof fetch
): Promise<PingResult> {
  const body: any = {
    model: prefix.model,
    max_tokens: 1,
    messages: [...(prefix.messages ?? []), { role: "user", content: "ping" }],
  };
  if (prefix.system !== undefined) body.system = prefix.system;
  if (prefix.tools !== undefined) body.tools = prefix.tools;

  const res = await doFetch(new URL("/v1/messages", deps.upstreamUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
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
  const { rows } = await pool.query<Candidate>(
    `SELECT ks.api_key_id, k.org_id, ks.prefix_sha, ks.model, ks.encrypted_prefix,
            ks.last_request_at, ks.last_ping_at,
            ks.last_1h_write_at, ks.pings_today, ks.spend_today_usd,
            to_char(ks.spend_day, 'YYYY-MM-DD') AS spend_day,
            COALESCE(k.anthropic_key_encrypted,
                     CASE WHEN k.org_id IS NULL THEN ua.key_encrypted ELSE oa.key_encrypted END)
              AS anthropic_key_encrypted,
            COALESCE(CASE WHEN pm.enforce THEN pm.keepalive_budget_usd_daily END,
                     CASE WHEN pd.enforce THEN pd.keepalive_budget_usd_daily END,
                     CASE WHEN po.enforce THEN po.keepalive_budget_usd_daily END,
                     k.keepalive_budget_usd_daily) AS keepalive_budget_usd_daily,
            COALESCE(CASE WHEN pm.enforce THEN pm.anthropic_cache_ttl END,
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
      WHERE COALESCE(CASE WHEN pm.enforce THEN pm.keepalive_enabled END,
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
  // concurrent state rows can't each burn the full budget.
  const today = new Date(now).toISOString().slice(0, 10);
  const keySpend = new Map<number, number>();
  for (const row of rows) {
    const spent = row.spend_day === today ? Number(row.spend_today_usd) : 0;
    keySpend.set(row.api_key_id, (keySpend.get(row.api_key_id) ?? 0) + spent);
  }

  // Shared-warming dedupe: inside an org, candidates with the same provider
  // key row and the same prefix hash point at the SAME provider cache entry —
  // one ping warms it for every member. Keep one candidate per group: a held
  // one if any (so warm holds survive dedupe), else the most recently active.
  const chosen = new Map<string, Candidate>();
  const dropped = new Set<Candidate>();
  for (const row of rows) {
    if (row.org_id == null || !row.prefix_sha || !row.anthropic_key_encrypted) continue;
    const groupKey = `${row.org_id}:${row.anthropic_key_encrypted}:${row.prefix_sha}`;
    const cur = chosen.get(groupKey);
    if (!cur) {
      chosen.set(groupKey, row);
      continue;
    }
    const held = (r: Candidate) =>
      r.keepalive_hold_until && new Date(r.keepalive_hold_until).getTime() > now;
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
    const holdUntil = row.keepalive_hold_until ? new Date(row.keepalive_hold_until).getTime() : 0;
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

    // daily budget guard: key-level, resets daily (UTC)
    const budget = Number(row.keepalive_budget_usd_daily);
    if ((keySpend.get(row.api_key_id) ?? 0) >= budget) continue;

    if (!row.anthropic_key_encrypted) continue;

    // atomic claim: only one sweep/replica may ping this key's window, and
    // the key-level budget is re-checked against the live DB so concurrent
    // replicas can't each admit pings off a stale snapshot. An upgrade ping
    // claims on last_1h_write_at (its cadence column) instead of last_ping_at.
    // 1h-marker pings: the hold upgrade itself, and refreshes of a still-alive
    // 1h entry on a 5m key. Keys already set to the 1h TTL are left untouched
    // (their saved prefix carries 1h markers from injection time).
    const use1h = !longTtl && (wantUpgrade || oneHourAlive);
    const claim = await pool.query(
      wantUpgrade
        ? `UPDATE keepalive_state
              SET last_ping_at = to_timestamp($2 / 1000.0),
                  last_1h_write_at = to_timestamp($2 / 1000.0)
            WHERE api_key_id = $1 AND provider = 'anthropic'
              AND (last_1h_write_at IS NULL OR last_1h_write_at <= to_timestamp($3 / 1000.0))
              AND (SELECT COALESCE(sum(CASE WHEN ks2.spend_day = $4::date
                                            THEN ks2.spend_today_usd ELSE 0 END), 0)
                     FROM keepalive_state ks2 WHERE ks2.api_key_id = $1) < $5`
        : `UPDATE keepalive_state
              SET last_ping_at = to_timestamp($2 / 1000.0)` +
              (use1h ? `, last_1h_write_at = to_timestamp($2 / 1000.0)` : ``) + `
            WHERE api_key_id = $1 AND provider = 'anthropic'
              AND (last_ping_at IS NULL OR last_ping_at <= to_timestamp($3 / 1000.0))
              AND (SELECT COALESCE(sum(CASE WHEN ks2.spend_day = $4::date
                                            THEN ks2.spend_today_usd ELSE 0 END), 0)
                     FROM keepalive_state ks2 WHERE ks2.api_key_id = $1) < $5`,
      [row.api_key_id, now, now - (wantUpgrade ? PING_AFTER_1H_MS : pingAfter), today, budget]
    );
    if (!claim.rowCount) continue;

    let prefix: any;
    let providerKey: string;
    try {
      prefix = JSON.parse(decrypt(row.encrypted_prefix, encryptionKey));
      providerKey = decrypt(row.anthropic_key_encrypted, encryptionKey);
    } catch {
      console.error(`keepalive: decrypt failed for key ${row.api_key_id}/anthropic`);
      continue;
    }
    // upgrade/refresh pings carry 1h markers so the write (or refresh) lands
    // on the 1h TTL; plain 5m-cadence pings replay the prefix untouched
    if (use1h && !longTtl) prefix = upgradeCacheControlTo1h(prefix);

    let result: PingResult;
    try {
      result = await pingAnthropic(deps, prefix, providerKey, doFetch);
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
        WHERE api_key_id = $1 AND provider = 'anthropic'`,
      [row.api_key_id, now, today, result.cost.actualUsd]
    );
    keySpend.set(row.api_key_id, (keySpend.get(row.api_key_id) ?? 0) + result.cost.actualUsd);
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
    });
    if (result.status < 400) pinged++;
  }
  return pinged;
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
