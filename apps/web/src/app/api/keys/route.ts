import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getWorkspace } from "@/lib/org";
import { generateApiKey, sha256Hex } from "@caching/shared";

// Workspace-aware: the personal workspace lists/mints personal keys
// (org_id IS NULL), the org workspace the member's TEAM keys (org_id set).
// Strictly separated — a key never moves between workspaces.

export async function GET() {
  const ws = await getWorkspace();
  if (!ws) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { rows } = ws.org
    ? await db().query(
        `SELECT id, name, key_prefix_display, auto_cache_control, keepalive_enabled,
                keepalive_budget_usd_daily, anthropic_cache_ttl, openai_cache_retention,
                keepalive_hold_until, cache_tuning_mode, created_at, revoked_at,
                (anthropic_key_encrypted IS NOT NULL) AS has_anthropic_key,
                (openai_key_encrypted IS NOT NULL) AS has_openai_key,
                (gemini_key_encrypted IS NOT NULL) AS has_gemini_key,
                (grok_key_encrypted IS NOT NULL) AS has_grok_key
           FROM api_keys WHERE user_id=$1 AND org_id=$2 ORDER BY id DESC`,
        [ws.session.uid, ws.org.orgId]
      )
    : await db().query(
        `SELECT id, name, key_prefix_display, auto_cache_control, keepalive_enabled,
                keepalive_budget_usd_daily, anthropic_cache_ttl, openai_cache_retention,
                keepalive_hold_until, cache_tuning_mode, created_at, revoked_at,
                (anthropic_key_encrypted IS NOT NULL) AS has_anthropic_key,
                (openai_key_encrypted IS NOT NULL) AS has_openai_key,
                (gemini_key_encrypted IS NOT NULL) AS has_gemini_key,
                (grok_key_encrypted IS NOT NULL) AS has_grok_key
           FROM api_keys WHERE user_id=$1 AND org_id IS NULL ORDER BY id DESC`,
        [ws.session.uid]
      );
  // adaptive tuning is a hosted-cloud feature (ee/) — the UI only offers it
  // when the deployment opts in
  return NextResponse.json({
    keys: rows,
    cloud: process.env.CACHING_CLOUD === "1",
    workspace: ws.org ? "org" : "personal",
  });
}

export async function POST(req: Request) {
  const ws = await getWorkspace();
  if (!ws) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { name, mode } = await req.json().catch(() => ({}));
  if (mode !== undefined && mode !== "optimize" && mode !== "observe") {
    return NextResponse.json({ error: "mode must be 'optimize' or 'observe'." }, { status: 400 });
  }
  const raw = generateApiKey();
  const display = raw.slice(0, 11) + "…" + raw.slice(-4);
  // optimize = Autopilot preset: injection + warming + (cloud) auto-tune all
  // on, within the default $1/day warming budget — attach the key and savings
  // are maximized with zero configuration. Org keys get the SAME default:
  // automatic saving out of the box, policies only override when enforced.
  // observe = shadow preset: meter and diagnose only, never modify a request.
  const autopilot = mode !== "observe";
  const tuning = autopilot && process.env.CACHING_CLOUD === "1" ? "auto" : "manual";

  // non-enforced org/department/member policies seed the DEFAULTS for new keys
  let defaults: any = null;
  if (ws.org) {
    const p = await db().query(
      `SELECT
         COALESCE(pm.auto_cache_control, pd.auto_cache_control, po.auto_cache_control) AS auto_cache_control,
         COALESCE(pm.keepalive_enabled, pd.keepalive_enabled, po.keepalive_enabled) AS keepalive_enabled,
         COALESCE(pm.keepalive_budget_usd_daily, pd.keepalive_budget_usd_daily, po.keepalive_budget_usd_daily) AS budget,
         COALESCE(pm.anthropic_cache_ttl, pd.anthropic_cache_ttl, po.anthropic_cache_ttl) AS ttl,
         COALESCE(pm.cache_tuning_mode, pd.cache_tuning_mode, po.cache_tuning_mode) AS tuning
       FROM (SELECT 1) one
       LEFT JOIN org_cache_policies po ON po.org_id = $1 AND po.scope = 'org'
       LEFT JOIN org_cache_policies pd ON pd.org_id = $1 AND pd.scope = 'department' AND pd.department_id = $3
       LEFT JOIN org_cache_policies pm ON pm.org_id = $1 AND pm.scope = 'member' AND pm.member_user_id = $2`,
      [ws.org.orgId, ws.session.uid, ws.org.departmentId]
    );
    defaults = p.rows[0] ?? null;
  }

  const { rows } = await db().query(
    `INSERT INTO api_keys(user_id, org_id, name, key_hash, key_prefix_display,
                          auto_cache_control, keepalive_enabled, cache_tuning_mode,
                          keepalive_budget_usd_daily, anthropic_cache_ttl)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, name, key_prefix_display, created_at`,
    [
      ws.session.uid,
      ws.org?.orgId ?? null,
      (name || "default").slice(0, 64),
      sha256Hex(raw),
      display,
      defaults?.auto_cache_control ?? autopilot,
      defaults?.keepalive_enabled ?? autopilot,
      defaults?.tuning ?? tuning,
      defaults?.budget ?? 1.0,
      defaults?.ttl ?? "5m",
    ]
  );
  // plaintext returned exactly once
  return NextResponse.json({ key: rows[0], plaintext: raw });
}
