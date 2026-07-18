import type pg from "pg";
import { decrypt } from "@caching/shared";
import { sendViaResend } from "./emailReport.js";

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
  /** dunning emails (skipped when absent — locking still applies) */
  resendApiKey?: string;
  resendUrl?: string;
}

// Dunning policy (industry standard: retry → remind → pause → auto-restore).
// Optimization features pause only past BOTH thresholds; traffic always
// passes through untouched, so a delinquent account loses new savings —
// never service.
export const DUNNING_MIN_USD = Number(process.env.DUNNING_MIN_USD ?? 10);
export const DUNNING_GRACE_DAYS = Number(process.env.DUNNING_GRACE_DAYS ?? 14);
const RETRY_EVERY_MS = 72 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 4;

const DUNNING_STRINGS = {
  ko: {
    lockSubject: "[Caching.ai] 결제 확인이 필요해서 자동 절약을 잠시 멈췄어요",
    lockBody: (usd: string) => `
      <p>안녕하세요, Caching.ai예요.</p>
      <p>정산되지 않은 성과 수수료 <b>$${usd}</b>가 유예 기간(${DUNNING_GRACE_DAYS}일)을 지나서,
      계정의 <b>자동 절약 기능(캐시 주입·캐시 워머)을 잠시 멈췄어요</b>.
      API 트래픽은 평소처럼 그대로 통과하니 서비스가 끊기지는 않아요 — 새 절감만 생기지 않아요.</p>
      <p><a href="https://caching.ai/console/billing">콘솔 &gt; 요금</a>에서 카드를 등록하거나
      결제 수단을 갱신해 주시면, 다음 정산 사이클에서 자동으로 다시 켜드려요.</p>`,
    unlockSubject: "[Caching.ai] 자동 절약이 다시 켜졌어요",
    unlockBody: () => `
      <p>결제가 확인돼서 자동 절약 기능을 다시 켰어요. 이용해 주셔서 고마워요!</p>
      <p><a href="https://caching.ai/console">대시보드</a>에서 절감이 다시 쌓이는 걸 확인하실 수 있어요.</p>`,
  },
  en: {
    lockSubject: "[Caching.ai] Savings paused — payment needs attention",
    lockBody: (usd: string) => `
      <p>Hi, this is Caching.ai.</p>
      <p>An unsettled performance fee of <b>$${usd}</b> has passed the ${DUNNING_GRACE_DAYS}-day grace window,
      so we've <b>paused the account's optimization features</b> (cache injection and the Cache Warmer).
      Your API traffic still passes through untouched — nothing breaks, you just stop accruing new savings.</p>
      <p>Add or update a card in <a href="https://caching.ai/console/billing">Console &gt; Billing</a> and
      everything switches back on automatically on the next settlement cycle.</p>`,
    unlockSubject: "[Caching.ai] Savings are back on",
    unlockBody: () => `
      <p>Payment confirmed — your optimization features are switched back on. Thank you!</p>
      <p>Watch the savings accrue again on your <a href="https://caching.ai/console">dashboard</a>.</p>`,
  },
};

async function sendDunningEmail(
  deps: ChargeDeps, email: string, locale: string, kind: "lock" | "unlock", usd: string
): Promise<void> {
  if (!deps.resendApiKey) return;
  const t = locale === "ko" ? DUNNING_STRINGS.ko : DUNNING_STRINGS.en;
  const subject = kind === "lock" ? t.lockSubject : t.unlockSubject;
  const html = kind === "lock" ? t.lockBody(usd) : t.unlockBody();
  try {
    await sendViaResend(
      { pool: deps.pool, resendApiKey: deps.resendApiKey, resendUrl: deps.resendUrl, fetchImpl: deps.fetchImpl },
      email, subject, html
    );
  } catch (e) {
    console.error("dunning email failed:", (e as Error).message);
  }
}

/**
 * Auto-retry failed card charges every ~72h, up to MAX_ATTEMPTS total —
 * transient declines (expired card replaced, balance topped up) recover
 * without ops intervention.
 */
export async function retryFailedCharges(deps: ChargeDeps): Promise<number> {
  const { pool } = deps;
  const doFetch = deps.fetchImpl ?? fetch;
  const nowMs = (deps.now ? deps.now() : new Date()).getTime();
  const { rows } = await pool.query(
    `SELECT bc.id AS charge_id, bc.attempts, bp.user_id, bp.period_start::text AS period_start, bp.fee_usd,
            pm.psp, pm.stripe_customer_id, pm.stripe_payment_method_id,
            pm.toss_billing_key_encrypted, pm.toss_customer_key
       FROM billing_charges bc
       JOIN billing_periods bp ON bp.user_id = bc.user_id AND bp.period_start = bc.period_start
       LEFT JOIN payment_methods pm ON pm.user_id = bc.user_id
      WHERE bc.status = 'failed' AND bc.attempts < $1
        AND bc.last_attempt_at <= to_timestamp($2 / 1000.0)`,
    [MAX_ATTEMPTS, nowMs - RETRY_EVERY_MS]
  );
  let recovered = 0;
  for (const p of rows) {
    // claim the retry slot first so concurrent sweeps can't double-charge
    const claim = await pool.query(
      `UPDATE billing_charges SET attempts = attempts + 1, last_attempt_at = to_timestamp($2 / 1000.0)
        WHERE id = $1 AND status = 'failed' AND attempts = $3 RETURNING id`,
      [p.charge_id, nowMs, p.attempts]
    );
    if (!claim.rows[0]) continue;

    const fee = Number(p.fee_usd);
    const fx = deps.fxKrwPerUsd ?? 1400;
    let result: { ok: boolean; ref?: string; error?: string };
    try {
      result = p.psp === "toss" && p.toss_billing_key_encrypted && deps.tossSecretKey
        ? await chargeToss(deps, p as any, Math.round(fee * fx), doFetch)
        : p.psp === "stripe" && p.stripe_payment_method_id && deps.stripeSecretKey
          ? await chargeStripe(deps, p as any, fee, doFetch)
          : { ok: false, error: "no usable payment method" };
    } catch (e) {
      result = { ok: false, error: (e as Error).message.slice(0, 300) };
    }
    await pool.query(
      `UPDATE billing_charges SET status=$2, psp_ref=COALESCE($3, psp_ref), error=$4 WHERE id=$1`,
      [p.charge_id, result.ok ? "paid" : "failed", result.ref ?? null, result.error ?? null]
    );
    await pool.query(
      `UPDATE billing_periods SET status=$3 WHERE user_id=$1 AND period_start=$2::date`,
      [p.user_id, p.period_start, result.ok ? "paid" : "charge_failed"]
    );
    if (result.ok) recovered++;
  }
  return recovered;
}

/**
 * Lock/unlock pass. Locked = optimization paused (checked on the hot path via
 * users.billing_locked); pass-through service is never interrupted. A user is
 * locked once delinquent fees (charge_failed / no_payment_method periods past
 * the grace window) reach DUNNING_MIN_USD, and unlocked the moment they
 * don't. Transition emails only.
 */
export async function dunningSweep(deps: ChargeDeps): Promise<{ locked: number; unlocked: number }> {
  const { pool } = deps;
  const nowIso = (deps.now ? deps.now() : new Date()).toISOString();
  const delinquentSql = `
    SELECT COALESCE(sum(bp.fee_usd), 0) FROM billing_periods bp
     WHERE bp.user_id = u.id
       AND bp.status IN ('charge_failed', 'no_payment_method')
       AND bp.period_end < ($1::timestamptz)::date - $2::int`;

  const lockedRows = await pool.query(
    `UPDATE users u SET billing_locked = true
      WHERE u.billing_locked = false AND (${delinquentSql}) >= $3
      RETURNING u.id, u.email, u.locale, (${delinquentSql}) AS due`,
    [nowIso, DUNNING_GRACE_DAYS, DUNNING_MIN_USD]
  );
  for (const r of lockedRows.rows) {
    await sendDunningEmail(deps, r.email, r.locale ?? "en", "lock", Number(r.due).toFixed(2));
  }
  const unlockedRows = await pool.query(
    `UPDATE users u SET billing_locked = false
      WHERE u.billing_locked = true AND (${delinquentSql}) < $3
      RETURNING u.id, u.email, u.locale`,
    [nowIso, DUNNING_GRACE_DAYS, DUNNING_MIN_USD]
  );
  for (const r of unlockedRows.rows) {
    await sendDunningEmail(deps, r.email, r.locale ?? "en", "unlock", "0");
  }
  return { locked: lockedRows.rowCount ?? 0, unlocked: unlockedRows.rowCount ?? 0 };
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

async function fullChargePass(deps: ChargeDeps): Promise<void> {
  await chargeSweep(deps);
  await retryFailedCharges(deps);
  const d = await dunningSweep(deps);
  if (d.locked || d.unlocked) {
    console.log(`dunning: ${d.locked} account(s) paused, ${d.unlocked} restored`);
  }
}

export function startChargeLoop(deps: ChargeDeps, intervalMs = 6 * 60 * 60 * 1000): NodeJS.Timeout {
  fullChargePass(deps).catch((e) => console.error("charge sweep error:", e.message));
  const t = setInterval(() => {
    fullChargePass(deps).catch((e) => console.error("charge sweep error:", e.message));
  }, intervalMs);
  t.unref?.();
  return t;
}
