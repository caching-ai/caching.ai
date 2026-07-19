-- caching.ai for Teams: organizations, membership, invites, org BYOK,
-- policy tiers, budgets, audit, org billing. Design follows a shared-tenancy
-- enterprise pattern: members stay ordinary users rows — membership is a set
-- of pointer columns — so every existing per-user isolation/billing path
-- keeps working; org state lives in its own tables, strictly separated from
-- personal billing and provider keys.

CREATE TABLE IF NOT EXISTS organizations (
  id              bigserial PRIMARY KEY,
  name            text NOT NULL,
  -- v1: one owned org per user; ownership transfer is not self-serve
  owner_user_id   bigint NOT NULL UNIQUE REFERENCES users(id),
  locale          text NOT NULL DEFAULT 'en',
  billing_locked  boolean NOT NULL DEFAULT false,
  max_members     int NOT NULL DEFAULT 500,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE TABLE IF NOT EXISTS org_departments (
  id          bigserial PRIMARY KEY,
  org_id      bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

-- membership = pointer columns (one org per user, v1)
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id bigint REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_role text CHECK (org_role IN ('owner','admin','member'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_department_id bigint REFERENCES org_departments(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_joined_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id) WHERE org_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS org_invites (
  id            bigserial PRIMARY KEY,
  org_id        bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email         text NOT NULL,
  role          text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  department_id bigint REFERENCES org_departments(id) ON DELETE SET NULL,
  token_hash    text NOT NULL UNIQUE,
  invited_by    bigint NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  accepted_by   bigint REFERENCES users(id),
  revoked_at    timestamptz
);
-- one live invite per email per org; re-inviting revokes and re-issues
CREATE UNIQUE INDEX IF NOT EXISTS org_invites_pending_uidx
  ON org_invites(org_id, lower(email)) WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- org BYOK: the shared provider account is what makes caches shared — every
-- member's traffic egresses through the same provider account, so identical
-- prefixes warm and hit for each other.
CREATE TABLE IF NOT EXISTS org_provider_keys (
  org_id        bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider      text NOT NULL,
  key_encrypted text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, provider)
);

-- ck_ keys minted in the org workspace belong to the org (org_id set);
-- personal keys keep org_id NULL and are untouched by any org logic
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS org_id bigint REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys(org_id) WHERE org_id IS NOT NULL;

-- policy tiers: org-wide defaults, department overrides, member overrides.
-- NULL columns inherit from the broader scope. enforce=false → the policy is
-- only the DEFAULT for newly minted keys; enforce=true → it overrides member
-- key settings at request time (member > department > org).
CREATE TABLE IF NOT EXISTS org_cache_policies (
  id              bigserial PRIMARY KEY,
  org_id          bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope           text NOT NULL CHECK (scope IN ('org','department','member')),
  department_id   bigint REFERENCES org_departments(id) ON DELETE CASCADE,
  member_user_id  bigint REFERENCES users(id) ON DELETE CASCADE,
  auto_cache_control boolean,
  keepalive_enabled  boolean,
  keepalive_budget_usd_daily numeric,
  anthropic_cache_ttl text CHECK (anthropic_cache_ttl IN ('5m','1h')),
  cache_tuning_mode   text CHECK (cache_tuning_mode IN ('manual','auto')),
  enforce         boolean NOT NULL DEFAULT false,
  updated_by      bigint REFERENCES users(id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (scope = 'org' AND department_id IS NULL AND member_user_id IS NULL) OR
    (scope = 'department' AND department_id IS NOT NULL AND member_user_id IS NULL) OR
    (scope = 'member' AND member_user_id IS NOT NULL AND department_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS org_policy_org_uidx
  ON org_cache_policies(org_id) WHERE scope = 'org';
CREATE UNIQUE INDEX IF NOT EXISTS org_policy_dept_uidx
  ON org_cache_policies(org_id, department_id) WHERE scope = 'department';
CREATE UNIQUE INDEX IF NOT EXISTS org_policy_member_uidx
  ON org_cache_policies(org_id, member_user_id) WHERE scope = 'member';

-- monthly spend budgets: warn (email at 80%/100%) or block (proxy rejects
-- once the month's actual spend crosses the limit)
CREATE TABLE IF NOT EXISTS org_budgets (
  id                bigserial PRIMARY KEY,
  org_id            bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope             text NOT NULL CHECK (scope IN ('org','department','member')),
  department_id     bigint REFERENCES org_departments(id) ON DELETE CASCADE,
  member_user_id    bigint REFERENCES users(id) ON DELETE CASCADE,
  monthly_limit_usd numeric NOT NULL CHECK (monthly_limit_usd > 0),
  action            text NOT NULL DEFAULT 'warn' CHECK (action IN ('warn','block')),
  updated_by        bigint REFERENCES users(id),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (scope = 'org' AND department_id IS NULL AND member_user_id IS NULL) OR
    (scope = 'department' AND department_id IS NOT NULL AND member_user_id IS NULL) OR
    (scope = 'member' AND member_user_id IS NOT NULL AND department_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS org_budget_org_uidx
  ON org_budgets(org_id) WHERE scope = 'org';
CREATE UNIQUE INDEX IF NOT EXISTS org_budget_dept_uidx
  ON org_budgets(org_id, department_id) WHERE scope = 'department';
CREATE UNIQUE INDEX IF NOT EXISTS org_budget_member_uidx
  ON org_budgets(org_id, member_user_id) WHERE scope = 'member';
-- 80%/100% warn emails are sent once per threshold per month
CREATE TABLE IF NOT EXISTS org_budget_alerts (
  budget_id  bigint NOT NULL REFERENCES org_budgets(id) ON DELETE CASCADE,
  month      date NOT NULL,
  threshold  int NOT NULL,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (budget_id, month, threshold)
);

-- every admin action is recorded (actor_email survives account deletion)
CREATE TABLE IF NOT EXISTS org_audit_log (
  id             bigserial PRIMARY KEY,
  org_id         bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id  bigint REFERENCES users(id) ON DELETE SET NULL,
  actor_email    text NOT NULL DEFAULT '',
  action         text NOT NULL,
  target         text NOT NULL DEFAULT '',
  detail         jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_org_audit_org_ts ON org_audit_log(org_id, created_at DESC);

-- org billing mirrors the personal performance-fee pipeline, strictly apart:
-- org keys are excluded from personal billing_periods and vice versa
CREATE TABLE IF NOT EXISTS org_payment_methods (
  org_id                     bigint PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  psp                        text NOT NULL,
  stripe_customer_id         text,
  stripe_payment_method_id   text,
  toss_billing_key_encrypted text,
  toss_customer_key          text,
  card_label                 text NOT NULL DEFAULT '',
  created_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS org_billing_periods (
  id            bigserial PRIMARY KEY,
  org_id        bigint NOT NULL REFERENCES organizations(id),
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  gross_saved_usd    numeric NOT NULL DEFAULT 0,
  keepalive_cost_usd numeric NOT NULL DEFAULT 0,
  net_saved_usd      numeric NOT NULL DEFAULT 0,
  fee_usd            numeric NOT NULL DEFAULT 0,
  fee_rate           numeric NOT NULL DEFAULT 0.20,
  status        text NOT NULL DEFAULT 'beta_waived',
  computed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, period_start)
);

CREATE TABLE IF NOT EXISTS org_billing_charges (
  id              bigserial PRIMARY KEY,
  org_id          bigint NOT NULL REFERENCES organizations(id),
  period_start    date NOT NULL,
  amount_usd      numeric NOT NULL,
  charged_amount  numeric NOT NULL,
  currency        text NOT NULL,
  psp             text NOT NULL,
  psp_ref         text,
  status          text NOT NULL,
  error           text,
  attempts        int NOT NULL DEFAULT 1,
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, period_start)
);

-- shared-warming dedupe: within an org, identical prefixes (same provider
-- account → same provider cache entry) need only ONE warming ping. The hash
-- is over the decrypted prefix JSON; stored in the clear (it reveals nothing).
ALTER TABLE keepalive_state ADD COLUMN IF NOT EXISTS prefix_sha text;
