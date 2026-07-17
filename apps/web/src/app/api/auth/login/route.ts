import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { sessionCookie } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { clientIp, rateLimited } from "@/lib/ratelimit";

export async function POST(req: Request) {
  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }
  const normalized = String(email).toLowerCase().trim();
  if (
    rateLimited(`login:${clientIp(req)}`, 30, 15 * 60 * 1000) ||
    rateLimited(`login:${normalized}`, 10, 15 * 60 * 1000)
  ) {
    return NextResponse.json({ error: "Too many attempts. Please wait a few minutes." }, { status: 429 });
  }
  const { rows } = await db().query("SELECT id, email, password_hash FROM users WHERE email=$1", [
    normalized,
  ]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
  }
  // remember the user's language for localized report emails
  void db()
    .query("UPDATE users SET locale=$2 WHERE id=$1", [user.id, await getLocale()])
    .catch(() => {});
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie(user.id, user.email));
  return res;
}
