import type pg from "pg";
import type { ApiKeyRow } from "../store.js";

// Org monthly spend budgets with action='block' are enforced here, on the
// request path. Spend is the org's ACTUAL provider cost this calendar month
// (UTC), summed from request_logs. The verdict is cached per org so the hot
// path pays one aggregate query per org per TTL, not per request.
//
// action='warn' budgets never touch traffic — they only email admins (see
// orgBudgetAlert.ts).

const CACHE_TTL_MS = 60_000;

interface OrgBudgetVerdict {
  /** budgets with action='block' that are already exceeded */
  blockedOrg: boolean;
  blockedDepartments: Set<number>;
  blockedMembers: Set<number>;
  exp: number;
}

const CACHE = new Map<number, OrgBudgetVerdict>();

export function clearOrgBudgetCache() {
  CACHE.clear();
}

async function loadVerdict(pool: pg.Pool, orgId: number): Promise<OrgBudgetVerdict> {
  const verdict: OrgBudgetVerdict = {
    blockedOrg: false,
    blockedDepartments: new Set(),
    blockedMembers: new Set(),
    exp: Date.now() + CACHE_TTL_MS,
  };

  const { rows: budgets } = await pool.query(
    `SELECT scope, department_id, member_user_id, monthly_limit_usd
       FROM org_budgets WHERE org_id = $1 AND action = 'block'`,
    [orgId]
  );
  if (!budgets.length) return verdict;

  // one pass over the month's rows yields all three scopes
  const { rows: spend } = await pool.query(
    `SELECT k.user_id, u.org_department_id AS department_id, sum(rl.cost_usd)::float AS spent
       FROM request_logs rl
       JOIN api_keys k ON k.id = rl.api_key_id
       JOIN users u ON u.id = k.user_id
      WHERE k.org_id = $1 AND rl.ts >= date_trunc('month', now() AT TIME ZONE 'UTC')
      GROUP BY 1, 2`,
    [orgId]
  );

  let orgTotal = 0;
  const byDept = new Map<number, number>();
  const byMember = new Map<number, number>();
  for (const r of spend) {
    orgTotal += r.spent;
    if (r.department_id != null) {
      byDept.set(r.department_id, (byDept.get(r.department_id) ?? 0) + r.spent);
    }
    byMember.set(r.user_id, (byMember.get(r.user_id) ?? 0) + r.spent);
  }

  for (const b of budgets) {
    const limit = Number(b.monthly_limit_usd);
    if (b.scope === "org" && orgTotal >= limit) verdict.blockedOrg = true;
    if (b.scope === "department" && (byDept.get(b.department_id) ?? 0) >= limit) {
      verdict.blockedDepartments.add(b.department_id);
    }
    if (b.scope === "member" && (byMember.get(b.member_user_id) ?? 0) >= limit) {
      verdict.blockedMembers.add(b.member_user_id);
    }
  }
  return verdict;
}

/**
 * Returns which scope blocks this key ('org' | 'department' | 'member'), or
 * null when traffic may pass. Fails OPEN on DB errors — a budget check must
 * never take down customer traffic.
 */
export async function orgBudgetBlocked(
  pool: pg.Pool,
  key: ApiKeyRow
): Promise<"org" | "department" | "member" | null> {
  if (key.org_id == null) return null;
  let v = CACHE.get(key.org_id);
  if (!v || v.exp <= Date.now()) {
    try {
      v = await loadVerdict(pool, key.org_id);
      CACHE.set(key.org_id, v);
    } catch (e) {
      console.error("org budget check failed:", (e as Error).message);
      return null;
    }
  }
  if (v.blockedOrg) return "org";
  if (key.org_department_id != null && v.blockedDepartments.has(key.org_department_id)) {
    return "department";
  }
  if (v.blockedMembers.has(key.user_id)) return "member";
  return null;
}
