import type pg from "pg";

// Daily rollup + retention for request_logs. Every complete UTC day is
// aggregated into request_logs_daily, then raw rows older than the retention
// window are pruned in small batches so the hot table never grows unbounded.
//
// Idempotency & the midnight edge: the watermark day itself is re-rolled on
// every sweep (>= wm, not > wm) — a fire-and-forget insert that stamped ts
// just before midnight but committed after the first post-midnight sweep is
// picked up by the next one; ON CONFLICT fully replaces the day's aggregates.
//
// Retention floors at 90 days (unless 0 = never prune): the console reads a
// 90-day raw window, and the billing sweep recomputes OPEN months from raw
// rows — pruning inside those windows would silently corrupt both.
// LOG_RETENTION_DAYS=0 disables pruning (rollup still runs).

const DEFAULT_RETENTION_DAYS = 100;
const MIN_RETENTION_DAYS = 90;
const PRUNE_BATCH = 10_000;
const PRUNE_BATCH_PAUSE_MS = 100; // let customer traffic breathe between batches

export interface RollupResult {
  rowsRolled: number;
  rowsPruned: number;
}

export function retentionDaysFromEnv(): number {
  const raw = process.env.LOG_RETENTION_DAYS;
  if (raw == null || raw.trim() === "") return DEFAULT_RETENTION_DAYS;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0) return DEFAULT_RETENTION_DAYS;
  if (v === 0) return 0; // explicit opt-out: keep raw logs forever
  if (v < MIN_RETENTION_DAYS) {
    console.warn(
      `LOG_RETENTION_DAYS=${raw} is below the ${MIN_RETENTION_DAYS}-day floor ` +
        `(console 90-day window + open-month billing recompute read raw logs) — using ${MIN_RETENTION_DAYS}`
    );
    return MIN_RETENTION_DAYS;
  }
  return Math.floor(v);
}

/** midnight UTC of the current day — the "complete days" cutoff, computed
 *  once in JS so the rollup and the prune agree on the exact boundary */
function utcDayStart(now: Date): string {
  return now.toISOString().slice(0, 10) + "T00:00:00.000Z";
}

export async function rollupSweep(
  pool: pg.Pool,
  retentionDays = retentionDaysFromEnv(),
  now: () => Date = () => new Date()
): Promise<RollupResult> {
  const cutoff = utcDayStart(now());

  // 1) Aggregate complete UTC days from the watermark day (inclusive — see
  //    header). Both bounds are plain timestamptz comparisons so
  //    idx_request_logs_ts serves them; the no-op hourly runs touch ~0 rows.
  const rolled = await pool.query(
    `WITH wm AS (SELECT COALESCE(max(day), '1970-01-01'::date) AS d FROM request_logs_daily)
     INSERT INTO request_logs_daily
       (day, api_key_id, provider, model, requests, errors, keepalive_pings,
        input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
        uncached_input_tokens, cost_usd, saved_usd, keepalive_cost_usd, breakers,
        latency_ms_sum, latency_samples)
     SELECT (ts AT TIME ZONE 'UTC')::date, api_key_id, provider, model,
            count(*) FILTER (WHERE NOT is_keepalive),
            count(*) FILTER (WHERE NOT is_keepalive AND status >= 400),
            count(*) FILTER (WHERE is_keepalive),
            COALESCE(sum(input_tokens), 0),
            COALESCE(sum(output_tokens), 0),
            COALESCE(sum(cache_creation_tokens), 0),
            COALESCE(sum(cache_read_tokens), 0),
            COALESCE(sum(input_tokens) FILTER (WHERE cache_read_tokens = 0 AND NOT is_keepalive), 0),
            COALESCE(sum(cost_usd), 0),
            COALESCE(sum(saved_usd), 0),
            COALESCE(sum(cost_usd) FILTER (WHERE is_keepalive), 0),
            count(*) FILTER (WHERE cache_breaker_detected),
            COALESCE(sum(latency_ms) FILTER (WHERE NOT is_keepalive AND status < 400), 0),
            count(*) FILTER (WHERE NOT is_keepalive AND status < 400)
       FROM request_logs, wm
      WHERE ts < $1::timestamptz
        AND ts >= (wm.d::timestamp AT TIME ZONE 'UTC')
      GROUP BY 1, 2, 3, 4
     ON CONFLICT (day, api_key_id, provider, model) DO UPDATE SET
        requests = EXCLUDED.requests, errors = EXCLUDED.errors,
        keepalive_pings = EXCLUDED.keepalive_pings,
        input_tokens = EXCLUDED.input_tokens, output_tokens = EXCLUDED.output_tokens,
        cache_creation_tokens = EXCLUDED.cache_creation_tokens,
        cache_read_tokens = EXCLUDED.cache_read_tokens,
        uncached_input_tokens = EXCLUDED.uncached_input_tokens,
        cost_usd = EXCLUDED.cost_usd, saved_usd = EXCLUDED.saved_usd,
        keepalive_cost_usd = EXCLUDED.keepalive_cost_usd, breakers = EXCLUDED.breakers,
        latency_ms_sum = EXCLUDED.latency_ms_sum, latency_samples = EXCLUDED.latency_samples`,
    [cutoff]
  );

  // 2) Prune raw rows past retention — every pruned day is older than the
  //    cutoff, so step 1 (and many earlier sweeps) already aggregated it.
  let rowsPruned = 0;
  if (retentionDays >= 1) {
    for (;;) {
      const del = await pool.query(
        `DELETE FROM request_logs WHERE id IN (
           SELECT id FROM request_logs
            WHERE ts < $1::timestamptz - make_interval(days => $2)
            LIMIT ${PRUNE_BATCH})`,
        [cutoff, retentionDays]
      );
      rowsPruned += del.rowCount ?? 0;
      if ((del.rowCount ?? 0) < PRUNE_BATCH) break;
      await new Promise((r) => setTimeout(r, PRUNE_BATCH_PAUSE_MS));
    }
  }

  return { rowsRolled: rolled.rowCount ?? 0, rowsPruned };
}

/** Hourly rollup loop; same overlap guard as the other background loops. */
export function startRollupLoop(pool: pg.Pool, intervalMs = 60 * 60 * 1000): NodeJS.Timeout {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    rollupSweep(pool)
      .then((r) => {
        if (r.rowsRolled || r.rowsPruned) {
          console.log(`rollup sweep: ${r.rowsRolled} daily row(s) upserted, ${r.rowsPruned} raw row(s) pruned`);
        }
      })
      .catch((e) => console.error("rollup sweep error:", e.message))
      .finally(() => { running = false; });
  };
  const first = setTimeout(run, 5 * 60_000); // shortly after boot, post-migration
  first.unref?.();
  const t = setInterval(run, intervalMs);
  t.unref?.();
  return t;
}
