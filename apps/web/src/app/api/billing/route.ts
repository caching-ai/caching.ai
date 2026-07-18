import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/org";

/** Performance-fee metering: monthly verified savings and the 20% fee
 * (waived during beta). Rows are recomputed by the proxy's billing sweep.
 * Workspace-aware: the org workspace reads the ORG's periods and lock. */
export async function GET() {
  const ws = await getWorkspace();
  if (!ws) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (ws.org) {
    const { rows } = await db().query(
      `SELECT period_start::text, period_end::text,
              gross_saved_usd::float, keepalive_cost_usd::float,
              net_saved_usd::float, fee_usd::float, fee_rate::float,
              status, computed_at
         FROM org_billing_periods
        WHERE org_id=$1
        ORDER BY period_start DESC LIMIT 24`,
      [ws.org.orgId]
    );
    return NextResponse.json({
      periods: rows,
      locked: ws.org.billingLocked,
      workspace: "org",
      canManage: ws.org.role === "owner" || ws.org.role === "admin",
    });
  }

  const { rows } = await db().query(
    `SELECT period_start::text, period_end::text,
            gross_saved_usd::float, keepalive_cost_usd::float,
            net_saved_usd::float, fee_usd::float, fee_rate::float,
            status, computed_at
       FROM billing_periods
      WHERE user_id=$1
      ORDER BY period_start DESC LIMIT 24`,
    [ws.session.uid]
  );
  const u = await db().query("SELECT billing_locked FROM users WHERE id=$1", [ws.session.uid]);
  return NextResponse.json({
    periods: rows,
    locked: u.rows[0]?.billing_locked === true,
    workspace: "personal",
    canManage: true,
  });
}
