-- Teams admin API: org-scoped bearer tokens for programmatic member/department
-- management (bulk CSV imports, provisioning scripts). Tokens act with at most
-- admin privileges — never owner — and die with their creator's membership.

CREATE TABLE IF NOT EXISTS org_admin_tokens (
  id           bigserial PRIMARY KEY,
  org_id       bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name         text NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  created_by   bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_org_admin_tokens_org ON org_admin_tokens(org_id);
