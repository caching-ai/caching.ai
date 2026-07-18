import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getSession, type Session } from "@/lib/auth";

// Workspace resolution (onpod pattern): the cookie is only a HINT — the
// server re-verifies membership from users.org_id on every request and
// fails closed to the personal workspace.

export const WS_COOKIE = "caching_ws";

export interface OrgContext {
  orgId: number;
  orgName: string;
  role: "owner" | "admin" | "member";
  departmentId: number | null;
  billingLocked: boolean;
}

export interface Workspace {
  session: Session;
  /** null = personal workspace */
  org: OrgContext | null;
  /** the org the user belongs to, even while in the personal workspace */
  memberOf: OrgContext | null;
}

export async function membershipOf(uid: number): Promise<OrgContext | null> {
  const { rows } = await db().query(
    `SELECT o.id, o.name, o.billing_locked, u.org_role, u.org_department_id
       FROM users u JOIN organizations o ON o.id = u.org_id
      WHERE u.id = $1 AND o.deleted_at IS NULL`,
    [uid]
  );
  if (!rows[0]) return null;
  return {
    orgId: rows[0].id,
    orgName: rows[0].name,
    role: rows[0].org_role,
    departmentId: rows[0].org_department_id,
    billingLocked: rows[0].billing_locked === true,
  };
}

/** Session + active workspace; null when not signed in. */
export async function getWorkspace(): Promise<Workspace | null> {
  const session = await getSession();
  if (!session) return null;
  const memberOf = await membershipOf(session.uid);
  const jar = await cookies();
  const wantsOrg = jar.get(WS_COOKIE)?.value === "org";
  return { session, org: wantsOrg && memberOf ? memberOf : null, memberOf };
}

/** API guard: signed in AND in the org workspace. */
export async function requireOrgMember(): Promise<
  { ws: Workspace; org: OrgContext } | { error: Response }
> {
  const ws = await getWorkspace();
  if (!ws) return { error: Response.json({ error: "Not signed in." }, { status: 401 }) };
  if (!ws.org) {
    return { error: Response.json({ error: "Switch to the team workspace first." }, { status: 403 }) };
  }
  return { ws, org: ws.org };
}

/** API guard: org workspace AND owner/admin. */
export async function requireOrgAdmin(): Promise<
  { ws: Workspace; org: OrgContext } | { error: Response }
> {
  const r = await requireOrgMember();
  if ("error" in r) return r;
  if (r.org.role !== "owner" && r.org.role !== "admin") {
    return { error: Response.json({ error: "Workspace admins only." }, { status: 403 }) };
  }
  return r;
}

/** Append-only audit trail for every admin action in an org workspace. */
export async function audit(
  orgId: number,
  actor: Session,
  action: string,
  target = "",
  detail: object | null = null
): Promise<void> {
  try {
    await db().query(
      `INSERT INTO org_audit_log(org_id, actor_user_id, actor_email, action, target, detail)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [orgId, actor.uid, actor.email, action, target, detail ? JSON.stringify(detail) : null]
    );
  } catch (e) {
    console.error("org audit write failed:", (e as Error).message);
  }
}

export function wsCookie(kind: "personal" | "org") {
  return {
    name: WS_COOKIE,
    value: kind === "org" ? "org" : "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: kind === "org" ? 365 * 24 * 3600 : 0,
  };
}
