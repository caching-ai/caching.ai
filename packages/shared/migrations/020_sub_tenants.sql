-- Sub-tenants: one enterprise key serving many end-customers ("tenants"),
-- each with its own cache policy, usage attribution and warm slots — instead
-- of minting one ck_ key per end-customer. A platform (e.g. a coding-agent
-- SaaS) tags each request with X-Cache-Tenant; per-tenant policy rows are
-- managed programmatically with the key itself (/admin/v1/tenants).

-- usage attribution: which tenant a request (or warming ping) belonged to.
-- NULL = untagged traffic (all pre-existing rows).
ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS tenant_id text;
CREATE INDEX IF NOT EXISTS idx_request_logs_key_tenant_ts
  ON request_logs(api_key_id, tenant_id, ts DESC)
  WHERE tenant_id IS NOT NULL;

-- per-tenant policy overrides. A NULL column inherits the key's effective
-- setting (which itself already answers to enforced org policies). Tenants
-- do NOT need a row here — attribution and warm slots work headers-only.
CREATE TABLE IF NOT EXISTS key_tenant_policies (
  id                         bigserial PRIMARY KEY,
  api_key_id                 bigint NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  tenant_id                  text NOT NULL,
  auto_cache_control         boolean,
  keepalive_enabled          boolean,
  keepalive_budget_usd_daily numeric CHECK (keepalive_budget_usd_daily >= 0),
  anthropic_cache_ttl        text CHECK (anthropic_cache_ttl IN ('5m','1h')),
  keepalive_max_slots        int CHECK (keepalive_max_slots BETWEEN 1 AND 128),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (api_key_id, tenant_id)
);

-- warm slots: keepalive_state grows two identity dimensions. Historically one
-- row per (key, provider) meant one warm prefix per key — a platform key with
-- hundreds of concurrent end-users would thrash that single slot. Now each
-- tenant gets its own slots (one per X-Cache-Warm-Slot value, e.g. one per
-- end-user), pruned to the tenant's keepalive_max_slots. Existing rows keep
-- ('','') and behave exactly as before.
ALTER TABLE keepalive_state ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '';
ALTER TABLE keepalive_state ADD COLUMN IF NOT EXISTS slot text NOT NULL DEFAULT '';
-- the per-request X-Cache-Keepalive override captured at request time, so the
-- background sweep honors it: COALESCE(tenant policy, this, key setting).
ALTER TABLE keepalive_state ADD COLUMN IF NOT EXISTS header_keepalive boolean;
-- gateway-aware pings: custom x-* headers captured (encrypted) from the live
-- request and replayed on warming pings, so gateways that demand routing or
-- attribution headers (and bill per end-customer) see pings as that tenant.
ALTER TABLE keepalive_state ADD COLUMN IF NOT EXISTS encrypted_headers text;
ALTER TABLE keepalive_state DROP CONSTRAINT IF EXISTS keepalive_state_pkey;
ALTER TABLE keepalive_state ADD PRIMARY KEY (api_key_id, provider, tenant_id, slot);

-- enterprise gateway upstream: this key's Anthropic-wire traffic (and its
-- warming pings) go to a customer gateway (LLM router) instead of
-- api.anthropic.com. Settable only against the operator allowlist
-- (UPSTREAM_GATEWAY_ALLOW) — never an arbitrary URL.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS upstream_gateway_url text;
