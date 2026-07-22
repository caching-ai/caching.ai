import { Hono } from "hono";
import type { Context } from "hono";
import type pg from "pg";
import { encrypt } from "@caching/shared";
import { findApiKey, clearApiKeyCache, clearTenantPolicyCache, type ApiKeyRow } from "./store.js";

// Sub-tenant management API, authenticated with the enterprise ck_ key itself
// (Authorization: Bearer ck_... or x-api-key). A platform provisions per-tenant
// cache policies here instead of minting one caching key per end-customer.
//
//   GET    /admin/v1/tenants                    — list tenant policy rows
//   GET    /admin/v1/tenants/:tenant            — one tenant's policy (404 = inherits key)
//   PUT    /admin/v1/tenants/:tenant            — upsert policy (partial; null clears a field)
//   DELETE /admin/v1/tenants/:tenant            — drop the policy row (back to key defaults)
//   GET    /admin/v1/tenants/:tenant/stats      — usage/savings attribution (?days=7)
//   GET    /admin/v1/gateway                    — this key's upstream gateway
//   PUT    /admin/v1/gateway                    — set it (operator allowlist only)
//   DELETE /admin/v1/gateway                    — back to the provider default
//
// Tenants do NOT need a policy row to exist: X-Cache-Tenant alone already
// buys attribution and warm slots. Rows are only for per-tenant overrides.

const TENANT_ID_RE = /^[A-Za-z0-9._:-]{1,120}$/;
const MAX_TENANT_ROWS_PER_KEY = 10_000;

// modest per-key limiter: management is a control plane, not a data plane
const RL_WINDOW_MS = 60_000;
const RL_MAX = 120;
const rl = new Map<number, { n: number; exp: number }>();

function rateLimited(keyId: number): boolean {
  const now = Date.now();
  const cur = rl.get(keyId);
  if (!cur || cur.exp <= now) {
    if (rl.size > 10_000) rl.clear();
    rl.set(keyId, { n: 1, exp: now + RL_WINDOW_MS });
    return false;
  }
  cur.n += 1;
  return cur.n > RL_MAX;
}

function err(c: Context, status: 400 | 401 | 403 | 404 | 429 | 503, message: string) {
  return c.json({ type: "error", error: { type: "admin_error", message } }, status);
}

const POLICY_FIELDS = [
  "auto_cache_control",
  "keepalive_enabled",
  "keepalive_budget_usd_daily",
  "anthropic_cache_ttl",
  "keepalive_max_slots",
] as const;
type PolicyField = (typeof POLICY_FIELDS)[number];

function validateField(f: PolicyField, v: unknown): string | null {
  if (v === null) return null; // null clears → inherit key setting
  switch (f) {
    case "auto_cache_control":
    case "keepalive_enabled":
      return typeof v === "boolean" ? null : `${f} must be a boolean or null`;
    case "keepalive_budget_usd_daily":
      return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10_000
        ? null : `${f} must be a number between 0 and 10000, or null`;
    case "anthropic_cache_ttl":
      return v === "5m" || v === "1h" ? null : `${f} must be '5m', '1h' or null`;
    case "keepalive_max_slots":
      return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 128
        ? null : `${f} must be an integer between 1 and 128, or null`;
  }
}

function policyJson(row: any) {
  return {
    tenant: row.tenant_id,
    auto_cache_control: row.auto_cache_control,
    keepalive_enabled: row.keepalive_enabled,
    keepalive_budget_usd_daily:
      row.keepalive_budget_usd_daily == null ? null : Number(row.keepalive_budget_usd_daily),
    anthropic_cache_ttl: row.anthropic_cache_ttl,
    keepalive_max_slots: row.keepalive_max_slots,
    updated_at: row.updated_at,
  };
}

export function adminRoutes(pool: pg.Pool, encryptionKey?: string) {
  const app = new Hono();

  async function auth(c: Context): Promise<{ key: ApiKeyRow } | { res: Response }> {
    const raw =
      c.req.header("x-api-key") ??
      c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (!raw?.startsWith("ck_")) {
      return { res: err(c, 401, "Pass your ck_... API key (x-api-key or Authorization: Bearer).") };
    }
    let key: ApiKeyRow | null;
    try {
      key = await findApiKey(pool, raw);
    } catch {
      return { res: err(c, 503, "Temporary service issue. Please retry.") };
    }
    if (!key) return { res: err(c, 401, "This API key is invalid or has been revoked.") };
    if (rateLimited(key.id)) return { res: err(c, 429, "Too many management requests. Slow down.") };
    return { key };
  }

  function tenantParam(c: Context): string | null {
    const t = c.req.param("tenant");
    return t && TENANT_ID_RE.test(t) ? t : null;
  }

  app.get("/tenants", async (c) => {
    const a = await auth(c);
    if ("res" in a) return a.res;
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 100) || 100, 1), 1000);
    const after = c.req.query("after") ?? "";
    const { rows } = await pool.query(
      `SELECT tenant_id, auto_cache_control, keepalive_enabled, keepalive_budget_usd_daily,
              anthropic_cache_ttl, keepalive_max_slots, updated_at
         FROM key_tenant_policies
        WHERE api_key_id=$1 AND tenant_id > $2
        ORDER BY tenant_id LIMIT $3`,
      [a.key.id, after, limit]
    );
    return c.json({
      tenants: rows.map(policyJson),
      next_after: rows.length === limit ? rows[rows.length - 1].tenant_id : null,
    });
  });

  app.get("/tenants/:tenant", async (c) => {
    const a = await auth(c);
    if ("res" in a) return a.res;
    const tenant = tenantParam(c);
    if (!tenant) return err(c, 400, "Invalid tenant id.");
    const { rows } = await pool.query(
      `SELECT tenant_id, auto_cache_control, keepalive_enabled, keepalive_budget_usd_daily,
              anthropic_cache_ttl, keepalive_max_slots, updated_at
         FROM key_tenant_policies WHERE api_key_id=$1 AND tenant_id=$2`,
      [a.key.id, tenant]
    );
    if (!rows[0]) return err(c, 404, "No policy row for this tenant — it inherits the key's settings.");
    return c.json(policyJson(rows[0]));
  });

  app.put("/tenants/:tenant", async (c) => {
    const a = await auth(c);
    if ("res" in a) return a.res;
    const tenant = tenantParam(c);
    if (!tenant) {
      return err(c, 400, "Invalid tenant id: 1-120 chars of letters, digits, . _ : -");
    }
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return err(c, 400, "Request body must be valid JSON.");
    }
    const sets: PolicyField[] = [];
    for (const f of POLICY_FIELDS) {
      if (!(f in body)) continue;
      const problem = validateField(f, body[f]);
      if (problem) return err(c, 400, problem);
      sets.push(f);
    }
    if (!sets.length) {
      return err(c, 400, `Nothing to set. Accepted fields: ${POLICY_FIELDS.join(", ")}`);
    }
    const { rows: cnt } = await pool.query(
      "SELECT count(*)::int AS n FROM key_tenant_policies WHERE api_key_id=$1",
      [a.key.id]
    );
    if (cnt[0].n >= MAX_TENANT_ROWS_PER_KEY) {
      return err(c, 400, "Tenant policy limit reached for this key.");
    }
    const cols = sets.map((f, i) => `${f}=$${i + 3}`).join(", ");
    const insertCols = sets.join(", ");
    const insertVals = sets.map((_, i) => `$${i + 3}`).join(", ");
    const { rows } = await pool.query(
      `INSERT INTO key_tenant_policies (api_key_id, tenant_id${insertCols ? ", " + insertCols : ""})
       VALUES ($1, $2${insertVals ? ", " + insertVals : ""})
       ON CONFLICT (api_key_id, tenant_id)
       DO UPDATE SET ${cols}, updated_at=now()
       RETURNING tenant_id, auto_cache_control, keepalive_enabled, keepalive_budget_usd_daily,
                 anthropic_cache_ttl, keepalive_max_slots, updated_at`,
      [a.key.id, tenant, ...sets.map((f) => body[f])]
    );
    clearTenantPolicyCache(); // policy changes apply within one cache window everywhere
    return c.json(policyJson(rows[0]));
  });

  app.delete("/tenants/:tenant", async (c) => {
    const a = await auth(c);
    if ("res" in a) return a.res;
    const tenant = tenantParam(c);
    if (!tenant) return err(c, 400, "Invalid tenant id.");
    const del = await pool.query(
      "DELETE FROM key_tenant_policies WHERE api_key_id=$1 AND tenant_id=$2",
      [a.key.id, tenant]
    );
    // stop warming this tenant's slots too — deleting the policy is the
    // "offboard this end-customer" action
    await pool.query(
      "DELETE FROM keepalive_state WHERE api_key_id=$1 AND tenant_id=$2",
      [a.key.id, tenant]
    );
    clearTenantPolicyCache();
    return c.json({ deleted: del.rowCount ?? 0 });
  });

  app.get("/tenants/:tenant/stats", async (c) => {
    const a = await auth(c);
    if ("res" in a) return a.res;
    const tenant = tenantParam(c);
    if (!tenant) return err(c, 400, "Invalid tenant id.");
    const days = Math.min(Math.max(Number(c.req.query("days") ?? 7) || 7, 1), 90);
    const { rows } = await pool.query(
      `SELECT count(*) FILTER (WHERE NOT is_keepalive)::int          AS requests,
              count(*) FILTER (WHERE is_keepalive)::int              AS warming_pings,
              COALESCE(sum(input_tokens), 0)::bigint                 AS input_tokens,
              COALESCE(sum(output_tokens), 0)::bigint                AS output_tokens,
              COALESCE(sum(cache_read_tokens), 0)::bigint            AS cache_read_tokens,
              COALESCE(sum(cache_creation_tokens), 0)::bigint        AS cache_write_tokens,
              COALESCE(sum(cost_usd), 0)::numeric                    AS cost_usd,
              COALESCE(sum(saved_usd), 0)::numeric                   AS saved_usd
         FROM request_logs
        WHERE api_key_id=$1 AND tenant_id=$2 AND ts >= now() - make_interval(days => $3)`,
      [a.key.id, tenant, days]
    );
    const r = rows[0];
    return c.json({
      tenant,
      days,
      requests: r.requests,
      warming_pings: r.warming_pings,
      input_tokens: Number(r.input_tokens),
      output_tokens: Number(r.output_tokens),
      cache_read_tokens: Number(r.cache_read_tokens),
      cache_write_tokens: Number(r.cache_write_tokens),
      cost_usd: Number(r.cost_usd),
      saved_usd: Number(r.saved_usd),
    });
  });

  // ---- enterprise gateway upstream (Anthropic wire) ----
  // Only operator-allowlisted gateways: a leaked ck_ key must never be able
  // to point this key's provider credential at an attacker-controlled host.
  const gatewayAllow = () =>
    (process.env.UPSTREAM_GATEWAY_ALLOW ?? "")
      .split(",")
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter(Boolean);

  app.get("/gateway", async (c) => {
    const a = await auth(c);
    if ("res" in a) return a.res;
    const { rows } = await pool.query(
      "SELECT upstream_gateway_url FROM api_keys WHERE id=$1", [a.key.id]);
    return c.json({ upstream_gateway_url: rows[0]?.upstream_gateway_url ?? null });
  });

  app.put("/gateway", async (c) => {
    const a = await auth(c);
    if ("res" in a) return a.res;
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return err(c, 400, "Request body must be valid JSON.");
    }
    const url = typeof body?.upstream_gateway_url === "string"
      ? body.upstream_gateway_url.trim().replace(/\/+$/, "") : "";
    // https only — except loopback, so self-hosters (and tests) can point at
    // a local gateway without a certificate
    if (!/^https:\/\/[^\s]+$/.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
      return err(c, 400, "upstream_gateway_url must be an https:// URL.");
    }
    const allow = gatewayAllow();
    if (!allow.includes(url)) {
      return err(c, 403,
        "This gateway is not on the approved list. Contact support to have your gateway approved.");
    }
    await pool.query("UPDATE api_keys SET upstream_gateway_url=$2 WHERE id=$1", [a.key.id, url]);
    // optional per-key gateway credential — gateways issue their own key formats,
    // so the account-level provider-key prefix check doesn't apply here. Stored
    // encrypted on THIS key only (api_keys.anthropic_key_encrypted override).
    const cred = body?.anthropic_key;
    if (typeof cred === "string" && cred.trim() && encryptionKey) {
      await pool.query("UPDATE api_keys SET anthropic_key_encrypted=$2 WHERE id=$1",
        [a.key.id, encrypt(cred.trim(), encryptionKey)]);
    }
    clearApiKeyCache();
    return c.json({ upstream_gateway_url: url, anthropic_key_set: typeof cred === "string" && !!cred.trim() });
  });

  app.delete("/gateway", async (c) => {
    const a = await auth(c);
    if ("res" in a) return a.res;
    await pool.query("UPDATE api_keys SET upstream_gateway_url=NULL WHERE id=$1", [a.key.id]);
    return c.json({ upstream_gateway_url: null });
  });

  return app;
}
