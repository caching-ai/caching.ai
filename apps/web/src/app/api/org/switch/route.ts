import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { membershipOf, wsCookie } from "@/lib/org";

/** Flip the active workspace. The cookie is a hint — every API re-verifies. */
export async function POST(req: Request) {
  const sess = await getSession();
  if (!sess) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { ws } = await req.json().catch(() => ({}));
  if (ws !== "personal" && ws !== "org") {
    return NextResponse.json({ error: "ws must be 'personal' or 'org'." }, { status: 400 });
  }
  if (ws === "org" && !(await membershipOf(sess.uid))) {
    return NextResponse.json({ error: "You don't belong to a team workspace." }, { status: 403 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(wsCookie(ws));
  return res;
}
