import { escapeHtml, sendViaResend, unsubscribeUrl, isoWeekKey, type ReportDeps } from "./emailReport.js";
import { wastePerInputTokenUsd, type Provider } from "@caching/shared";

// Org-workspace email surface:
//   1) weekly org cache report to every owner/admin (Mondays, deduped per
//      admin per ISO week via email_log kind 'org_weekly')
//   2) budget warn alerts at 80%/100% of any org budget's monthly limit,
//      deduped per budget+threshold+month via org_budget_alerts

const BASE_URL = (process.env.PUBLIC_BASE_URL ?? "https://caching.ai").replace(/\/$/, "");

const usd = (v: number) =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 });
const pct = (v: number) => (v * 100).toFixed(1) + "%";

// Korean fully localized (Toss tone); every other locale reads English —
// same policy as the personal report.
const ORG_REPORT_STRINGS = {
  en: {
    subjectSaved: (org: string, v: string) => `${org} saved ${v} on LLM tokens last week`,
    subjectNone: (org: string) => `${org} — weekly LLM cache report`,
    title: "Weekly team cache report",
    sub: (org: string) => `${org} · last 7 days · all workspace keys · list-price estimates`,
    saved: "SAVED BY CACHING",
    leaking: "STILL LEAKING",
    line: (req: string, hit: string, members: number) =>
      `<strong style="color:#080808;">${req}</strong> requests · hit rate <strong style="color:#080808;">${hit}</strong> · ${members} active member${members === 1 ? "" : "s"} · top model`,
    shared: (v: string) =>
      `Teammates reusing each other's warmed cache saved <strong style="color:#00a51b;">${v}</strong> on top — that's the shared-cache effect of routing everyone through the workspace provider account.`,
    keepalive: (n: number, cost: string) => `The Cache Warmer sent ${n} warm-up pings (${cost}) across the workspace.`,
    breaker: (rate: string) => `⚠️ The prompt prefix changed on ${rate} of requests — usually a timestamp or random ID in a system prompt. One-line fixes here unlock the biggest savings.`,
    cta: "Open the team dashboard",
    footer: "Sent to workspace owners and admins, once a week, only for weeks with traffic.",
    unsub: "Unsubscribe with one click",
  },
  ko: {
    subjectSaved: (org: string, v: string) => `${org} 팀이 지난주 LLM 비용 ${v}를 아꼈어요`,
    subjectNone: (org: string) => `${org} — 주간 캐시 리포트가 도착했어요`,
    title: "주간 팀 캐시 리포트",
    sub: (org: string) => `${org} · 최근 7일 · 워크스페이스 전체 키 · 정가 기준 추정치예요`,
    saved: "캐싱으로 절감",
    leaking: "아직 새는 돈",
    line: (req: string, hit: string, members: number) =>
      `요청 <strong style="color:#080808;">${req}</strong>회 · 히트율 <strong style="color:#080808;">${hit}</strong> · 활동 멤버 ${members}명 · 주 사용 모델`,
    shared: (v: string) =>
      `팀원이 서로 데워 놓은 캐시를 읽어서 <strong style="color:#00a51b;">${v}</strong>를 더 아꼈어요 — 워크스페이스 공용 계정으로 트래픽이 모여서 생기는 공유 캐시 효과예요.`,
    keepalive: (n: number, cost: string) => `캐시 워머가 워크스페이스 전체에 연장 신호를 ${n}회 보냈어요(${cost}).`,
    breaker: (rate: string) => `⚠️ 요청의 ${rate}에서 프롬프트 앞부분이 바뀌었어요 — 시스템 프롬프트 속 타임스탬프나 랜덤 ID가 원인일 가능성이 커요. 한 줄만 고치면 가장 큰 절감이 열려요.`,
    cta: "팀 대시보드 열기",
    footer: "트래픽이 있었던 주에만, 워크스페이스 소유자·관리자에게 일주일에 한 번 보내드려요.",
    unsub: "클릭 한 번으로 수신 거부",
  },
};

export interface OrgWeeklyStats {
  orgId: number;
  orgName: string;
  requests: number;
  activeMembers: number;
  savedUsd: number;
  wastedUsd: number;
  sharedSavedUsd: number;
  hitRate: number;
  keepalivePings: number;
  keepaliveCostUsd: number;
  breakerRate: number;
  topModel: string;
}

export function renderOrgWeeklyReportHtml(
  s: OrgWeeklyStats,
  locale: string,
  unsubUrl?: string
): { subject: string; html: string } {
  const t = locale === "ko" ? ORG_REPORT_STRINGS.ko : ORG_REPORT_STRINGS.en;
  const org = escapeHtml(s.orgName);
  const subject = s.savedUsd >= 0.01 ? t.subjectSaved(s.orgName, usd(s.savedUsd)) : t.subjectNone(s.orgName);

  const sharedBlock =
    s.sharedSavedUsd >= 0.01
      ? `<tr><td style="padding:0 0 16px;font-size:14px;color:#5a5a5a;line-height:1.6;">${t.shared(usd(s.sharedSavedUsd))}</td></tr>`
      : "";
  const keepaliveBlock =
    s.keepalivePings > 0
      ? `<tr><td style="padding:0 0 16px;font-size:14px;color:#5a5a5a;">${t.keepalive(s.keepalivePings, usd(s.keepaliveCostUsd))}</td></tr>`
      : "";
  const breakerBlock =
    s.breakerRate >= 0.3
      ? `<tr><td style="padding:16px 24px;background:#fff8e8;border:1px solid #ffae13;border-radius:8px;font-size:14px;color:#080808;">
           ${t.breaker(pct(s.breakerRate))}
         </td></tr><tr><td style="height:16px;"></td></tr>`
      : "";

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f7f7f7;font-family:Inter,-apple-system,Segoe UI,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #d8d8d8;border-radius:8px;">
  <tr><td style="padding:28px 32px 0;">
    <span style="font-size:18px;font-weight:600;color:#080808;">caching</span><span style="font-size:18px;font-weight:600;color:#898989;">.ai</span>
  </td></tr>
  <tr><td style="padding:20px 32px 0;font-size:22px;font-weight:600;color:#080808;">${t.title}</td></tr>
  <tr><td style="padding:8px 32px 24px;font-size:14px;color:#5a5a5a;">${t.sub(org)}</td></tr>
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
    ${t.line(s.requests.toLocaleString(), pct(s.hitRate), s.activeMembers)} <span style="font-family:Inconsolata,monospace;">${escapeHtml(s.topModel) || "—"}</span>
  </td></tr>
  <tr><td style="padding:0 32px;"><table role="presentation" width="100%">${sharedBlock}${keepaliveBlock}</table></td></tr>
  <tr><td style="padding:0 32px;">${breakerBlock ? `<table role="presentation" width="100%">${breakerBlock}</table>` : ""}</td></tr>
  <tr><td style="padding:8px 32px 28px;">
    <a href="${BASE_URL}/console/org" style="display:inline-block;background:#080808;color:#ffffff;text-decoration:none;font-size:15px;font-weight:500;padding:12px 20px;border-radius:4px;">${t.cta}</a>
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
 * Cross-member shared-cache savings: cache reads whose prefix head was most
 * recently written by a DIFFERENT member's key. Estimated from prefix head
 * hashes over the window; bounded work (window-scoped, org keys only).
 */
async function sharedSavedUsd(deps: ReportDeps, orgId: number, sinceDays: number): Promise<number> {
  const { rows } = await deps.pool.query(
    `WITH org_rows AS (
       SELECT rl.id, rl.ts, k.user_id, rl.saved_usd,
              rl.cache_read_tokens, rl.cache_creation_tokens,
              rl.prefix_block_hashes->0->>'hash' AS head
         FROM request_logs rl
         JOIN api_keys k ON k.id = rl.api_key_id
        WHERE k.org_id = $1 AND rl.ts > now() - ($2 || ' days')::interval
          AND rl.prefix_block_hashes IS NOT NULL AND NOT rl.is_keepalive
     )
     SELECT COALESCE(sum(saved_usd), 0)::float AS shared
       FROM (
         SELECT r.saved_usd,
                lag(r.user_id) OVER (PARTITION BY r.head ORDER BY r.ts, r.id) AS prev_user,
                r.user_id, r.cache_read_tokens
           FROM org_rows r
       ) w
      WHERE w.cache_read_tokens > 0 AND w.prev_user IS NOT NULL AND w.prev_user <> w.user_id`,
    [orgId, sinceDays]
  );
  return rows[0]?.shared ?? 0;
}

export async function orgWeeklyStatsFor(deps: ReportDeps, sinceDays = 7): Promise<OrgWeeklyStats[]> {
  const { rows } = await deps.pool.query(
    `SELECT o.id AS org_id, o.name AS org_name,
            count(*) FILTER (WHERE NOT rl.is_keepalive)::int AS requests,
            count(DISTINCT k.user_id) FILTER (WHERE NOT rl.is_keepalive)::int AS members,
            COALESCE(sum(rl.saved_usd) FILTER (WHERE NOT rl.is_keepalive), 0)::float AS saved,
            COALESCE(sum(rl.cache_read_tokens), 0)::bigint AS cache_read,
            COALESCE(sum(rl.input_tokens), 0)::bigint AS input,
            COALESCE(sum(rl.cache_creation_tokens), 0)::bigint AS cache_creation,
            count(*) FILTER (WHERE rl.is_keepalive)::int AS ka_pings,
            COALESCE(sum(rl.cost_usd) FILTER (WHERE rl.is_keepalive), 0)::float AS ka_cost,
            count(*) FILTER (WHERE rl.cache_breaker_detected)::int AS breakers,
            (array_agg(rl.model ORDER BY rl.ts DESC))[1] AS top_model,
            (array_agg(rl.provider ORDER BY rl.ts DESC))[1] AS last_provider,
            COALESCE(sum(CASE WHEN rl.cache_read_tokens = 0 AND NOT rl.is_keepalive
              THEN rl.input_tokens ELSE 0 END), 0)::bigint AS uncached_input
       FROM request_logs rl
       JOIN api_keys k ON k.id = rl.api_key_id
       JOIN organizations o ON o.id = k.org_id
      WHERE rl.ts > now() - ($1 || ' days')::interval AND o.deleted_at IS NULL
      GROUP BY o.id, o.name
     HAVING count(*) FILTER (WHERE NOT rl.is_keepalive) > 0`,
    [sinceDays]
  );

  const out: OrgWeeklyStats[] = [];
  for (const r of rows) {
    const denom = Number(r.input) + Number(r.cache_read) + Number(r.cache_creation);
    out.push({
      orgId: r.org_id,
      orgName: r.org_name,
      requests: r.requests,
      activeMembers: r.members,
      savedUsd: r.saved,
      wastedUsd:
        Number(r.uncached_input) *
        wastePerInputTokenUsd((r.last_provider ?? "anthropic") as Provider, r.top_model ?? ""),
      sharedSavedUsd: await sharedSavedUsd(deps, r.org_id, sinceDays),
      hitRate: denom > 0 ? Number(r.cache_read) / denom : 0,
      keepalivePings: r.ka_pings,
      keepaliveCostUsd: r.ka_cost,
      breakerRate: r.requests > 0 ? r.breakers / r.requests : 0,
      topModel: r.top_model ?? "",
    });
  }
  return out;
}

/** Mondays (UTC, from 09:00) unless force; deduped per admin per ISO week. */
export async function orgWeeklyReportSweep(deps: ReportDeps, force = false): Promise<number> {
  const now = deps.now ? deps.now() : new Date();
  if (!force && !(now.getUTCDay() === 1 && now.getUTCHours() >= 9)) return 0;

  const week = isoWeekKey(now);
  const stats = await orgWeeklyStatsFor(deps);
  let sent = 0;
  for (const s of stats) {
    const { rows: admins } = await deps.pool.query(
      `SELECT id, email, COALESCE(locale, 'en') AS locale FROM users
        WHERE org_id = $1 AND org_role IN ('owner', 'admin') AND report_opt_out = false`,
      [s.orgId]
    );
    for (const a of admins) {
      const claimed = await deps.pool.query(
        `INSERT INTO email_log(user_id, kind, period_key) VALUES($1,'org_weekly',$2)
         ON CONFLICT DO NOTHING RETURNING id`,
        [a.id, `${s.orgId}:${week}`]
      );
      if (!claimed.rows[0]) continue;
      const unsub = deps.unsubscribeSecret ? unsubscribeUrl(a.id, deps.unsubscribeSecret) : undefined;
      const { subject, html } = renderOrgWeeklyReportHtml(s, a.locale, unsub);
      const ok = await sendViaResend(deps, a.email, subject, html, unsub);
      if (ok) sent++;
      else await deps.pool.query("DELETE FROM email_log WHERE id=$1", [claimed.rows[0].id]);
    }
  }
  return sent;
}

// ---------- budget warn alerts (80% / 100%) ----------

const BUDGET_STRINGS = {
  en: {
    subject: (org: string, pctHit: number) => `${org} — a workspace budget crossed ${pctHit}%`,
    title: (pctHit: number) => `Budget at ${pctHit}%`,
    body: (scopeLabel: string, spent: string, limit: string, action: string) =>
      `This month's spend for <strong>${scopeLabel}</strong> reached <strong>${spent}</strong> of the <strong>${limit}</strong> budget.` +
      (action === "block"
        ? " Once the limit is reached, requests under this budget are declined until the new month or a limit change."
        : " This budget only alerts — traffic keeps flowing."),
    cta: "Review budgets",
    footer: "Sent to workspace owners and admins, once per threshold per month.",
  },
  ko: {
    subject: (org: string, pctHit: number) => `${org} — 워크스페이스 예산이 ${pctHit}%를 넘었어요`,
    title: (pctHit: number) => `예산 ${pctHit}% 도달`,
    body: (scopeLabel: string, spent: string, limit: string, action: string) =>
      `이번 달 <strong>${scopeLabel}</strong> 지출이 예산 <strong>${limit}</strong> 중 <strong>${spent}</strong>에 도달했어요.` +
      (action === "block"
        ? " 한도에 도달하면 이 예산 범위의 요청은 다음 달이 되거나 한도를 바꿀 때까지 차단돼요."
        : " 이 예산은 알림만 보내요 — 트래픽은 계속 흐르고 있어요."),
    cta: "예산 확인하기",
    footer: "임계값마다 한 달에 한 번, 워크스페이스 소유자·관리자에게 보내드려요.",
  },
};

export async function orgBudgetAlertSweep(deps: ReportDeps): Promise<number> {
  const now = deps.now ? deps.now() : new Date();
  const monthStart = `${now.toISOString().slice(0, 7)}-01`;

  // budgets joined with this month's spend for their scope
  const { rows } = await deps.pool.query(
    `SELECT b.id, b.org_id, o.name AS org_name, b.scope, b.action,
            b.monthly_limit_usd::float AS limit_usd,
            d.name AS dept_name, mu.email AS member_email,
            COALESCE((
              SELECT sum(rl.cost_usd)::float
                FROM request_logs rl
                JOIN api_keys k ON k.id = rl.api_key_id
                JOIN users ku ON ku.id = k.user_id
               WHERE k.org_id = b.org_id AND rl.ts >= $1::date
                 AND (b.scope = 'org'
                   OR (b.scope = 'department' AND ku.org_department_id = b.department_id)
                   OR (b.scope = 'member' AND k.user_id = b.member_user_id))
            ), 0) AS spent
       FROM org_budgets b
       JOIN organizations o ON o.id = b.org_id AND o.deleted_at IS NULL
       LEFT JOIN org_departments d ON d.id = b.department_id
       LEFT JOIN users mu ON mu.id = b.member_user_id`,
    [monthStart]
  );

  let sent = 0;
  for (const b of rows) {
    if (b.limit_usd <= 0) continue;
    const ratio = b.spent / b.limit_usd;
    for (const threshold of [100, 80]) {
      if (ratio * 100 < threshold) continue;
      const claimed = await deps.pool.query(
        `INSERT INTO org_budget_alerts(budget_id, month, threshold) VALUES($1,$2::date,$3)
         ON CONFLICT DO NOTHING RETURNING budget_id`,
        [b.id, monthStart, threshold]
      );
      if (!claimed.rows[0]) break; // higher threshold already covers lower ones this month
      const { rows: admins } = await deps.pool.query(
        `SELECT id, email, COALESCE(locale, 'en') AS locale FROM users
          WHERE org_id = $1 AND org_role IN ('owner', 'admin') AND report_opt_out = false`,
        [b.org_id]
      );
      for (const a of admins) {
        const t = a.locale === "ko" ? BUDGET_STRINGS.ko : BUDGET_STRINGS.en;
        const scopeLabel =
          b.scope === "org"
            ? a.locale === "ko" ? "전사 전체" : "the whole workspace"
            : b.scope === "department"
              ? escapeHtml(b.dept_name ?? "")
              : escapeHtml(b.member_email ?? "");
        const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f7f7f7;font-family:Inter,-apple-system,Segoe UI,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #d8d8d8;border-radius:8px;">
  <tr><td style="padding:28px 32px 0;">
    <span style="font-size:18px;font-weight:600;color:#080808;">caching</span><span style="font-size:18px;font-weight:600;color:#898989;">.ai</span>
  </td></tr>
  <tr><td style="padding:20px 32px 0;font-size:22px;font-weight:600;color:#080808;">${t.title(threshold)}</td></tr>
  <tr><td style="padding:16px 32px 0;">
    <div style="padding:16px;background:#fff8e8;border:1px solid #ffae13;border-radius:8px;font-size:14px;color:#080808;line-height:1.7;">
      ${t.body(scopeLabel, usd(b.spent), usd(b.limit_usd), b.action)}
    </div>
  </td></tr>
  <tr><td style="padding:20px 32px 28px;">
    <a href="${BASE_URL}/console/org/policies" style="display:inline-block;background:#080808;color:#ffffff;text-decoration:none;font-size:15px;font-weight:500;padding:12px 20px;border-radius:4px;">${t.cta}</a>
  </td></tr>
  <tr><td style="padding:0 32px 28px;font-size:12px;color:#ababab;line-height:1.6;">${t.footer} · Caching.ai — LLM cache FinOps</td></tr>
</table>
</td></tr></table>
</body></html>`;
        const ok = await sendViaResend(deps, a.email, t.subject(b.org_name, threshold), html);
        if (ok) sent++;
      }
      break; // only the highest crossed threshold per sweep
    }
  }
  return sent;
}

export function startOrgEmailLoops(deps: ReportDeps, intervalMs = 60 * 60 * 1000): NodeJS.Timeout[] {
  const weekly = setInterval(() => {
    orgWeeklyReportSweep(deps).catch((e) => console.error("org weekly report error:", e.message));
  }, intervalMs);
  weekly.unref?.();
  const budget = setInterval(() => {
    orgBudgetAlertSweep(deps).catch((e) => console.error("org budget alert error:", e.message));
  }, 15 * 60 * 1000);
  budget.unref?.();
  return [weekly, budget];
}
