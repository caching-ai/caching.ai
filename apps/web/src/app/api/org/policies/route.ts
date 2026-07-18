import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit, requireOrgAdmin, requireOrgMember } from "@/lib/org";

// Cache policy tiers. A policy row's NULL columns inherit from the broader
// tier at request time; enforce=false rows only seed defaults for new keys.
const SETTING_KEYS = [
  "auto_cache_control",
  "keepalive_enabled",
  "keepalive_budget_usd_daily",
  "anthropic_cache_ttl",
  "cache_tuning_mode",
] as const;

export async function GET() {
  const r = await requireOrgMember();
  if ("error" in r) return r.error;
  const { rows } = await db().query(
    `SELECT p.id, p.scope, p.department_id, d.name AS department_name,
            p.member_user_id, mu.email AS member_email,
            p.auto_cache_control, p.keepalive_enabled,
            p.keepalive_budget_usd_daily::float AS keepalive_budget_usd_daily,
            p.anthropic_cache_ttl, p.cache_tuning_mode, p.enforce, p.updated_at
       FROM org_cache_policies p
       LEFT JOIN org_departments d ON d.id = p.department_id
       LEFT JOIN users mu ON mu.id = p.member_user_id
      WHERE p.org_id = $1
      ORDER BY CASE p.scope WHEN 'org' THEN 0 WHEN 'department' THEN 1 ELSE 2 END, p.id`,
    [r.org.orgId]
  );
  return NextResponse.json({ policies: rows });
}

/** Upsert one policy row per scope target. */
export async function PUT(req: Request) {
  const r = await requireOrgAdmin();
  if ("error" in r) return r.error;
  const b = await req.json().catch(() => ({}));
  const scope = b.scope;
  if (!["org", "department", "member"].includes(scope)) {
    return NextResponse.json({ error: "scope must be org, department or member." }, { status: 400 });
  }
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

  const val = (k: string) => (b[k] === undefined ? null : b[k]);
  const budget = val("keepalive_budget_usd_daily");
  if (budget !== null && (!Number.isFinite(Number(budget)) || Number(budget) < 0 || Number(budget) > 1000)) {
    return NextResponse.json({ error: "Warming budget must be between 0 and 1000 USD." }, { status: 400 });
  }
  const ttl = val("anthropic_cache_ttl");
  if (ttl !== null && ttl !== "5m" && ttl !== "1h") {
    return NextResponse.json({ error: "anthropic_cache_ttl must be 5m or 1h." }, { status: 400 });
  }
  const tuning = val("cache_tuning_mode");
  if (tuning !== null && tuning !== "manual" && tuning !== "auto") {
    return NextResponse.json({ error: "cache_tuning_mode must be manual or auto." }, { status: 400 });
  }

  const conflictTarget =
    scope === "org"
      ? "(org_id) WHERE scope = 'org'"
      : scope === "department"
        ? "(org_id, department_id) WHERE scope = 'department'"
        : "(org_id, member_user_id) WHERE scope = 'member'";
  const { rows } = await db().query(
    `INSERT INTO org_cache_policies
       (org_id, scope, department_id, member_user_id,
        auto_cache_control, keepalive_enabled, keepalive_budget_usd_daily,
        anthropic_cache_ttl, cache_tuning_mode, enforce, updated_by, updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
     ON CONFLICT ${conflictTarget} DO UPDATE SET
        auto_cache_control=$5, keepalive_enabled=$6, keepalive_budget_usd_daily=$7,
        anthropic_cache_ttl=$8, cache_tuning_mode=$9, enforce=$10, updated_by=$11, updated_at=now()
     RETURNING id`,
    [
      r.org.orgId, scope, departmentId, memberUserId,
      val("auto_cache_control"), val("keepalive_enabled"), budget,
      ttl, tuning, b.enforce === true, r.ws.session.uid,
    ]
  );
  await audit(r.org.orgId, r.ws.session, "policy.set", scope, {
    departmentId, memberUserId, enforce: b.enforce === true,
    settings: Object.fromEntries(SETTING_KEYS.map((k) => [k, val(k)])),
  });
  return NextResponse.json({ ok: true, id: rows[0].id });
}

export async function DELETE(req: Request) {
  const r = await requireOrgAdmin();
  if ("error" in r) return r.error;
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "id is required." }, { status: 400 });
  const { rows } = await db().query(
    "DELETE FROM org_cache_policies WHERE id=$1 AND org_id=$2 RETURNING scope", [id, r.org.orgId]);
  if (!rows[0]) return NextResponse.json({ error: "Policy not found." }, { status: 404 });
  await audit(r.org.orgId, r.ws.session, "policy.delete", rows[0].scope);
  return NextResponse.json({ ok: true });
}
