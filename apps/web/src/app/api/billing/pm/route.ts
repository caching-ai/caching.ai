import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit, getWorkspace } from "@/lib/org";

const adminOnly = () => NextResponse.json({ error: "Workspace admins only." }, { status: 403 });

export async function GET() {
  const ws = await getWorkspace();
  if (!ws) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { rows } = ws.org
    ? await db().query(
        "SELECT psp, card_label, created_at FROM org_payment_methods WHERE org_id=$1", [ws.org.orgId])
    : await db().query(
        "SELECT psp, card_label, created_at FROM payment_methods WHERE user_id=$1", [ws.session.uid]);
  return NextResponse.json({ method: rows[0] ?? null });
}

export async function DELETE() {
  const ws = await getWorkspace();
  if (!ws) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (ws.org) {
    if (ws.org.role !== "owner" && ws.org.role !== "admin") return adminOnly();
    await db().query("DELETE FROM org_payment_methods WHERE org_id=$1", [ws.org.orgId]);
    await audit(ws.org.orgId, ws.session, "billing.card_remove");
  } else {
    await db().query("DELETE FROM payment_methods WHERE user_id=$1", [ws.session.uid]);
  }
  return NextResponse.json({ ok: true });
}
