import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

/** Performance-fee metering: monthly verified savings and the 20% fee
 * (waived during beta). Rows are recomputed by the proxy's billing sweep. */
export async function GET() {
  const sess = await getSession();
  if (!sess) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { rows } = await db().query(
    `SELECT period_start::text, period_end::text,
            gross_saved_usd::float, keepalive_cost_usd::float,
            net_saved_usd::float, fee_usd::float, fee_rate::float,
            status, computed_at
       FROM billing_periods
      WHERE user_id=$1
      ORDER BY period_start DESC LIMIT 24`,
    [sess.uid]
  );
  const u = await db().query("SELECT billing_locked FROM users WHERE id=$1", [sess.uid]);
  return NextResponse.json({ periods: rows, locked: u.rows[0]?.billing_locked === true });
}
