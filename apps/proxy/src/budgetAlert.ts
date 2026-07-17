import { escapeHtml, sendViaResend, unsubscribeUrl, type ReportDeps } from "./emailReport.js";

// Keep-alive budget alert: the moment a key's warming spend reaches its daily
// budget, pings pause until tomorrow (UTC) — this tells the owner instead of
// letting the cache silently go cold. At most one email per key per UTC day,
// enforced by email_log's unique constraint (kind 'ka_budget').

const BASE_URL = (process.env.PUBLIC_BASE_URL ?? "https://caching.ai").replace(/\/$/, "");

export interface BudgetHit {
  userId: number;
  email: string;
  locale: string;
  keyId: number;
  keyName: string;
  budgetUsd: number;
  spentUsd: number;
  pingsToday: number;
}

const usd = (v: number) =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 });

// Korean fully localized (Toss tone); every other locale reads English —
// same policy as the weekly report.
const ALERT_STRINGS = {
  en: {
    subject: (name: string) => `Key “${name}” hit its keep-alive budget today`,
    title: "Keep-alive budget reached",
    body: (name: string, budget: string, spent: string, pings: number) =>
      `Warm-up pings for <strong>${name}</strong> reached today's budget of <strong>${budget}</strong> ` +
      `(${pings} pings · ${spent} spent), so pinging is paused until tomorrow (UTC). ` +
      `Until then, an idle gap longer than the cache lifetime means the next call pays full price again.`,
    note: "Ping costs are already deducted from your net savings — you never pay for warming that didn't pay off.",
    cta: "Adjust the budget",
    footer: "You get this at most once per key per day, only when the budget is actually reached.",
    unsub: "Unsubscribe with one click",
  },
  ko: {
    subject: (name: string) => `『${name}』 키가 오늘 워밍 예산에 도달했어요`,
    title: "워밍 예산에 도달했어요",
    body: (name: string, budget: string, spent: string, pings: number) =>
      `<strong>${name}</strong> 키의 캐시 워밍이 오늘 예산 <strong>${budget}</strong>에 도달해서(연장 신호 ${pings}회 · ${spent} 사용), ` +
      `내일(UTC)까지 워밍을 쉬어요. 그동안 캐시 수명보다 긴 공백이 생기면 다음 호출은 다시 정가를 내요.`,
    note: "연장 신호 비용은 순절감액에서 이미 빠져 있어요 — 이득이 안 된 워밍 비용을 따로 내는 일은 없어요.",
    cta: "예산 조정하기",
    footer: "예산에 실제로 도달했을 때만, 키마다 하루 최대 한 번 보내드려요.",
    unsub: "클릭 한 번으로 수신 거부",
  },
};

export function renderBudgetAlertHtml(hit: BudgetHit, unsubUrl?: string): { subject: string; html: string } {
  const t = hit.locale === "ko" ? ALERT_STRINGS.ko : ALERT_STRINGS.en;
  const name = escapeHtml(hit.keyName);
  const subject = t.subject(hit.keyName);

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f7f7f7;font-family:Inter,-apple-system,Segoe UI,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #d8d8d8;border-radius:8px;">
  <tr><td style="padding:28px 32px 0;">
    <span style="font-size:18px;font-weight:600;color:#080808;">caching</span><span style="font-size:18px;font-weight:600;color:#898989;">.ai</span>
  </td></tr>
  <tr><td style="padding:20px 32px 0;font-size:22px;font-weight:600;color:#080808;">${t.title}</td></tr>
  <tr><td style="padding:16px 32px 0;">
    <div style="padding:16px;background:#fff8e8;border:1px solid #ffae13;border-radius:8px;font-size:14px;color:#080808;line-height:1.7;">
      ${t.body(name, usd(hit.budgetUsd), usd(hit.spentUsd), hit.pingsToday)}
    </div>
  </td></tr>
  <tr><td style="padding:16px 32px 0;font-size:14px;color:#5a5a5a;line-height:1.6;">${t.note}</td></tr>
  <tr><td style="padding:20px 32px 28px;">
    <a href="${BASE_URL}/console/keys" style="display:inline-block;background:#080808;color:#ffffff;text-decoration:none;font-size:15px;font-weight:500;padding:12px 20px;border-radius:4px;">${t.cta}</a>
  </td></tr>
  <tr><td style="padding:0 32px 28px;font-size:12px;color:#ababab;line-height:1.6;">
    ${t.footer}
    ${unsubUrl ? `<a href="${unsubUrl}" style="color:#898989;">${t.unsub}</a> ·` : ""} Caching.ai — LLM cache FinOps
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  return { subject, html };
}

/**
 * Keys whose warming spend reached the daily budget today. The keep-alive
 * sweep enforces the budget per KEY (today's spend summed across the key's
 * provider rows), so the alert fires on the same condition.
 */
export async function budgetHitsFor(deps: ReportDeps): Promise<BudgetHit[]> {
  const now = deps.now ? deps.now() : new Date();
  const today = now.toISOString().slice(0, 10);
  const { rows } = await deps.pool.query(
    `SELECT u.id AS user_id, u.email, u.locale,
            k.id AS key_id, k.name,
            k.keepalive_budget_usd_daily::float AS budget,
            sum(ks.spend_today_usd)::float AS spent,
            sum(ks.pings_today)::int AS pings
       FROM keepalive_state ks
       JOIN api_keys k ON k.id = ks.api_key_id
       JOIN users u ON u.id = k.user_id
      WHERE k.keepalive_enabled = true
        AND k.revoked_at IS NULL
        AND u.report_opt_out = false
        AND k.keepalive_budget_usd_daily > 0
        AND ks.spend_day = $1::date
      GROUP BY u.id, u.email, u.locale, k.id, k.name, k.keepalive_budget_usd_daily
     HAVING sum(ks.spend_today_usd) >= k.keepalive_budget_usd_daily`,
    [today]
  );
  return rows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    locale: r.locale ?? "en",
    keyId: r.key_id,
    keyName: r.name,
    budgetUsd: r.budget,
    spentUsd: r.spent,
    pingsToday: r.pings,
  }));
}

/** One alert sweep. Dedup per (user, 'ka_budget', keyId:day) — safe to run often. */
export async function budgetAlertSweep(deps: ReportDeps): Promise<number> {
  const now = deps.now ? deps.now() : new Date();
  const today = now.toISOString().slice(0, 10);
  const hits = await budgetHitsFor(deps);

  let sent = 0;
  for (const hit of hits) {
    const claimed = await deps.pool.query(
      `INSERT INTO email_log(user_id, kind, period_key) VALUES($1,'ka_budget',$2)
       ON CONFLICT DO NOTHING RETURNING id`,
      [hit.userId, `${hit.keyId}:${today}`]
    );
    if (!claimed.rows[0]) continue; // already alerted today

    const unsub = deps.unsubscribeSecret ? unsubscribeUrl(hit.userId, deps.unsubscribeSecret) : undefined;
    const { subject, html } = renderBudgetAlertHtml(hit, unsub);
    const ok = await sendViaResend(deps, hit.email, subject, html, unsub);
    if (ok) {
      sent++;
    } else {
      // release the claim so a later sweep can retry
      await deps.pool.query("DELETE FROM email_log WHERE id=$1", [claimed.rows[0].id]);
    }
  }
  return sent;
}

export function startBudgetAlertLoop(deps: ReportDeps, intervalMs = 5 * 60 * 1000): NodeJS.Timeout {
  const t = setInterval(() => {
    budgetAlertSweep(deps).catch((e) => console.error("budget alert sweep error:", e.message));
  }, intervalMs);
  t.unref?.();
  return t;
}
