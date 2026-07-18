import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { requireOrgAdmin } from "@/lib/org";
import { computeOrgStats, STAT_WINDOWS } from "@/lib/orgStats";
import { fontPath, pct, reportT, usd } from "@/lib/orgReport";
import { db } from "@/lib/db";

/**
 * Executive summary PDF (1–2 pages): totals, shared-cache effect, top
 * departments and members. Noto Sans KR is embedded so Korean renders.
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

  const regular = fontPath("NotoSansKR-Regular.otf");
  const bold = fontPath("NotoSansKR-Bold.otf");

  const doc = new PDFDocument({ size: "A4", margin: 48 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  if (regular) doc.registerFont("body", regular);
  if (bold) doc.registerFont("bold", bold);
  const F = regular ? "body" : "Helvetica";
  const FB = bold ? "bold" : "Helvetica-Bold";

  const ink = "#080808";
  const mute = "#898989";
  const green = "#00a51b";
  const red = "#ee1d36";

  // header
  doc.font(FB).fontSize(20).fillColor(ink).text("caching.ai", { continued: true });
  doc.font(F).fillColor(mute).text(`  ${t.title}`);
  doc.moveDown(0.2);
  doc.font(F).fontSize(11).fillColor(mute)
    .text(`${r.org.orgName} · ${t.window}: ${days} ${t.days} · ${t.generated}: ${new Date().toISOString().slice(0, 10)}`);
  doc.moveDown(1);

  // stat cards row
  const cards: [string, string, string][] = [
    [t.saved, usd(s.totals.savedUsd), green],
    [t.wasted, usd(s.totals.wastedUsd), red],
    [t.hitRate, pct(s.totals.hitRate), ink],
  ];
  const cardW = (doc.page.width - 96 - 24) / 3;
  const y0 = doc.y;
  cards.forEach(([label, value, color], i) => {
    const x = 48 + i * (cardW + 12);
    doc.roundedRect(x, y0, cardW, 64, 6).strokeColor("#d8d8d8").lineWidth(1).stroke();
    doc.font(F).fontSize(8).fillColor(mute).text(label.toUpperCase(), x + 12, y0 + 12, { width: cardW - 24 });
    doc.font(FB).fontSize(18).fillColor(color).text(value, x + 12, y0 + 28, { width: cardW - 24 });
  });
  doc.x = 48;
  doc.y = y0 + 80;

  // secondary line
  doc.font(F).fontSize(10).fillColor(ink).text(
    `${t.requests}: ${s.totals.requests.toLocaleString()}   ·   ${t.spend}: ${usd(s.totals.costUsd)}   ·   ${t.keepalive}: ${usd(s.totals.keepaliveCost)}`
  );
  doc.moveDown(0.4);
  doc.font(F).fontSize(10).fillColor(green).text(`${t.shared}: ${usd(s.totals.sharedSavedUsd)}`, { continued: true });
  doc.font(F).fillColor(mute).text(`  — ${t.sharedNote}`);
  doc.moveDown(1);

  const table = (title: string, firstCol: string, rows: any[], key: (x: any) => string, max = 10) => {
    if (!rows.length) return;
    doc.font(FB).fontSize(12).fillColor(ink).text(title);
    doc.moveDown(0.3);
    const cols = [200, 70, 60, 80, 80];
    const startX = 48;
    let y = doc.y;
    const header = [firstCol, t.requests, t.hitRate, t.saved, t.wasted];
    doc.font(F).fontSize(8).fillColor(mute);
    header.forEach((h, i) => {
      doc.text(h.toUpperCase(), startX + cols.slice(0, i).reduce((a, b) => a + b, 0), y, {
        width: cols[i] - 8, align: i === 0 ? "left" : "right",
      });
    });
    y += 14;
    doc.moveTo(startX, y - 2).lineTo(startX + cols.reduce((a, b) => a + b, 0), y - 2)
      .strokeColor("#d8d8d8").lineWidth(0.5).stroke();
    doc.font(F).fontSize(9);
    for (const x of rows.slice(0, max)) {
      if (y > doc.page.height - 80) { doc.addPage(); y = 48; }
      const cells = [
        key(x), x.requests.toLocaleString(), pct(x.hitRate), usd(x.saved), usd(x.wasted),
      ];
      cells.forEach((c, i) => {
        doc.fillColor(i === 3 ? green : i === 4 ? red : ink);
        doc.text(String(c), startX + cols.slice(0, i).reduce((a, b) => a + b, 0), y, {
          width: cols[i] - 8, align: i === 0 ? "left" : "right", lineBreak: false,
        });
      });
      y += 16;
    }
    doc.x = 48;
    doc.y = y + 12;
  };

  table(t.byDepartment, t.department, s.departments, (d) => d.department ?? t.unassigned, 8);
  table(t.byMember, t.member, s.members, (m) => m.email, 12);
  table(t.byModel, t.model, s.models, (m) => m.model || "(unknown)", 8);

  doc.font(F).fontSize(8).fillColor(mute).text(t.footer, 48, doc.page.height - 60);
  doc.end();

  const pdf = await done;
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="caching-ai-team-report-${days}d-${stamp}.pdf"`,
    },
  });
}
