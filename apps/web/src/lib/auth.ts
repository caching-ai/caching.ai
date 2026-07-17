import { cookies } from "next/headers";
import { verifySession, signSession } from "@caching/shared";

const COOKIE = "caching_session";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return s;
}

export interface Session {
  uid: number;
  email: string;
  exp: number;
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  return verifySession<Session>(token, secret());
}

export function sessionCookie(uid: number, email: string) {
  const exp = Date.now() + 30 * 24 * 3600 * 1000;
  const token = signSession({ uid, email, exp }, secret());
  return {
    name: COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 30 * 24 * 3600,
  };
}

export function clearedCookie() {
  return { name: COOKIE, value: "", path: "/", maxAge: 0 };
}
