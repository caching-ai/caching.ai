import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { sha256Hex } from "@caching/shared";
import { db } from "@/lib/db";
import { audit, requireOrgAdmin } from "@/lib/org";

const MAX_TOKENS = 10;

// Admin API tokens are managed from the console only (allowToken:false) —
// a token must never be able to mint or revoke tokens.

export async function GET() {
  const r = await requireOrgAdmin({ allowToken: false });
  if ("error" in r) return r.error;
  const { rows } = await db().query(
    `SELECT t.id, t.name, t.created_at, t.last_used_at, u.email AS created_by_email
       FROM org_admin_tokens t LEFT JOIN users u ON u.id = t.created_by
      WHERE t.org_id = $1 AND t.revoked_at IS NULL
      ORDER BY t.created_at DESC`,
    [r.org.orgId]
  );
  return NextResponse.json({ tokens: rows });
}

export async function POST(req: Request) {
  const r = await requireOrgAdmin({ allowToken: false });
  if ("error" in r) return r.error;
  const { name } = await req.json().catch(() => ({}));
  const tokenName = String(name ?? "").trim().slice(0, 60);
  if (!tokenName) return NextResponse.json({ error: "Please name the token." }, { status: 400 });
  const { rows: live } = await db().query(
    "SELECT count(*)::int AS n FROM org_admin_tokens WHERE org_id=$1 AND revoked_at IS NULL",
    [r.org.orgId]
  );
  if ((live[0]?.n ?? 0) >= MAX_TOKENS) {
    return NextResponse.json({ error: `A workspace can have at most ${MAX_TOKENS} active tokens.` }, { status: 400 });
  }
  const token = "oat_" + randomBytes(24).toString("hex");
  const { rows } = await db().query(
    `INSERT INTO org_admin_tokens(org_id, name, token_hash, created_by)
     VALUES($1,$2,$3,$4) RETURNING id`,
    [r.org.orgId, tokenName, sha256Hex(token), r.ws.session.uid]
  );
  await audit(r.org.orgId, r.ws.session, "admin_token.create", tokenName);
  // the plaintext token is shown exactly once
  return NextResponse.json({ ok: true, id: rows[0].id, token });
}

export async function DELETE(req: Request) {
  const r = await requireOrgAdmin({ allowToken: false });
  if ("error" in r) return r.error;
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "id is required." }, { status: 400 });
  const { rows } = await db().query(
    `UPDATE org_admin_tokens SET revoked_at=now()
      WHERE id=$1 AND org_id=$2 AND revoked_at IS NULL RETURNING name`,
    [id, r.org.orgId]
  );
  if (!rows[0]) return NextResponse.json({ error: "Token not found." }, { status: 404 });
  await audit(r.org.orgId, r.ws.session, "admin_token.revoke", rows[0].name);
  return NextResponse.json({ ok: true });
}
