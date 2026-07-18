import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit, requireOrgAdmin } from "@/lib/org";
import { createOrgInvite } from "@/lib/orgInvite";
import { parseCsv } from "@/lib/csv";
import { clientIp, rateLimited } from "@/lib/ratelimit";

const MAX_ROWS = 200;

interface Row { email: string; role: string; department: string }

/** Bulk member invites. Accepts JSON `{ "invites": [{email, role?, department?}] }`
 * or a CSV body (`content-type: text/csv`) with `email,role,department`
 * columns — the same format as the downloadable template. Departments are
 * matched by name and created on the fly, so one upload can provision the
 * whole roster. Admin invites require the workspace owner (console only). */
export async function POST(req: Request) {
  const r = await requireOrgAdmin();
  if ("error" in r) return r.error;
  if (rateLimited(`org-invite-bulk:${r.org.orgId}:${clientIp(req)}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many bulk imports right now. Please try again later." }, { status: 429 });
  }

  let rows: Row[] = [];
  const ctype = req.headers.get("content-type") ?? "";
  if (ctype.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    const list = Array.isArray(body.invites) ? body.invites : [];
    rows = list.map((x: any) => ({
      email: String(x?.email ?? ""),
      role: String(x?.role ?? "member"),
      department: String(x?.department ?? ""),
    }));
  } else {
    const parsed = parseCsv(await req.text());
    if (parsed.length && parsed[0][0].toLowerCase() === "email") parsed.shift();
    rows = parsed.map((row) => ({
      email: row[0] ?? "",
      role: row[1] || "member",
      department: row[2] ?? "",
    }));
  }
  if (!rows.length || rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `Provide 1–${MAX_ROWS} rows.` }, { status: 400 });
  }

  const inviterLocale =
    (await db().query("SELECT locale FROM users WHERE id=$1", [r.ws.session.uid])).rows[0]?.locale ?? "en";

  // department name → id, creating missing ones as we go
  const deptByName = new Map<string, number>();
  {
    const { rows: depts } = await db().query(
      "SELECT id, name FROM org_departments WHERE org_id=$1", [r.org.orgId]);
    for (const d of depts) deptByName.set(String(d.name).toLowerCase(), d.id);
  }
  const createdDepts: string[] = [];

  const results: { email: string; status: string }[] = [];
  for (const row of rows) {
    const email = row.email.toLowerCase().trim();
    const role = row.role.toLowerCase().trim() || "member";
    if (role !== "member" && role !== "admin") {
      results.push({ email: row.email, status: "invalid_role" });
      continue;
    }
    if (role === "admin" && r.org.role !== "owner") {
      results.push({ email: row.email, status: "owner_only_role" });
      continue;
    }

    let departmentId: number | null = null;
    const deptName = row.department.trim().slice(0, 60);
    if (deptName) {
      const key = deptName.toLowerCase();
      if (!deptByName.has(key)) {
        const ins = await db().query(
          "INSERT INTO org_departments(org_id, name) VALUES($1,$2) ON CONFLICT (org_id, name) DO NOTHING RETURNING id",
          [r.org.orgId, deptName]
        );
        const id = ins.rows[0]?.id ??
          (await db().query("SELECT id FROM org_departments WHERE org_id=$1 AND name=$2", [r.org.orgId, deptName])).rows[0]?.id;
        if (id) {
          deptByName.set(key, id);
          if (ins.rows[0]) createdDepts.push(deptName);
        }
      }
      departmentId = deptByName.get(key) ?? null;
    }

    const status = await createOrgInvite({
      orgId: r.org.orgId,
      orgName: r.org.orgName,
      inviter: r.ws.session,
      inviterLocale,
      email,
      role: role as "admin" | "member",
      departmentId,
    });
    results.push({ email: email || row.email, status });
  }

  await audit(r.org.orgId, r.ws.session, "invite.bulk_import", "", {
    invited: results.filter((x) => x.status === "invited").map((x) => x.email),
    createdDepartments: createdDepts,
  });
  return NextResponse.json({
    results,
    invited: results.filter((x) => x.status === "invited").length,
    createdDepartments: createdDepts,
  });
}
