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
