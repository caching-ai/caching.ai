import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { sendVerification, verifySecret } from "@/lib/verify";
import { verifySession } from "@caching/shared";
import { rateLimited } from "@/lib/ratelimit";

/** confirm link from the email */
export async function GET(req: Request) {
  const base = process.env.PUBLIC_BASE_URL ?? "https://caching.ai";
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const payload = verifySession<{ uid: number; kind: string }>(token, verifySecret());
  if (!payload || payload.kind !== "verify") {
    return NextResponse.redirect(`${base}/console?verified=expired`);
  }
  await db().query(
    "UPDATE users SET email_verified_at=COALESCE(email_verified_at, now()) WHERE id=$1",
    [payload.uid]
  );
  return NextResponse.redirect(`${base}/console?verified=1`);
}

/** resend from the console banner */
export async function POST() {
  const sess = await getSession();
  if (!sess) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (rateLimited(`verify-resend:${sess.uid}`, 3, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Please wait before requesting another email." }, { status: 429 });
  }
  const locale = await getLocale();
  await sendVerification(sess.uid, sess.email, locale);
  return NextResponse.json({ ok: true });
}
