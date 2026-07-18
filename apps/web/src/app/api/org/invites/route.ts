import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit, requireOrgAdmin } from "@/lib/org";
import { createOrgInvite } from "@/lib/orgInvite";
import { clientIp, rateLimited } from "@/lib/ratelimit";

const MAX_BATCH = 100;

export async function GET() {
  const r = await requireOrgAdmin();
  if ("error" in r) return r.error;
  const { rows } = await db().query(
    `SELECT i.id, i.email, i.role, i.department_id, d.name AS department_name,
            i.created_at, i.expires_at
       FROM org_invites i
       LEFT JOIN org_departments d ON d.id = i.department_id
      WHERE i.org_id = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
        AND i.expires_at > now()
      ORDER BY i.created_at DESC`,
    [r.org.orgId]
  );
  return NextResponse.json({ invites: rows });
}

/** Invite up to 100 emails; re-inviting refreshes token+expiry. Mails go out
 * per address with individual status so one bad address never blocks a batch. */
export async function POST(req: Request) {
  const r = await requireOrgAdmin();
  if ("error" in r) return r.error;
  if (rateLimited(`org-invite:${r.org.orgId}:${clientIp(req)}`, 20, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many invites right now. Please try again later." }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  const emails: string[] = Array.isArray(body.emails) ? body.emails : [];
  const role = body.role === "admin" ? "admin" : "member";
  if (role === "admin" && r.org.role !== "owner") {
    return NextResponse.json({ error: "Only the owner can invite admins." }, { status: 403 });
  }
  const departmentId = body.departmentId == null ? null : Number(body.departmentId);
  if (!emails.length || emails.length > MAX_BATCH) {
    return NextResponse.json({ error: `Provide 1–${MAX_BATCH} email addresses.` }, { status: 400 });
  }
  if (departmentId !== null) {
    const d = await db().query(
      "SELECT 1 FROM org_departments WHERE id=$1 AND org_id=$2", [departmentId, r.org.orgId]);
    if (!d.rows[0]) return NextResponse.json({ error: "Unknown department." }, { status: 400 });
  }

  const inviterLocale =
    (await db().query("SELECT locale FROM users WHERE id=$1", [r.ws.session.uid])).rows[0]?.locale ?? "en";

  const results: { email: string; status: string }[] = [];
  for (const raw of emails) {
    const status = await createOrgInvite({
      orgId: r.org.orgId,
      orgName: r.org.orgName,
      inviter: r.ws.session,
      inviterLocale,
      email: String(raw ?? ""),
      role,
      departmentId,
    });
    results.push({ email: String(raw ?? "").toLowerCase().trim() || String(raw), status });
  }
  await audit(r.org.orgId, r.ws.session, "invite.create", "", {
    invited: results.filter((x) => x.status === "invited").map((x) => x.email), role,
  });
  return NextResponse.json({ results });
}

export async function DELETE(req: Request) {
  const r = await requireOrgAdmin();
  if ("error" in r) return r.error;
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "id is required." }, { status: 400 });
  const { rows } = await db().query(
    `UPDATE org_invites SET revoked_at=now()
      WHERE id=$1 AND org_id=$2 AND accepted_at IS NULL AND revoked_at IS NULL
      RETURNING email`,
    [id, r.org.orgId]
  );
  if (!rows[0]) return NextResponse.json({ error: "Invite not found." }, { status: 404 });
  await audit(r.org.orgId, r.ws.session, "invite.revoke", rows[0].email);
  return NextResponse.json({ ok: true });
}
