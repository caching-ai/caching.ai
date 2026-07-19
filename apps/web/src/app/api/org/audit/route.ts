import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireOrgAdmin } from "@/lib/org";
import { csvCell as cell } from "@/lib/csv";

const PAGE = 50;
const CSV_MAX = 10_000;

/** Audit trail viewer (admin). ?format=csv downloads, ?before=<id> paginates. */
export async function GET(req: NextRequest) {
  const r = await requireOrgAdmin();
  if ("error" in r) return r.error;
  const format = req.nextUrl.searchParams.get("format");
  const before = Number(req.nextUrl.searchParams.get("before") ?? 0);

  if (format === "csv") {
    const { rows } = await db().query(
      `SELECT created_at, actor_email, action, target, detail
         FROM org_audit_log WHERE org_id=$1 ORDER BY id DESC LIMIT $2`,
      [r.org.orgId, CSV_MAX]
    );
    const lines = ["timestamp,actor,action,target,detail"];
    for (const row of rows) {
      lines.push(
        [
          new Date(row.created_at).toISOString(), row.actor_email, row.action, row.target,
          row.detail ? JSON.stringify(row.detail) : "",
        ].map(cell).join(",")
      );
    }
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(lines.join("\n") + "\n", {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="caching-ai-audit-${stamp}.csv"`,
      },
    });
  }

  const { rows } = await db().query(
    `SELECT id, created_at, actor_email, action, target, detail
       FROM org_audit_log
      WHERE org_id=$1 AND ($2::bigint = 0 OR id < $2)
      ORDER BY id DESC LIMIT ${PAGE}`,
    [r.org.orgId, before]
  );
  return NextResponse.json({ entries: rows, nextBefore: rows.length === PAGE ? rows[rows.length - 1].id : null });
}
