import { NextResponse } from "next/server";
import { getWorkspace } from "@/lib/org";

/** stable customerKey for the Toss billing widget — per user, or per org in
 *  the org workspace (admins register the team card) */
export async function GET() {
  const ws = await getWorkspace();
  if (!ws) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (ws.org) {
    if (ws.org.role !== "owner" && ws.org.role !== "admin") {
      return NextResponse.json({ error: "Workspace admins only." }, { status: 403 });
    }
    return NextResponse.json({ customerKey: `cai-org-${ws.org.orgId}` });
  }
  return NextResponse.json({ customerKey: `cai-${ws.session.uid}` });
}
