import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

/** stable per-user customerKey for the Toss billing widget */
export async function GET() {
  const sess = await getSession();
  if (!sess) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ customerKey: `cai-${sess.uid}` });
}
