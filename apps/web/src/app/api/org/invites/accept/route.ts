import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sha256Hex } from "@caching/shared";
import { getSession } from "@/lib/auth";
import { audit, wsCookie } from "@/lib/org";

/**
 * Accept an invite. Invites are personal, not bearer links: the signed-in
 * email must match. Atomic — invite locked FOR UPDATE, the org row guards
 * max_members, the user row guards double-enrollment.
 */
export async function POST(req: Request) {
  const sess = await getSession();
  if (!sess) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { token } = await req.json().catch(() => ({}));
  if (typeof token !== "string" || !token.startsWith("oiv_")) {
    return NextResponse.json({ error: "This invite link is not valid." }, { status: 400 });
  }

  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const inv = (
      await client.query(
        `SELECT i.id, i.org_id, i.email, i.role, i.department_id, i.expires_at,
                i.accepted_at, i.revoked_at, o.max_members, o.name AS org_name
           FROM org_invites i
           JOIN organizations o ON o.id = i.org_id AND o.deleted_at IS NULL
          WHERE i.token_hash = $1
          FOR UPDATE OF i`,
        [sha256Hex(token)]
      )
    ).rows[0];
    if (!inv || inv.revoked_at || new Date(inv.expires_at).getTime() < Date.now()) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "This invite has expired or was withdrawn." }, { status: 404 });
    }
    if (inv.email.toLowerCase() !== sess.email.toLowerCase()) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "This invite was sent to a different email address. Sign in with that account." },
        { status: 403 }
      );
    }

    const me = (await client.query("SELECT org_id FROM users WHERE id=$1 FOR UPDATE", [sess.uid])).rows[0];
    if (me?.org_id != null) {
      await client.query("ROLLBACK");
      if (me.org_id === inv.org_id) {
        // idempotent: already a member of exactly this org
        const res = NextResponse.json({ ok: true, orgName: inv.org_name });
        res.cookies.set(wsCookie("org"));
        return res;
      }
      return NextResponse.json({ error: "You already belong to another team workspace." }, { status: 409 });
    }
    if (inv.accepted_at) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "This invite has already been used." }, { status: 409 });
    }

    // member cap under the org row lock
    const orgLock = await client.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [inv.org_id]);
    if (!orgLock.rows[0]) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "This workspace no longer exists." }, { status: 404 });
    }
    const cnt = (await client.query("SELECT count(*)::int AS n FROM users WHERE org_id=$1", [inv.org_id])).rows[0];
    if (cnt.n >= inv.max_members) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "This workspace has reached its member limit." }, { status: 409 });
    }

    await client.query(
      `UPDATE users SET org_id=$2, org_role=$3, org_department_id=$4, org_joined_at=now() WHERE id=$1`,
      [sess.uid, inv.org_id, inv.role, inv.department_id]
    );
    await client.query(
      "UPDATE org_invites SET accepted_at=now(), accepted_by=$2 WHERE id=$1", [inv.id, sess.uid]);
    await client.query("COMMIT");

    await audit(inv.org_id, sess, "invite.accept", sess.email, { role: inv.role });
    const res = NextResponse.json({ ok: true, orgName: inv.org_name });
    res.cookies.set(wsCookie("org"));
    return res;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("invite accept failed:", (e as Error).message);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  } finally {
    client.release();
  }
}
