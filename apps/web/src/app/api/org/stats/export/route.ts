import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireOrgAdmin } from "@/lib/org";
import { computeOrgStats, STAT_WINDOWS } from "@/lib/orgStats";
import { reportT } from "@/lib/orgReport";
import { db } from "@/lib/db";

/**
 * Team report as a real .xlsx workbook: Summary / Departments / Members /
 * Models / Daily sheets. Localized headers (ko fully, others English).
 */
export async function GET(req: NextRequest) {
  const r = await requireOrgAdmin();
  if ("error" in r) return r.error;
  const days = Number(req.nextUrl.searchParams.get("days") ?? 30);
  if (!STAT_WINDOWS.includes(days)) {
    return NextResponse.json({ error: "days must be 7, 30 or 90." }, { status: 400 });
  }
  const locale =
    (await db().query("SELECT locale FROM users WHERE id=$1", [r.ws.session.uid])).rows[0]?.locale ?? "en";
  const t = reportT(locale);
  const s = await computeOrgStats(r.org.orgId, days);

  const wb = new ExcelJS.Workbook();
  wb.creator = "caching.ai";
  wb.created = new Date();

  const money = "$#,##0.00####";
  const percent = "0.0%";
  const headerStyle = (row: ExcelJS.Row) => {
    row.font = { bold: true };
    row.alignment = { vertical: "middle" };
  };

  // Summary
  const sum = wb.addWorksheet(t.summary);
  sum.columns = [{ width: 30 }, { width: 24 }];
  sum.addRow([`caching.ai — ${t.title}`]).font = { bold: true, size: 14 };
  sum.addRow([r.org.orgName]);
  sum.addRow([t.window, `${days} ${t.days}`]);
  sum.addRow([t.generated, new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC"]);
  sum.addRow([]);
  const kv: [string, number, string][] = [
    [t.requests, s.totals.requests, "#,##0"],
    [t.saved, s.totals.savedUsd, money],
    [t.wasted, s.totals.wastedUsd, money],
    [t.spend, s.totals.costUsd, money],
    [t.hitRate, s.totals.hitRate, percent],
    [t.shared, s.totals.sharedSavedUsd, money],
    [t.keepalive, s.totals.keepaliveCost, money],
  ];
  for (const [label, value, fmt] of kv) {
    const row = sum.addRow([label, value]);
    row.getCell(2).numFmt = fmt;
  }
  sum.addRow([]);
  sum.addRow([t.sharedNote]).font = { italic: true, color: { argb: "FF898989" } };

  const addTable = (
    name: string,
    firstCol: string,
    rows: any[],
    key: (x: any) => string
  ) => {
    const ws = wb.addWorksheet(name);
    ws.columns = [
      { width: 32 }, { width: 12 }, { width: 10 },
      { width: 14 }, { width: 14 }, { width: 14 },
    ];
    const h = ws.addRow([firstCol, t.requests, t.hitRate, t.spend, t.saved, t.wasted]);
    headerStyle(h);
    for (const x of rows) {
      const row = ws.addRow([key(x), x.requests, x.hitRate, x.cost, x.saved, x.wasted]);
      row.getCell(3).numFmt = percent;
      row.getCell(4).numFmt = money;
      row.getCell(5).numFmt = money;
      row.getCell(6).numFmt = money;
    }
    ws.views = [{ state: "frozen", ySplit: 1 }];
    return ws;
  };

  addTable(t.byDepartment, t.department, s.departments, (d) => d.department ?? t.unassigned);
  const mws = addTable(t.byMember, t.member, s.members, (m) => m.email);
  // extra shared-savings column for members
  mws.getColumn(7).width = 16;
  mws.getRow(1).getCell(7).value = t.shared;
  mws.getRow(1).getCell(7).font = { bold: true };
  s.members.forEach((m: any, i: number) => {
    const c = mws.getRow(i + 2).getCell(7);
    c.value = m.sharedSavedUsd;
    c.numFmt = money;
  });
  addTable(t.byModel, t.model, s.models, (m) => m.model || "(unknown)");
  addTable(t.byDay, t.day, s.days, (d) => d.day);

  const buf = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(Buffer.from(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="caching-ai-team-report-${days}d-${stamp}.xlsx"`,
    },
  });
}
