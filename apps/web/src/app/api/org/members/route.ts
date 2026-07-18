import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit, requireOrgAdmin, requireOrgMember } from "@/lib/org";

/** Member roster (any member may see it — it's a team workspace). */
export async function GET() {
  const r = await requireOrgMember();
  if ("error" in r) return r.error;
  const { rows } = await db().query(
    `SELECT u.id, u.email, u.org_role AS role, u.org_department_id AS department_id,
            d.name AS department_name, u.org_joined_at AS joined_at,
            count(k.id) FILTER (WHERE k.revoked_at IS NULL)::int AS active_keys
       FROM users u
       LEFT JOIN org_departments d ON d.id = u.org_department_id
       LEFT JOIN api_keys k ON k.user_id = u.id AND k.org_id = u.org_id
      WHERE u.org_id = $1
      GROUP BY u.id, u.email, u.org_role, u.org_department_id, d.name, u.org_joined_at
      ORDER BY u.org_joined_at`,
    [r.org.orgId]
  );
  return NextResponse.json({ members: rows, me: r.ws.session.uid, role: r.org.role });
}

/** Change a member's role or department (admin; owner supremacy rules). */
export async function PATCH(req: Request) {
  const r = await requireOrgAdmin();
  if ("error" in r) return r.error;
  const { userId, role, departmentId } = await req.json().catch(() => ({}));
  const uid = Number(userId);
  if (!Number.isInteger(uid)) return NextResponse.json({ error: "userId is required." }, { status: 400 });

  const { rows } = await db().query(
    "SELECT id, email, org_role FROM users WHERE id=$1 AND org_id=$2", [uid, r.org.orgId]);
  const target = rows[0];
  if (!target) return NextResponse.json({ error: "That member is not in this workspace." }, { status: 404 });
  if (target.org_role === "owner") {
    return NextResponse.json({ error: "The owner's role can't be changed here." }, { status: 403 });
  }

  if (role !== undefined) {
    if (role !== "admin" && role !== "member") {
      return NextResponse.json({ error: "role must be 'admin' or 'member'." }, { status: 400 });
    }
    // only the owner may promote/demote admins
    if (r.org.role !== "owner" && (target.org_role === "admin" || role === "admin")) {
      return NextResponse.json({ error: "Only the owner can change admin roles." }, { status: 403 });
    }
    await db().query("UPDATE users SET org_role=$2 WHERE id=$1 AND org_id=$3", [uid, role, r.org.orgId]);
    await audit(r.org.orgId, r.ws.session, "member.role", target.email, { from: target.org_role, to: role });
  }

  if (departmentId !== undefined) {
    const dept = departmentId === null ? null : Number(departmentId);
    if (dept !== null) {
      const d = await db().query(
        "SELECT 1 FROM org_departments WHERE id=$1 AND org_id=$2", [dept, r.org.orgId]);
      if (!d.rows[0]) return NextResponse.json({ error: "Unknown department." }, { status: 400 });
    }
    await db().query(
      "UPDATE users SET org_department_id=$2 WHERE id=$1 AND org_id=$3", [uid, dept, r.org.orgId]);
    await audit(r.org.orgId, r.ws.session, "member.department", target.email, { departmentId: dept });
  }

  return NextResponse.json({ ok: true });
}

/**
 * Remove a member (admin) or leave the workspace yourself (?self=1). The
 * departing member keeps their personal account untouched; their org ck_
 * keys are revoked immediately so they can't keep spending the org's
 * provider account.
 */
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const self = url.searchParams.get("self") === "1";

  const r = self ? await requireOrgMember() : await requireOrgAdmin();
  if ("error" in r) return r.error;
  const uid = self ? r.ws.session.uid : Number(url.searchParams.get("userId"));
  if (!Number.isInteger(uid)) return NextResponse.json({ error: "userId is required." }, { status: 400 });

  const { rows } = await db().query(
    "SELECT id, email, org_role FROM users WHERE id=$1 AND org_id=$2", [uid, r.org.orgId]);
  const target = rows[0];
  if (!target) return NextResponse.json({ error: "That member is not in this workspace." }, { status: 404 });
  if (target.org_role === "owner") {
    return NextResponse.json(
      { error: "The owner can't leave — delete the workspace or contact support to transfer it." },
      { status: 403 }
    );
  }
  if (!self && target.org_role === "admin" && r.org.role !== "owner") {
    return NextResponse.json({ error: "Only the owner can remove an admin." }, { status: 403 });
  }

  const client = await db().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE api_keys SET revoked_at=COALESCE(revoked_at, now()) WHERE org_id=$1 AND user_id=$2",
      [r.org.orgId, uid]
    );
    await client.query(
      "UPDATE users SET org_id=NULL, org_role=NULL, org_department_id=NULL, org_joined_at=NULL WHERE id=$1",
      [uid]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("member remove failed:", (e as Error).message);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  } finally {
    client.release();
  }
  await audit(r.org.orgId, r.ws.session, self ? "member.leave" : "member.remove", target.email);
  return NextResponse.json({ ok: true });
}
