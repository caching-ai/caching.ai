import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit, requireOrgAdmin, requireOrgMember } from "@/lib/org";

export async function GET() {
  const r = await requireOrgMember();
  if ("error" in r) return r.error;
  const { rows } = await db().query(
    `SELECT d.id, d.name, count(u.id)::int AS members
       FROM org_departments d
       LEFT JOIN users u ON u.org_department_id = d.id
      WHERE d.org_id = $1
      GROUP BY d.id, d.name ORDER BY d.name`,
    [r.org.orgId]
  );
  return NextResponse.json({ departments: rows });
}

export async function POST(req: Request) {
  const r = await requireOrgAdmin();
  if ("error" in r) return r.error;
  const { name } = await req.json().catch(() => ({}));
  const deptName = String(name ?? "").trim().slice(0, 60);
  if (!deptName) return NextResponse.json({ error: "Please enter a department name." }, { status: 400 });
  try {
    const { rows } = await db().query(
      "INSERT INTO org_departments(org_id, name) VALUES($1,$2) RETURNING id",
      [r.org.orgId, deptName]
    );
    await audit(r.org.orgId, r.ws.session, "department.create", deptName);
    return NextResponse.json({ ok: true, id: rows[0].id });
  } catch (e: any) {
    if (e?.code === "23505") {
      return NextResponse.json({ error: "A department with that name already exists." }, { status: 409 });
    }
    throw e;
  }
}

export async function PATCH(req: Request) {
  const r = await requireOrgAdmin();
  if ("error" in r) return r.error;
  const { id, name } = await req.json().catch(() => ({}));
  const deptName = String(name ?? "").trim().slice(0, 60);
  if (!Number.isInteger(Number(id)) || !deptName) {
    return NextResponse.json({ error: "id and name are required." }, { status: 400 });
  }
  const { rows } = await db().query(
    "UPDATE org_departments SET name=$3 WHERE id=$1 AND org_id=$2 RETURNING id",
    [Number(id), r.org.orgId, deptName]
  );
  if (!rows[0]) return NextResponse.json({ error: "Department not found." }, { status: 404 });
  await audit(r.org.orgId, r.ws.session, "department.rename", deptName);
  return NextResponse.json({ ok: true });
}

/** Members in a deleted department simply become unassigned (FK SET NULL). */
export async function DELETE(req: Request) {
  const r = await requireOrgAdmin();
  if ("error" in r) return r.error;
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "id is required." }, { status: 400 });
  const { rows } = await db().query(
    "DELETE FROM org_departments WHERE id=$1 AND org_id=$2 RETURNING name", [id, r.org.orgId]);
  if (!rows[0]) return NextResponse.json({ error: "Department not found." }, { status: 404 });
  await audit(r.org.orgId, r.ws.session, "department.delete", rows[0].name);
  return NextResponse.json({ ok: true });
}
