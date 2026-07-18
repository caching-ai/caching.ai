import { randomBytes } from "node:crypto";
import { sha256Hex } from "@caching/shared";
import { db } from "@/lib/db";
import type { Session } from "@/lib/auth";
import { orgInviteEmail, sendEmail } from "@/lib/email";

export const INVITE_TTL_DAYS = 7;
const BASE_URL = (process.env.PUBLIC_BASE_URL ?? "https://caching.ai").replace(/\/$/, "");

export type InviteStatus = "invited" | "already_member" | "invalid" | "error";

/** Create (or refresh) one org invite and fire the invite mail. Shared by the
 * console invite form and the bulk CSV/API path — one bad address never
 * blocks a batch, so this returns a status instead of throwing. */
export async function createOrgInvite(opts: {
  orgId: number;
  orgName: string;
  inviter: Session;
  inviterLocale: string;
  email: string;
  role: "admin" | "member";
  departmentId: number | null;
}): Promise<InviteStatus> {
  const email = String(opts.email ?? "").toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return "invalid";

  const existing = await db().query("SELECT org_id FROM users WHERE email=$1", [email]);
  if (existing.rows[0]?.org_id === opts.orgId) return "already_member";

  const token = "oiv_" + randomBytes(24).toString("hex");
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE org_invites SET revoked_at=now()
        WHERE org_id=$1 AND lower(email)=$2 AND accepted_at IS NULL AND revoked_at IS NULL`,
      [opts.orgId, email]
    );
    await client.query(
      `INSERT INTO org_invites(org_id, email, role, department_id, token_hash, invited_by, expires_at)
       VALUES($1,$2,$3,$4,$5,$6, now() + make_interval(days => $7))`,
      [opts.orgId, email, opts.role, opts.departmentId, sha256Hex(token), opts.inviter.uid, INVITE_TTL_DAYS]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("invite create failed:", (e as Error).message);
    client.release();
    return "error";
  }
  client.release();

  // token-authenticated calls carry a synthetic "api-token:…" identity — the
  // invite mail should show the human who created the token instead
  let inviterEmail = opts.inviter.email;
  if (inviterEmail.startsWith("api-token:")) {
    const u = await db().query("SELECT email FROM users WHERE id=$1", [opts.inviter.uid]);
    inviterEmail = u.rows[0]?.email ?? opts.orgName;
  }

  const joinUrl = `${BASE_URL}/org/join?token=${encodeURIComponent(token)}`;
  const { subject, html } = orgInviteEmail(opts.inviterLocale, opts.orgName, inviterEmail, joinUrl);
  // fire-and-forget — invite rows exist regardless; the console lists them
  void sendEmail(email, subject, html).catch(() => {});
  return "invited";
}
