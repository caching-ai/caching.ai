import type pg from "pg";

export const FEE_RATE = 0.2;

/**
 * Performance-fee metering (성과 과금 계측): recompute the current month's
 * verified savings per user from request_logs and upsert billing_periods.
 *
 *   gross_saved  = Σ saved_usd over the user's non-keepalive requests
 *                  (per-row saved already nets out the cache-write premium)
 *   keepalive    = Σ cost_usd of keep-alive pings we sent on their behalf
 *   net_saved    = gross_saved - keepalive
 *   fee          = FEE_RATE × max(0, net_saved)
 *
 * Idempotent full recompute — the aggregate is never mutated incrementally,
 * so replays and retries can't double-count. Open periods carry 'accruing'
 * when BILLING_LIVE=1 (else 'beta_waived'); closed statuses are never touched.
 */
export async function billingSweep(
  pool: pg.Pool,
  now: Date = new Date(),
  live = process.env.BILLING_LIVE === "1"
): Promise<number> {
  // On the 1st (UTC) also recompute the month that just closed, so requests
  // logged after its final in-month sweep are included before collection —
  // the charge sweep leaves a one-day grace window for exactly this.
  let count = await sweepMonth(pool, now, live);
  if (now.getUTCDate() === 1) {
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    count += await sweepMonth(pool, prev, live);
  }
  return count;
}

async function sweepMonth(pool: pg.Pool, now: Date, live: boolean): Promise<number> {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const startStr = periodStart.toISOString().slice(0, 10);
  const endStr = periodEnd.toISOString().slice(0, 10);

  const { rowCount } = await pool.query(
    `INSERT INTO billing_periods
       (user_id, period_start, period_end, gross_saved_usd, keepalive_cost_usd,
        net_saved_usd, fee_usd, fee_rate, status, computed_at)
     SELECT k.user_id, $1::date, $2::date,
            COALESCE(sum(rl.saved_usd) FILTER (WHERE NOT rl.is_keepalive), 0),
            COALESCE(sum(rl.cost_usd) FILTER (WHERE rl.is_keepalive), 0),
            COALESCE(sum(rl.saved_usd) FILTER (WHERE NOT rl.is_keepalive), 0)
              - COALESCE(sum(rl.cost_usd) FILTER (WHERE rl.is_keepalive), 0),
            GREATEST(0,
              COALESCE(sum(rl.saved_usd) FILTER (WHERE NOT rl.is_keepalive), 0)
                - COALESCE(sum(rl.cost_usd) FILTER (WHERE rl.is_keepalive), 0)
            ) * $3,
            $3, $4, now()
       FROM request_logs rl
       JOIN api_keys k ON k.id = rl.api_key_id
      WHERE rl.ts >= $1::date AND rl.ts < ($2::date + 1)
      GROUP BY k.user_id
     ON CONFLICT (user_id, period_start) DO UPDATE SET
        period_end = EXCLUDED.period_end,
        gross_saved_usd = EXCLUDED.gross_saved_usd,
        keepalive_cost_usd = EXCLUDED.keepalive_cost_usd,
        net_saved_usd = EXCLUDED.net_saved_usd,
        fee_usd = EXCLUDED.fee_usd,
        fee_rate = EXCLUDED.fee_rate,
        -- keep terminal statuses (paid / charge_failed / waived_min / no_payment_method)
        -- set by the charge sweep; only open periods follow the live flag
        status = CASE WHEN billing_periods.status IN ('beta_waived', 'accruing')
                      THEN EXCLUDED.status ELSE billing_periods.status END,
        computed_at = now()`,
    [startStr, endStr, FEE_RATE, live ? "accruing" : "beta_waived"]
  );
  return rowCount ?? 0;
}

export function startBillingLoop(pool: pg.Pool, intervalMs = 15 * 60 * 1000): NodeJS.Timeout {
  billingSweep(pool).catch((e) => console.error("billing sweep error:", e.message));
  const t = setInterval(() => {
    billingSweep(pool).catch((e) => console.error("billing sweep error:", e.message));
  }, intervalMs);
  t.unref?.();
  return t;
}
