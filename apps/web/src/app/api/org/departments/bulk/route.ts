import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit, requireOrgAdmin } from "@/lib/org";
import { parseCsv } from "@/lib/csv";

const MAX_ROWS = 500;

/** Bulk-create departments. Accepts JSON `{ "names": ["Engineering", …] }`
 * or a CSV body (`content-type: text/csv`) with a `name` column — the same
 * format as the downloadable template. Existing names are reported, not
 * errors, so re-uploading a full roster is safe. */
export async function POST(req: Request) {
  const r = await requireOrgAdmin();
  if ("error" in r) return r.error;

  let names: string[] = [];
  const ctype = req.headers.get("content-type") ?? "";
  if (ctype.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    names = Array.isArray(body.names) ? body.names.map((n: unknown) => String(n ?? "")) : [];
  } else {
    const rows = parseCsv(await req.text());
    if (rows.length && rows[0][0].toLowerCase() === "name") rows.shift();
    names = rows.map((row) => row[0] ?? "");
  }
  if (!names.length || names.length > MAX_ROWS) {
    return NextResponse.json({ error: `Provide 1–${MAX_ROWS} department names.` }, { status: 400 });
  }

  const results: { name: string; status: "created" | "exists" | "invalid" }[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = String(raw ?? "").trim().slice(0, 60);
    if (!name || seen.has(name.toLowerCase())) {
      results.push({ name: raw, status: "invalid" });
      continue;
    }
    seen.add(name.toLowerCase());
    const { rows } = await db().query(
      "INSERT INTO org_departments(org_id, name) VALUES($1,$2) ON CONFLICT (org_id, name) DO NOTHING RETURNING id",
      [r.org.orgId, name]
    );
    results.push({ name, status: rows[0] ? "created" : "exists" });
  }

  const created = results.filter((x) => x.status === "created");
  if (created.length) {
    await audit(r.org.orgId, r.ws.session, "department.bulk_import", "", {
      created: created.map((x) => x.name),
    });
  }
  return NextResponse.json({
    results,
    created: created.length,
    exists: results.filter((x) => x.status === "exists").length,
    invalid: results.filter((x) => x.status === "invalid").length,
  });
}
