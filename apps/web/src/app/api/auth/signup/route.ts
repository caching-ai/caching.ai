import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { clientIp, rateLimited } from "@/lib/ratelimit";
import { db } from "@/lib/db";
import { sessionCookie } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { sendVerification } from "@/lib/verify";

export async function POST(req: Request) {
  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }
  if (rateLimited(`signup:${clientIp(req)}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many signups from this address. Please try again later." }, { status: 429 });
  }
  const hash = await bcrypt.hash(password, 12);
  const locale = await getLocale();
  try {
    const { rows } = await db().query(
      "INSERT INTO users(email, password_hash, locale) VALUES($1,$2,$3) RETURNING id, email",
      [email.toLowerCase().trim(), hash, locale]
    );
    // fire-and-forget — signup never waits on the mail provider
    void sendVerification(rows[0].id, rows[0].email, locale).catch((e) =>
      console.error("verification email failed:", e?.message)
    );
    const res = NextResponse.json({ ok: true });
    res.cookies.set(sessionCookie(rows[0].id, rows[0].email));
    return res;
  } catch (e: any) {
    if (e?.code === "23505") {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }
    console.error("signup failed:", e?.message);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
