import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { sessionCookie } from "@/lib/auth";

export async function GET(req: Request) {
  const base = process.env.PUBLIC_BASE_URL ?? "https://caching.ai";
  const fail = () => NextResponse.redirect(`${base}/login?error=google`);

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail();

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const expectedState = jar.get("g_state")?.value;
  if (!code || !state || !expectedState || state !== expectedState) return fail();

  // exchange the code directly with Google over TLS — the id_token comes from
  // the token endpoint itself, so decoding its payload without a separate
  // signature check is safe here.
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${base}/api/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    console.error("google token exchange failed:", tokenRes.status);
    return fail();
  }
  const tokens = await tokenRes.json();
  const idToken: string | undefined = tokens.id_token;
  if (!idToken) return fail();

  let email: string | undefined;
  let verified = false;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
    if (payload.aud === clientId && payload.iss?.includes("accounts.google.com")) {
      email = payload.email?.toLowerCase();
      verified = payload.email_verified === true || payload.email_verified === "true";
    }
  } catch {
    return fail();
  }
  if (!email || !verified) return fail();

  // find-or-create; Google-only accounts get an unusable random password.
  // Google already verified the address, so mark it verified right away.
  const pool = db();
  let user = (await pool.query("SELECT id, email FROM users WHERE email=$1", [email])).rows[0];
  if (!user) {
    const placeholder = await bcrypt.hash(randomBytes(32).toString("hex"), 12);
    user = (
      await pool.query(
        "INSERT INTO users(email, password_hash, email_verified_at) VALUES($1,$2,now()) RETURNING id, email",
        [email, placeholder]
      )
    ).rows[0];
  } else {
    await pool.query(
      "UPDATE users SET email_verified_at=COALESCE(email_verified_at, now()) WHERE id=$1",
      [user.id]
    );
  }

  const res = NextResponse.redirect(`${base}/console`);
  res.cookies.set(sessionCookie(user.id, user.email));
  res.cookies.set({ name: "g_state", value: "", path: "/", maxAge: 0 });
  return res;
}
