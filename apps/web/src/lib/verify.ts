import { deriveTokenSecret, signSession } from "@caching/shared";
import { sendEmail, verificationEmail } from "@/lib/email";

// Email-verification tokens are HMAC-signed with a subkey derived from
// ENCRYPTION_KEY (shared web+proxy secret) — no DB table needed, 24h expiry.

export function verifySecret(): string {
  const s = process.env.ENCRYPTION_KEY;
  if (!s) throw new Error("ENCRYPTION_KEY is not set");
  return deriveTokenSecret(s); // never reuse the AES key as an HMAC secret
}

export function verifyToken(uid: number): string {
  return signSession({ uid, kind: "verify", exp: Date.now() + 24 * 3600 * 1000 }, verifySecret());
}

export async function sendVerification(uid: number, email: string, locale: string): Promise<void> {
  const base = process.env.PUBLIC_BASE_URL ?? "https://caching.ai";
  const url = `${base}/api/auth/verify?token=${encodeURIComponent(verifyToken(uid))}`;
  const { subject, html } = verificationEmail(locale, url);
  await sendEmail(email, subject, html);
}
