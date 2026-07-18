import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/org";
import { computeOrgStats, STAT_WINDOWS } from "@/lib/orgStats";

/** Team dashboard analytics (admin). See lib/orgStats.ts for the aggregate. */
export async function GET(req: NextRequest) {
  const r = await requireOrgAdmin();
  if ("error" in r) return r.error;

  const days = Number(req.nextUrl.searchParams.get("days") ?? 30);
  if (!STAT_WINDOWS.includes(days)) {
    return NextResponse.json({ error: "days must be 7, 30 or 90." }, { status: 400 });
  }
  const stats = await computeOrgStats(r.org.orgId, days);
  return NextResponse.json({ orgName: r.org.orgName, ...stats });
}
