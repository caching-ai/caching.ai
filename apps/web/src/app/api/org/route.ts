import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, getWorkspace, membershipOf, requireOrgAdmin, wsCookie } from "@/lib/org";
import { clientIp, rateLimited } from "@/lib/ratelimit";

/** Current membership + active workspace (drives the switcher and org pages). */
export async function GET() {
  const ws = await getWorkspace();
  if (!ws) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  let members = 0;
  if (ws.memberOf) {
    const { rows } = await db().query("SELECT count(*)::int AS n FROM users WHERE org_id=$1", [
      ws.memberOf.orgId,
    ]);
    members = rows[0]?.n ?? 0;
  }
  return NextResponse.json({
    active: ws.org ? "org" : "personal",
    org: ws.memberOf
      ? { id: ws.memberOf.orgId, name: ws.memberOf.orgName, role: ws.memberOf.role, members,
          billingLocked: ws.memberOf.billingLocked }
      : null,
  });
}

/** Create an org — the creator becomes its first owner, atomically. */
export async function POST(req: Request) {
  const sess = await getSession();
  if (!sess) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (rateLimited(`org-create:${clientIp(req)}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }
  const { name } = await req.json().catch(() => ({}));
  const orgName = String(name ?? "").trim().slice(0, 80);
  if (orgName.length < 2) {
    return NextResponse.json({ error: "Please enter a workspace name (2+ characters)." }, { status: 400 });
  }

  const client = await db().connect();
  try {
    await client.query("BEGIN");
    // lock the user row so concurrent create/accept can't double-enroll
    const u = await client.query("SELECT org_id FROM users WHERE id=$1 FOR UPDATE", [sess.uid]);
    if (u.rows[0]?.org_id != null) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "You already belong to a team workspace." }, { status: 409 });
    }
    const locale = (await client.query("SELECT locale FROM users WHERE id=$1", [sess.uid])).rows[0]?.locale ?? "en";
    const org = await client.query(
      "INSERT INTO organizations(name, owner_user_id, locale) VALUES($1,$2,$3) RETURNING id",
      [orgName, sess.uid, locale]
    );
    await client.query(
      "UPDATE users SET org_id=$2, org_role='owner', org_joined_at=now() WHERE id=$1",
      [sess.uid, org.rows[0].id]
    );
    await client.query("COMMIT");
    await audit(org.rows[0].id, sess, "org.create", orgName);
    const res = NextResponse.json({ ok: true, id: org.rows[0].id });
    res.cookies.set(wsCookie("org")); // land straight in the new workspace
    return res;
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    if (e?.code === "23505") {
      return NextResponse.json({ error: "You already own a workspace." }, { status: 409 });
    }
    console.error("org create failed:", e?.message);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  } finally {
    client.release();
  }
}

/** Rename (admin). */
export async function PATCH(req: Request) {
  const r = await requireOrgAdmin();
  if ("error" in r) return r.error;
  const { name } = await req.json().catch(() => ({}));
  const orgName = String(name ?? "").trim().slice(0, 80);
  if (orgName.length < 2) {
    return NextResponse.json({ error: "Please enter a workspace name (2+ characters)." }, { status: 400 });
  }
  await db().query("UPDATE organizations SET name=$2 WHERE id=$1", [r.org.orgId, orgName]);
  await audit(r.org.orgId, r.ws.session, "org.rename", orgName, { from: r.org.orgName });
  return NextResponse.json({ ok: true });
}

/**
 * Soft-delete (owner only): detaches every member, revokes org ck_ keys, and
 * keeps financial/audit rows intact. Blocked while fees are outstanding.
 */
export async function DELETE() {
  const r = await requireOrgAdmin();
  if ("error" in r) return r.error;
  if (r.org.role !== "owner") {
    return NextResponse.json({ error: "Only the workspace owner can delete it." }, { status: 403 });
  }
  const outstanding = await db().query(
    `SELECT 1 FROM org_billing_periods
      WHERE org_id=$1 AND status IN ('charge_failed','no_payment_method','accruing')
        AND fee_usd > 0 AND period_end < now()::date LIMIT 1`,
    [r.org.orgId]
  );
  if (outstanding.rows[0]) {
    return NextResponse.json(
      { error: "There are unsettled fees on this workspace. Settle billing first." },
      { status: 409 }
    );
  }
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE api_keys SET revoked_at=COALESCE(revoked_at, now()) WHERE org_id=$1", [r.org.orgId]);
    await client.query(
      "UPDATE users SET org_id=NULL, org_role=NULL, org_department_id=NULL, org_joined_at=NULL WHERE org_id=$1",
      [r.org.orgId]
    );
    await client.query("UPDATE organizations SET deleted_at=now() WHERE id=$1", [r.org.orgId]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("org delete failed:", (e as Error).message);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  } finally {
    client.release();
  }
  await audit(r.org.orgId, r.ws.session, "org.delete", r.org.orgName);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(wsCookie("personal"));
  return res;
}
