// Caching.ai Enterprise Code — see ee/adaptive-cache/LICENSE (not Apache-2.0).
// Adaptive cache tuning: learn each key's real request rhythm and apply the
// cheapest cache settings automatically. Activated only when CACHING_CLOUD=1.
import type pg from "pg";
import { openaiCacheClass } from "@caching/shared";

// Economics in "prefix units" (1 = the list price of the cacheable prefix),
// mirroring apps/proxy/src/keepalive.ts and Anthropic's published multipliers:
// 5m cache writes cost 1.25x, 1h writes 2x, reads and warming pings 0.1x.
const WRITE_5M = 1.25;
const WRITE_1H = 2.0;
const READ = 0.1;
const PING = 0.1;
const TTL_5M_MS = 5 * 60_000;
const TTL_1H_MS = 60 * 60_000;
const PING_EVERY_5M_MS = 4 * 60_000;
const PING_EVERY_1H_MS = 55 * 60_000;
const GIVE_UP_5M_MS = 62.5 * 60_000;
const GIVE_UP_1H_MS = 20 * 60 * 60_000;

const MIN_SAMPLES = 20; // gaps needed before a recommendation counts
const MIN_SAVINGS = 0.1; // don't flip settings for <10% simulated savings
const LOOKBACK_DAYS = 14;
const MAX_ROWS = 2000; // most recent requests per key per analysis

export interface TtlSimulation {
  samples: number;
  medianGapMin: number;
  /** simulated cost of the key's recent traffic under each TTL, in prefix units */
  cost5m: number;
  cost1h: number;
  recommended: "5m" | "1h";
  /** how much cheaper the recommended regime is vs the other one (0..1) */
  savingsPct: number;
  confident: boolean;
}

/** pings the keep-alive engine would send to bridge a gap, capped at give-up */
function pingsForGap(gapMs: number, ttlMs: number, cadenceMs: number, giveUpMs: number): number {
  const covered = Math.min(gapMs, giveUpMs);
  if (covered <= ttlMs) return 0;
  return Math.max(1, Math.ceil((covered - cadenceMs) / cadenceMs));
}

/**
 * Replay the observed gaps between real requests under both Anthropic TTL
 * regimes and price each: cache reads when the cache survived the gap,
 * warming pings while bridging (if the key warms), a fresh write when it
 * didn't. Reads that hit in both regimes cost the same and cancel out — the
 * difference comes from write premiums and ping spend.
 */
export function simulateAnthropicTtl(gapsMs: number[], keepalive: boolean): TtlSimulation {
  let cost5m = WRITE_5M;
  let cost1h = WRITE_1H;
  for (const g of gapsMs) {
    if (keepalive) {
      if (g <= TTL_5M_MS) cost5m += READ;
      else if (g <= GIVE_UP_5M_MS) cost5m += PING * pingsForGap(g, TTL_5M_MS, PING_EVERY_5M_MS, GIVE_UP_5M_MS) + READ;
      else cost5m += PING * pingsForGap(g, TTL_5M_MS, PING_EVERY_5M_MS, GIVE_UP_5M_MS) + WRITE_5M;
      if (g <= TTL_1H_MS) cost1h += READ;
      else if (g <= GIVE_UP_1H_MS) cost1h += PING * pingsForGap(g, TTL_1H_MS, PING_EVERY_1H_MS, GIVE_UP_1H_MS) + READ;
      else cost1h += PING * pingsForGap(g, TTL_1H_MS, PING_EVERY_1H_MS, GIVE_UP_1H_MS) + WRITE_1H;
    } else {
      cost5m += g <= TTL_5M_MS ? READ : WRITE_5M;
      cost1h += g <= TTL_1H_MS ? READ : WRITE_1H;
    }
  }
  const recommended = cost1h < cost5m ? "1h" : "5m";
  const [lo, hi] = cost1h < cost5m ? [cost1h, cost5m] : [cost5m, cost1h];
  const savingsPct = hi > 0 ? (hi - lo) / hi : 0;
  const sorted = [...gapsMs].sort((a, b) => a - b);
  const medianGapMin = sorted.length
    ? Math.round(sorted[Math.floor(sorted.length / 2)] / 60_000)
    : 0;
  return {
    samples: gapsMs.length,
    medianGapMin,
    cost5m: Math.round(cost5m * 100) / 100,
    cost1h: Math.round(cost1h * 100) / 100,
    recommended,
    savingsPct: Math.round(savingsPct * 1000) / 1000,
    confident: gapsMs.length >= MIN_SAMPLES && savingsPct >= MIN_SAVINGS,
  };
}

export interface KeyRecommendation {
  anthropic?: TtlSimulation;
  /** 24h retention is free and removes the need for warming pings — recommend
   *  it as soon as the key has real OpenAI traffic */
  openaiRetention?: { samples: number; recommended: "24h" };
}

export async function recommendForKey(
  pool: pg.Pool,
  apiKeyId: number,
  keepalive: boolean
): Promise<KeyRecommendation> {
  const { rows } = await pool.query<{ provider: string; model: string; ts: Date }>(
    `SELECT provider, model, ts FROM (
       SELECT provider, model, ts FROM request_logs
        WHERE api_key_id = $1 AND is_keepalive = false AND status < 400
          AND provider IN ('anthropic', 'openai')
          AND ts > now() - interval '${LOOKBACK_DAYS} days'
        ORDER BY ts DESC LIMIT ${MAX_ROWS}
     ) recent ORDER BY ts ASC`,
    [apiKeyId]
  );
  const out: KeyRecommendation = {};

  const anthropicTs = rows.filter((r) => r.provider === "anthropic").map((r) => new Date(r.ts).getTime());
  const gaps: number[] = [];
  for (let i = 1; i < anthropicTs.length; i++) gaps.push(anthropicTs[i] - anthropicTs[i - 1]);
  if (gaps.length) out.anthropic = simulateAnthropicTtl(gaps, keepalive);

  // Only models where extended retention actually applies count — GPT-5.6+
  // live in fixed 30m windows, so a '24h' recommendation would be meaningless.
  const openaiCount = rows.filter(
    (r) => r.provider === "openai" && openaiCacheClass(r.model) === "24h"
  ).length;
  if (openaiCount >= 5) out.openaiRetention = { samples: openaiCount, recommended: "24h" };

  return out;
}

interface AutoKeyRow {
  id: number;
  anthropic_cache_ttl: "5m" | "1h";
  openai_cache_retention: "default" | "24h";
  keepalive_enabled: boolean;
}

async function recordDecision(
  pool: pg.Pool,
  apiKeyId: number,
  setting: string,
  oldValue: string,
  newValue: string,
  reason: object
): Promise<void> {
  await pool.query(
    `INSERT INTO tuning_decisions (api_key_id, setting, old_value, new_value, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [apiKeyId, setting, oldValue, newValue, JSON.stringify(reason)]
  );
}

/**
 * One pass over every key in 'auto' mode: re-derive the cheapest settings
 * from the last two weeks of traffic and apply confident changes. Every
 * change is recorded in tuning_decisions so the console can explain it.
 * Returns the number of settings changed.
 */
export async function adaptiveSweep(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query<AutoKeyRow>(
    `SELECT id, anthropic_cache_ttl, openai_cache_retention, keepalive_enabled
       FROM api_keys
      WHERE cache_tuning_mode = 'auto' AND revoked_at IS NULL`
  );
  let changed = 0;
  for (const key of rows) {
    let rec: KeyRecommendation;
    try {
      rec = await recommendForKey(pool, key.id, key.keepalive_enabled);
    } catch (e) {
      console.error(`adaptive: analysis failed for key ${key.id}:`, (e as Error).message);
      continue;
    }

    if (rec.anthropic?.confident && rec.anthropic.recommended !== key.anthropic_cache_ttl) {
      await pool.query(
        `UPDATE api_keys SET anthropic_cache_ttl = $2
          WHERE id = $1 AND cache_tuning_mode = 'auto'`,
        [key.id, rec.anthropic.recommended]
      );
      await recordDecision(
        pool, key.id, "anthropic_cache_ttl",
        key.anthropic_cache_ttl, rec.anthropic.recommended, rec.anthropic
      );
      changed++;
    }

    if (rec.openaiRetention && key.openai_cache_retention === "default") {
      await pool.query(
        `UPDATE api_keys SET openai_cache_retention = '24h'
          WHERE id = $1 AND cache_tuning_mode = 'auto'`,
        [key.id]
      );
      await recordDecision(
        pool, key.id, "openai_cache_retention",
        "default", "24h", rec.openaiRetention
      );
      changed++;
    }
  }
  return changed;
}

/** Periodic adaptive sweep; same overlap-guard pattern as the keep-alive loop. */
export function startAdaptiveLoop(pool: pg.Pool, intervalMs = 6 * 60 * 60_000): NodeJS.Timeout {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    adaptiveSweep(pool)
      .then((n) => { if (n) console.log(`adaptive sweep: ${n} setting(s) updated`); })
      .catch((e) => console.error("adaptive sweep error:", e.message))
      .finally(() => { running = false; });
  };
  // first pass shortly after boot (migrations have already run), then steady
  const first = setTimeout(run, 60_000);
  first.unref?.();
  const t = setInterval(run, intervalMs);
  t.unref?.();
  return t;
}
