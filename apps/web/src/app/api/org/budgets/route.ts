import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit, requireOrgAdmin, requireOrgMember } from "@/lib/org";

/** Budgets with this month's spend per scope, so the UI shows progress. */
export async function GET() {
  const r = await requireOrgMember();
  if ("error" in r) return r.error;
  const { rows } = await db().query(
    `SELECT b.id, b.scope, b.department_id, d.name AS department_name,
            b.member_user_id, mu.email AS member_email,
            b.monthly_limit_usd::float AS monthly_limit_usd, b.action, b.updated_at,
            COALESCE((
              SELECT sum(rl.cost_usd)::float
                FROM request_logs rl
                JOIN api_keys k ON k.id = rl.api_key_id
                JOIN users ku ON ku.id = k.user_id
               WHERE k.org_id = b.org_id AND rl.ts >= date_trunc('month', now() AT TIME ZONE 'UTC')
                 AND (b.scope = 'org'
                   OR (b.scope = 'department' AND ku.org_department_id = b.department_id)
                   OR (b.scope = 'member' AND k.user_id = b.member_user_id))
            ), 0) AS spent_usd
       FROM org_budgets b
       LEFT JOIN org_departments d ON d.id = b.department_id
       LEFT JOIN users mu ON mu.id = b.member_user_id
      WHERE b.org_id = $1
      ORDER BY CASE b.scope WHEN 'org' THEN 0 WHEN 'department' THEN 1 ELSE 2 END, b.id`,
    [r.org.orgId]
  );
  return NextResponse.json({ budgets: rows });
}

export async function PUT(req: Request) {
  const r = await requireOrgAdmin();
  if ("error" in r) return r.error;
  const b = await req.json().catch(() => ({}));
  const scope = b.scope;
  if (!["org", "department", "member"].includes(scope)) {
    return NextResponse.json({ error: "scope must be org, department or member." }, { status: 400 });
  }
  const limit = Number(b.monthlyLimitUsd);
  if (!Number.isFinite(limit) || limit <= 0 || limit > 10_000_000) {
    return NextResponse.json({ error: "Please enter a monthly limit above 0 USD." }, { status: 400 });
  }
  const action = b.action === "block" ? "block" : "warn";

  let departmentId: number | null = null;
  let memberUserId: number | null = null;
  if (scope === "department") {
    departmentId = Number(b.departmentId);
    const d = await db().query(
      "SELECT 1 FROM org_departments WHERE id=$1 AND org_id=$2", [departmentId, r.org.orgId]);
    if (!d.rows[0]) return NextResponse.json({ error: "Unknown department." }, { status: 400 });
  }
  if (scope === "member") {
    memberUserId = Number(b.memberUserId);
    const m = await db().query(
      "SELECT 1 FROM users WHERE id=$1 AND org_id=$2", [memberUserId, r.org.orgId]);
    if (!m.rows[0]) return NextResponse.json({ error: "That member is not in this workspace." }, { status: 400 });
  }

  const conflictTarget =
    scope === "org"
      ? "(org_id) WHERE scope = 'org'"
      : scope === "department"
        ? "(org_id, department_id) WHERE scope = 'department'"
        : "(org_id, member_user_id) WHERE scope = 'member'";
  await db().query(
    `INSERT INTO org_budgets(org_id, scope, department_id, member_user_id, monthly_limit_usd, action, updated_by)
     VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT ${conflictTarget} DO UPDATE SET
        monthly_limit_usd=$5, action=$6, updated_by=$7, updated_at=now()`,
    [r.org.orgId, scope, departmentId, memberUserId, limit, action, r.ws.session.uid]
  );
  await audit(r.org.orgId, r.ws.session, "budget.set", scope, {
    departmentId, memberUserId, monthlyLimitUsd: limit, action,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const r = await requireOrgAdmin();
  if ("error" in r) return r.error;
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "id is required." }, { status: 400 });
  const { rows } = await db().query(
    "DELETE FROM org_budgets WHERE id=$1 AND org_id=$2 RETURNING scope", [id, r.org.orgId]);
  if (!rows[0]) return NextResponse.json({ error: "Budget not found." }, { status: 404 });
  await audit(r.org.orgId, r.ws.session, "budget.delete", rows[0].scope);
  return NextResponse.json({ ok: true });
}
