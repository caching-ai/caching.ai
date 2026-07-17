import type pg from "pg";
import { decrypt } from "@caching/shared";

// Postpaid performance-fee collection. Runs after a billing period fully
// closes (period_end < today): charges the stored card via the user's PSP —
// Stripe (global, USD) or Toss Payments (Korea, KRW at a fixed conversion
// rate). Fees below the minimum are waived, not carried over.
//
// Money flow is append-only: every attempt claims a billing_charges row first
// (unique per user+period), so a crashed or replayed sweep can never charge
// twice. Charges only happen at all when BILLING_LIVE=1 marks periods as
// 'accruing' — beta periods stay 'beta_waived' forever.

export interface ChargeDeps {
  pool: pg.Pool;
  encryptionKey: string;
  stripeSecretKey?: string;
  tossSecretKey?: string;
  fxKrwPerUsd?: number;
  minChargeUsd?: number;
  fetchImpl?: typeof fetch;
  stripeUrl?: string;
  tossUrl?: string;
  now?: () => Date;
}

interface DuePeriod {
  user_id: number;
  period_start: string;
  fee_usd: string;
  psp: string | null;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  toss_billing_key_encrypted: string | null;
  toss_customer_key: string | null;
}

async function chargeStripe(
  deps: ChargeDeps, p: DuePeriod, feeUsd: number, doFetch: typeof fetch
): Promise<{ ok: boolean; ref?: string; error?: string }> {
  const res = await doFetch(`${deps.stripeUrl ?? "https://api.stripe.com"}/v1/payment_intents`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${deps.stripeSecretKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "idempotency-key": `cai-fee-${p.user_id}-${p.period_start}`,
    },
    body: new URLSearchParams({
      amount: String(Math.round(feeUsd * 100)),
      currency: "usd",
      customer: p.stripe_customer_id ?? "",
      payment_method: p.stripe_payment_method_id ?? "",
      off_session: "true",
      confirm: "true",
      description: `Caching.ai performance fee — ${p.period_start.slice(0, 7)}`,
    }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || j?.status === "requires_payment_method") {
    return { ok: false, error: (j?.error?.message ?? `stripe ${res.status}`).slice(0, 300) };
  }
  return { ok: true, ref: j?.id };
}

async function chargeToss(
  deps: ChargeDeps, p: DuePeriod, amountKrw: number, doFetch: typeof fetch
): Promise<{ ok: boolean; ref?: string; error?: string }> {
  const billingKey = decrypt(p.toss_billing_key_encrypted!, deps.encryptionKey);
  const res = await doFetch(
    `${deps.tossUrl ?? "https://api.tosspayments.com"}/v1/billing/${encodeURIComponent(billingKey)}`,
    {
      method: "POST",
      headers: {
        authorization: "Basic " + Buffer.from(`${deps.tossSecretKey}:`).toString("base64"),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        customerKey: p.toss_customer_key,
        amount: amountKrw,
        orderId: `cai-fee-${p.user_id}-${p.period_start}`,
        orderName: `Caching.ai 절감 성과 수수료 (${p.period_start.slice(0, 7)})`,
      }),
    }
  );
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: (j?.message ?? `toss ${res.status}`).slice(0, 300) };
  return { ok: true, ref: j?.paymentKey };
}

export async function chargeSweep(deps: ChargeDeps): Promise<number> {
  const { pool } = deps;
  const doFetch = deps.fetchImpl ?? fetch;
  const minCharge = deps.minChargeUsd ?? 5;
  const fx = deps.fxKrwPerUsd ?? 1400;

  // periods fully closed and still awaiting collection
  const { rows } = await pool.query<DuePeriod>(
    `SELECT bp.user_id, bp.period_start::text AS period_start, bp.fee_usd,
            pm.psp, pm.stripe_customer_id, pm.stripe_payment_method_id,
            pm.toss_billing_key_encrypted, pm.toss_customer_key
       FROM billing_periods bp
       LEFT JOIN payment_methods pm ON pm.user_id = bp.user_id
      WHERE bp.status IN ('accruing', 'no_payment_method')
        AND bp.period_end < ($1::timestamptz)::date - 1`,
    [(deps.now ? deps.now() : new Date()).toISOString()]
  );

  let charged = 0;
  for (const p of rows) {
    const fee = Number(p.fee_usd);
    const setStatus = (status: string) =>
      pool.query(
        `UPDATE billing_periods SET status=$3 WHERE user_id=$1 AND period_start=$2::date`,
        [p.user_id, p.period_start, status]
      );

    if (fee < minCharge) {
      await setStatus("waived_min");
      continue;
    }
    const stripeReady = p.psp === "stripe" && p.stripe_customer_id && p.stripe_payment_method_id && deps.stripeSecretKey;
    const tossReady = p.psp === "toss" && p.toss_billing_key_encrypted && deps.tossSecretKey;
    if (!stripeReady && !tossReady) {
      await setStatus("no_payment_method");
      continue;
    }

    const currency = p.psp === "toss" ? "KRW" : "USD";
    const amount = p.psp === "toss" ? Math.round(fee * fx) : Math.round(fee * 100) / 100;

    // claim first — the unique index is the double-charge guard
    const claim = await pool.query(
      `INSERT INTO billing_charges(user_id, period_start, amount_usd, charged_amount, currency, psp, status)
       VALUES($1,$2::date,$3,$4,$5,$6,'pending')
       ON CONFLICT (user_id, period_start) DO NOTHING RETURNING id`,
      [p.user_id, p.period_start, fee, amount, currency, p.psp]
    );
    if (!claim.rows[0]) continue; // already attempted (retry is a manual ops decision)

    let result: { ok: boolean; ref?: string; error?: string };
    try {
      result = p.psp === "toss"
        ? await chargeToss(deps, p, amount, doFetch)
        : await chargeStripe(deps, p, fee, doFetch);
    } catch (e) {
      result = { ok: false, error: (e as Error).message.slice(0, 300) };
    }

    await pool.query(
      `UPDATE billing_charges SET status=$2, psp_ref=$3, error=$4 WHERE id=$1`,
      [claim.rows[0].id, result.ok ? "paid" : "failed", result.ref ?? null, result.error ?? null]
    );
    await setStatus(result.ok ? "paid" : "charge_failed");
    if (result.ok) charged++;
  }
  return charged;
}

export function startChargeLoop(deps: ChargeDeps, intervalMs = 6 * 60 * 60 * 1000): NodeJS.Timeout {
  chargeSweep(deps).catch((e) => console.error("charge sweep error:", e.message));
  const t = setInterval(() => {
    chargeSweep(deps).catch((e) => console.error("charge sweep error:", e.message));
  }, intervalMs);
  t.unref?.();
  return t;
}
