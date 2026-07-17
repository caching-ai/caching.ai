import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  const sess = await getSession();
  if (!sess) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { rows } = await db().query(
    "SELECT psp, card_label, created_at FROM payment_methods WHERE user_id=$1",
    [sess.uid]
  );
  return NextResponse.json({ method: rows[0] ?? null });
}

export async function DELETE() {
  const sess = await getSession();
  if (!sess) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  await db().query("DELETE FROM payment_methods WHERE user_id=$1", [sess.uid]);
  return NextResponse.json({ ok: true });
}
