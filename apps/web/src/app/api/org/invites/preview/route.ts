import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sha256Hex } from "@caching/shared";
import { getSession } from "@/lib/auth";

/** Who is this invite from and does it match my signed-in email? */
export async function GET(req: NextRequest) {
  const sess = await getSession();
  if (!sess) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!token.startsWith("oiv_")) {
    return NextResponse.json({ error: "This invite link is not valid." }, { status: 400 });
  }
  const { rows } = await db().query(
    `SELECT i.email, i.role, o.name AS org_name, i.expires_at,
            (i.accepted_at IS NOT NULL) AS accepted, (i.revoked_at IS NOT NULL) AS revoked
       FROM org_invites i JOIN organizations o ON o.id = i.org_id
      WHERE i.token_hash = $1 AND o.deleted_at IS NULL`,
    [sha256Hex(token)]
  );
  const inv = rows[0];
  if (!inv || inv.revoked || new Date(inv.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "This invite has expired or was withdrawn." }, { status: 404 });
  }
  return NextResponse.json({
    orgName: inv.org_name,
    email: inv.email,
    role: inv.role,
    accepted: inv.accepted,
    emailMatches: inv.email.toLowerCase() === sess.email.toLowerCase(),
  });
}
