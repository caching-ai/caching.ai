// Transactional email via Resend REST (no SDK dependency, same pattern as the
// proxy's report sender). Missing RESEND_API_KEY degrades to a silent no-op so
// signup never breaks on a config gap.

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY not set — email not sent:", subject);
    return false;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM ?? "Caching.ai <hello@caching.ai>", to: [to], subject, html }),
  });
  if (!res.ok) {
    console.error("resend send failed:", res.status, (await res.text()).slice(0, 200));
    return false;
  }
  return true;
}

const VERIFY_STRINGS = {
  en: {
    subject: "Verify your email — Caching.ai",
    title: "One click to verify",
    body: "Confirm this is your email address and your account is all set.",
    cta: "Verify my email",
    ignore: "Didn't create a Caching.ai account? You can safely ignore this email.",
  },
  ko: {
    subject: "이메일 인증 한 번만 해주세요 — Caching.ai",
    title: "클릭 한 번이면 끝나요",
    body: "이 이메일이 본인 주소가 맞는지 확인해 주세요. 그럼 계정 준비 끝이에요.",
    cta: "이메일 인증하기",
    ignore: "Caching.ai에 가입한 적이 없다면 이 메일은 무시하셔도 돼요.",
  },
};

export function verificationEmail(locale: string, verifyUrl: string): { subject: string; html: string } {
  const t = locale === "ko" ? VERIFY_STRINGS.ko : VERIFY_STRINGS.en;
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f7f7f7;font-family:Inter,-apple-system,Segoe UI,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #d8d8d8;border-radius:8px;">
  <tr><td style="padding:28px 32px 0;">
    <span style="font-size:18px;font-weight:600;color:#080808;">caching</span><span style="font-size:18px;font-weight:600;color:#898989;">.ai</span>
  </td></tr>
  <tr><td style="padding:20px 32px 0;font-size:22px;font-weight:600;color:#080808;">${t.title}</td></tr>
  <tr><td style="padding:8px 32px 20px;font-size:14px;color:#5a5a5a;line-height:1.6;">${t.body}</td></tr>
  <tr><td style="padding:0 32px 28px;">
    <a href="${verifyUrl}" style="display:inline-block;background:#080808;color:#ffffff;text-decoration:none;font-size:15px;font-weight:500;padding:12px 20px;border-radius:4px;">${t.cta}</a>
  </td></tr>
  <tr><td style="padding:0 32px 28px;font-size:12px;color:#ababab;line-height:1.6;">${t.ignore}</td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { subject: t.subject, html };
}

const ORG_INVITE_STRINGS = {
  en: {
    subject: (org: string) => `You're invited to join ${org} on Caching.ai`,
    title: (org: string) => `Join ${org}`,
    body: (inviter: string, org: string) =>
      `<strong>${inviter}</strong> invited you to the <strong>${org}</strong> team workspace on Caching.ai — ` +
      `shared provider keys, shared warm caches, and team-wide savings reports.`,
    cta: "Accept the invite",
    note: "The invite works only for this email address and expires in 7 days.",
    ignore: "Not expecting this? You can safely ignore this email.",
  },
  ko: {
    subject: (org: string) => `${org} 팀 워크스페이스에 초대됐어요 — Caching.ai`,
    title: (org: string) => `${org}에 합류하기`,
    body: (inviter: string, org: string) =>
      `<strong>${inviter}</strong>님이 Caching.ai의 <strong>${org}</strong> 팀 워크스페이스에 초대했어요 — ` +
      `프로바이더 키를 팀이 함께 쓰고, 캐시도 함께 데우고, 절감 리포트도 팀 단위로 받아요.`,
    cta: "초대 수락하기",
    note: "이 초대는 이 이메일 주소로만 쓸 수 있고 7일 뒤에 만료돼요.",
    ignore: "기대하지 않은 메일이라면 무시하셔도 돼요.",
  },
};

export function orgInviteEmail(
  locale: string, orgName: string, inviterEmail: string, joinUrl: string
): { subject: string; html: string } {
  const t = locale === "ko" ? ORG_INVITE_STRINGS.ko : ORG_INVITE_STRINGS.en;
  const esc = (v: string) =>
    v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const org = esc(orgName);
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f7f7f7;font-family:Inter,-apple-system,Segoe UI,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #d8d8d8;border-radius:8px;">
  <tr><td style="padding:28px 32px 0;">
    <span style="font-size:18px;font-weight:600;color:#080808;">caching</span><span style="font-size:18px;font-weight:600;color:#898989;">.ai</span>
  </td></tr>
  <tr><td style="padding:20px 32px 0;font-size:22px;font-weight:600;color:#080808;">${t.title(org)}</td></tr>
  <tr><td style="padding:8px 32px 20px;font-size:14px;color:#5a5a5a;line-height:1.6;">${t.body(esc(inviterEmail), org)}</td></tr>
  <tr><td style="padding:0 32px 20px;">
    <a href="${joinUrl}" style="display:inline-block;background:#080808;color:#ffffff;text-decoration:none;font-size:15px;font-weight:500;padding:12px 20px;border-radius:4px;">${t.cta}</a>
  </td></tr>
  <tr><td style="padding:0 32px 8px;font-size:12px;color:#ababab;line-height:1.6;">${t.note}</td></tr>
  <tr><td style="padding:0 32px 28px;font-size:12px;color:#ababab;line-height:1.6;">${t.ignore}</td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { subject: t.subject(orgName), html };
}
