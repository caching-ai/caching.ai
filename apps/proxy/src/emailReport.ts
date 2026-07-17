import type pg from "pg";
import { signSession, wastePerInputTokenUsd, type Provider } from "@caching/shared";

// Weekly savings report, sent via Resend on Mondays (UTC) to users who had
// real traffic in the previous 7 days. One email per user per ISO week,
// enforced by email_log's unique constraint — never spammy by construction.

export interface ReportDeps {
  pool: pg.Pool;
  resendApiKey: string;
  /** signs one-click unsubscribe tokens (web verifies with the same secret) */
  unsubscribeSecret?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  resendUrl?: string;
}

const BASE_URL = (process.env.PUBLIC_BASE_URL ?? "https://caching.ai").replace(/\/$/, "");
const EMAIL_FROM = process.env.EMAIL_FROM ?? "Caching.ai Reports <reports@caching.ai>";

/** user-influenced strings (e.g. model names) must never reach email HTML raw */
export function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function unsubscribeUrl(userId: number, secret: string): string {
  // valid for 180 days — long enough for any archived email, not forever
  const token = signSession(
    { uid: userId, kind: "unsub", exp: Date.now() + 180 * 24 * 3600 * 1000 }, secret);
  return `${BASE_URL}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

export interface WeeklyStats {
  email: string;
  userId: number;
  locale: string;
  requests: number;
  savedUsd: number;
  wastedUsd: number;
  hitRate: number;
  cacheReadTokens: number;
  totalInputTokens: number;
  keepalivePings: number;
  keepaliveCostUsd: number;
  breakerRate: number;
  topModel: string;
  /** auto-tune (cloud) changes applied to the user's keys in the window */
  tuningChanges: number;
  tuningExample: { keyName: string; setting: string; from: string; to: string } | null;
}

export function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const usd = (v: number) =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 });
const pct = (v: number) => (v * 100).toFixed(1) + "%";

// Report email copy — Korean gets the fully localized version (Toss tone);
// every other locale reads English.
const REPORT_STRINGS = {
  en: {
    subjectSaved: (v: string) => `You saved ${v} on LLM tokens last week`,
    subjectNone: "Your LLM cache report for last week",
    title: "Your weekly cache report",
    sub: "Last 7 days · all keys · estimated from list prices",
    saved: "SAVED BY CACHING",
    leaking: "STILL LEAKING",
    line: (req: string, hit: string) => `<strong style="color:#080808;">${req}</strong> requests · hit rate <strong style="color:#080808;">${hit}</strong> · top model`,
    keepalive: (n: number, cost: string) => `Keep-Alive sent ${n} warm-up pings (${cost}) to stop your cache from expiring between calls.`,
    breaker: (rate: string) => `⚠️ Your prompt prefix changed on ${rate} of requests — likely a timestamp or random ID in your system prompt. Fixing it is usually a one-line change and unlocks the biggest savings.`,
    tuning: (n: number, ex: string) => `Auto-Tune adjusted ${n} cache setting${n === 1 ? "" : "s"} from your real traffic last week — e.g. ${ex}. Full reasoning is on each key in the console.`,
    tuningSetting: { anthropic_cache_ttl: "Anthropic cache TTL", openai_cache_retention: "OpenAI cache retention" } as Record<string, string>,
    cta: "Open your dashboard",
    footer: "You get this once a week, only for weeks you actually had traffic.",
    unsub: "Unsubscribe with one click",
  },
  ko: {
    subjectSaved: (v: string) => `지난주 LLM 토큰 비용 ${v}를 아꼈어요`,
    subjectNone: "지난주 캐시 리포트가 도착했어요",
    title: "주간 캐시 리포트",
    sub: "최근 7일 · 모든 키 · 정가 기준 추정치예요",
    saved: "캐싱으로 절감",
    leaking: "아직 새는 돈",
    line: (req: string, hit: string) => `요청 <strong style="color:#080808;">${req}</strong>회 · 히트율 <strong style="color:#080808;">${hit}</strong> · 주 사용 모델`,
    keepalive: (n: number, cost: string) => `캐시가 식지 않도록 자동 연장 핑을 ${n}회 보냈어요(${cost}).`,
    breaker: (rate: string) => `⚠️ 요청의 ${rate}에서 프롬프트 앞부분이 바뀌었어요 — 시스템 프롬프트 속 타임스탬프나 랜덤 ID가 원인일 가능성이 커요. 보통 한 줄만 고치면 가장 큰 절감이 열려요.`,
    tuning: (n: number, ex: string) => `자동 최적화가 지난주 실트래픽을 보고 캐시 설정 ${n}건을 조정했어요 — 예: ${ex}. 자세한 근거는 콘솔의 각 키에서 볼 수 있어요.`,
    tuningSetting: { anthropic_cache_ttl: "Anthropic 캐시 수명", openai_cache_retention: "OpenAI 캐시 보존" } as Record<string, string>,
    cta: "대시보드 열기",
    footer: "실제로 트래픽이 있었던 주에만, 일주일에 한 번 보내드려요.",
    unsub: "클릭 한 번으로 수신 거부",
  },
};

export function renderWeeklyReportHtml(
  s: WeeklyStats,
  unsubUrl?: string
): { subject: string; html: string } {
  const t = s.locale === "ko" ? REPORT_STRINGS.ko : REPORT_STRINGS.en;
  const subject = s.savedUsd >= 0.01 ? t.subjectSaved(usd(s.savedUsd)) : t.subjectNone;

  const breakerBlock =
    s.breakerRate >= 0.3
      ? `<tr><td style="padding:16px 24px;background:#fff8e8;border:1px solid #ffae13;border-radius:8px;font-size:14px;color:#080808;">
           ${t.breaker(pct(s.breakerRate))}
         </td></tr><tr><td style="height:16px;"></td></tr>`
      : "";

  // old_value is nullable in tuning_decisions — skip the "from →" part rather
  // than render a dangling arrow in customer-facing copy
  const tuningBlock =
    s.tuningChanges > 0 && s.tuningExample
      ? `<tr><td style="padding:0 0 16px;font-size:14px;color:#5a5a5a;">
           ${t.tuning(
             s.tuningChanges,
             `<strong style="color:#080808;">${escapeHtml(s.tuningExample.keyName)}</strong> · ` +
               `${t.tuningSetting[s.tuningExample.setting] ?? escapeHtml(s.tuningExample.setting)} ` +
               (s.tuningExample.from ? `${escapeHtml(s.tuningExample.from)} → ` : "") +
               escapeHtml(s.tuningExample.to)
           )}
         </td></tr>`
      : "";

  const keepaliveBlock =
    s.keepalivePings > 0
      ? `<tr><td style="padding:0 0 16px;font-size:14px;color:#5a5a5a;">
           ${t.keepalive(s.keepalivePings, usd(s.keepaliveCostUsd))}
         </td></tr>`
      : "";

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f7f7f7;font-family:Inter,-apple-system,Segoe UI,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #d8d8d8;border-radius:8px;">
  <tr><td style="padding:28px 32px 0;">
    <span style="font-size:18px;font-weight:600;color:#080808;">caching</span><span style="font-size:18px;font-weight:600;color:#898989;">.ai</span>
  </td></tr>
  <tr><td style="padding:20px 32px 0;font-size:22px;font-weight:600;color:#080808;">${t.title}</td></tr>
  <tr><td style="padding:8px 32px 24px;font-size:14px;color:#5a5a5a;">${t.sub}</td></tr>
  <tr><td style="padding:0 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="50%" style="padding:16px;border:1px solid #d8d8d8;border-radius:8px;">
          <div style="font-size:11px;letter-spacing:1px;color:#898989;">${t.saved}</div>
          <div style="font-size:28px;font-weight:600;color:#00a51b;font-family:Inconsolata,monospace;">${usd(s.savedUsd)}</div>
        </td>
        <td style="width:12px;"></td>
        <td width="50%" style="padding:16px;border:1px solid #d8d8d8;border-radius:8px;">
          <div style="font-size:11px;letter-spacing:1px;color:#898989;">${t.leaking}</div>
          <div style="font-size:28px;font-weight:600;color:#ee1d36;font-family:Inconsolata,monospace;">${usd(s.wastedUsd)}</div>
        </td>
      </tr>
    </table>
  </td></tr>
  <tr><td style="padding:20px 32px 8px;font-size:14px;color:#363636;line-height:1.6;">
    ${t.line(s.requests.toLocaleString(), pct(s.hitRate))} <span style="font-family:Inconsolata,monospace;">${escapeHtml(s.topModel) || "—"}</span>
  </td></tr>
  <tr><td style="padding:0 32px;">${keepaliveBlock ? `<table role="presentation" width="100%">${keepaliveBlock}</table>` : ""}</td></tr>
  <tr><td style="padding:0 32px;">${tuningBlock ? `<table role="presentation" width="100%">${tuningBlock}</table>` : ""}</td></tr>
  <tr><td style="padding:0 32px;">${breakerBlock ? `<table role="presentation" width="100%">${breakerBlock}</table>` : ""}</td></tr>
  <tr><td style="padding:8px 32px 28px;">
    <a href="${BASE_URL}/console" style="display:inline-block;background:#080808;color:#ffffff;text-decoration:none;font-size:15px;font-weight:500;padding:12px 20px;border-radius:4px;">${t.cta}</a>
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

export async function weeklyStatsFor(pool: pg.Pool, sinceDays = 7): Promise<WeeklyStats[]> {
  const { rows } = await pool.query(
    `SELECT u.id AS user_id, u.email, u.locale,
            count(*) FILTER (WHERE NOT rl.is_keepalive)::int AS requests,
            COALESCE(sum(rl.saved_usd) FILTER (WHERE NOT rl.is_keepalive), 0)::float AS saved,
            COALESCE(sum(rl.cache_read_tokens), 0)::bigint AS cache_read,
            COALESCE(sum(rl.input_tokens), 0)::bigint AS input,
            COALESCE(sum(rl.cache_creation_tokens), 0)::bigint AS cache_creation,
            count(*) FILTER (WHERE rl.is_keepalive)::int AS ka_pings,
            COALESCE(sum(rl.cost_usd) FILTER (WHERE rl.is_keepalive), 0)::float AS ka_cost,
            count(*) FILTER (WHERE rl.cache_breaker_detected)::int AS breakers,
            (array_agg(rl.model ORDER BY rl.ts DESC))[1] AS top_model,
            COALESCE(sum(CASE WHEN rl.cache_read_tokens = 0 AND NOT rl.is_keepalive
              THEN rl.input_tokens ELSE 0 END), 0)::bigint AS uncached_input,
            (array_agg(rl.provider ORDER BY rl.ts DESC))[1] AS last_provider
       FROM request_logs rl
       JOIN api_keys k ON k.id = rl.api_key_id
       JOIN users u ON u.id = k.user_id
      WHERE rl.ts > now() - ($1 || ' days')::interval
        AND u.report_opt_out = false
      GROUP BY u.id, u.email, u.locale
     HAVING count(*) FILTER (WHERE NOT rl.is_keepalive) > 0`,
    [sinceDays]
  );

  // Auto-tune decisions in the same window, newest first per user (cloud
  // feature — the table simply stays empty on self-host).
  const tuning = await pool.query(
    `SELECT u.id AS user_id, count(*)::int AS changes,
            (array_agg(k.name ORDER BY td.created_at DESC))[1] AS key_name,
            (array_agg(td.setting ORDER BY td.created_at DESC))[1] AS setting,
            (array_agg(COALESCE(td.old_value, '') ORDER BY td.created_at DESC))[1] AS old_value,
            (array_agg(td.new_value ORDER BY td.created_at DESC))[1] AS new_value
       FROM tuning_decisions td
       JOIN api_keys k ON k.id = td.api_key_id
       JOIN users u ON u.id = k.user_id
      WHERE td.created_at > now() - ($1 || ' days')::interval
      GROUP BY u.id`,
    [sinceDays]
  );
  const tuningByUser = new Map<number, { changes: number; example: WeeklyStats["tuningExample"] }>(
    tuning.rows.map((r) => [
      r.user_id,
      {
        changes: r.changes,
        example: { keyName: r.key_name, setting: r.setting, from: r.old_value, to: r.new_value },
      },
    ])
  );

  return rows.map((r) => {
    const denom = Number(r.input) + Number(r.cache_read) + Number(r.cache_creation);
    return {
      email: r.email,
      userId: r.user_id,
      locale: r.locale ?? "en",
      requests: r.requests,
      savedUsd: r.saved,
      wastedUsd:
        Number(r.uncached_input) *
        wastePerInputTokenUsd((r.last_provider ?? "anthropic") as Provider, r.top_model ?? ""),
      hitRate: denom > 0 ? Number(r.cache_read) / denom : 0,
      cacheReadTokens: Number(r.cache_read),
      totalInputTokens: denom,
      keepalivePings: r.ka_pings,
      keepaliveCostUsd: r.ka_cost,
      breakerRate: r.requests > 0 ? r.breakers / r.requests : 0,
      topModel: r.top_model ?? "",
      tuningChanges: tuningByUser.get(r.user_id)?.changes ?? 0,
      tuningExample: tuningByUser.get(r.user_id)?.example ?? null,
    };
  });
}

export async function sendViaResend(
  deps: ReportDeps,
  to: string,
  subject: string,
  html: string,
  unsubUrl?: string
): Promise<boolean> {
  const doFetch = deps.fetchImpl ?? fetch;
  const res = await doFetch(deps.resendUrl ?? "https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${deps.resendApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [to],
      subject,
      html,
      ...(unsubUrl
        ? {
            headers: {
              "List-Unsubscribe": `<${unsubUrl}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          }
        : {}),
    }),
  });
  if (!res.ok) {
    console.error("resend send failed:", res.status, (await res.text()).slice(0, 200));
    return false;
  }
  return true;
}

/**
 * One report sweep. Sends only on Mondays (UTC, from 09:00) unless `force`.
 * Dedup via email_log(user, kind, iso-week) — safe to run hourly.
 */
export async function weeklyReportSweep(deps: ReportDeps, force = false): Promise<number> {
  const now = deps.now ? deps.now() : new Date();
  if (!force && !(now.getUTCDay() === 1 && now.getUTCHours() >= 9)) return 0;

  const week = isoWeekKey(now);
  const stats = await weeklyStatsFor(deps.pool);
  let sent = 0;
  for (const s of stats) {
    const claimed = await deps.pool.query(
      `INSERT INTO email_log(user_id, kind, period_key) VALUES($1,'weekly_report',$2)
       ON CONFLICT DO NOTHING RETURNING id`,
      [s.userId, week]
    );
    if (!claimed.rows[0]) continue; // already sent this week

    const unsub = deps.unsubscribeSecret ? unsubscribeUrl(s.userId, deps.unsubscribeSecret) : undefined;
    const { subject, html } = renderWeeklyReportHtml(s, unsub);
    const ok = await sendViaResend(deps, s.email, subject, html, unsub);
    if (ok) {
      sent++;
    } else {
      // release the claim so a later sweep can retry
      await deps.pool.query("DELETE FROM email_log WHERE id=$1", [claimed.rows[0].id]);
    }
  }
  return sent;
}

export function startWeeklyReportLoop(deps: ReportDeps, intervalMs = 60 * 60 * 1000): NodeJS.Timeout {
  const t = setInterval(() => {
    weeklyReportSweep(deps).catch((e) => console.error("weekly report sweep error:", e.message));
  }, intervalMs);
  t.unref?.();
  return t;
}
