CREATE TABLE IF NOT EXISTS users (
  id            bigserial PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id                        bigserial PRIMARY KEY,
  user_id                   bigint NOT NULL REFERENCES users(id),
  name                      text NOT NULL DEFAULT 'default',
  key_hash                  text NOT NULL UNIQUE,
  key_prefix_display        text NOT NULL,
  anthropic_key_encrypted   text,
  auto_cache_control        boolean NOT NULL DEFAULT true,
  keepalive_enabled         boolean NOT NULL DEFAULT false,
  keepalive_budget_usd_daily numeric NOT NULL DEFAULT 1.0,
  created_at                timestamptz NOT NULL DEFAULT now(),
  revoked_at                timestamptz
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

CREATE TABLE IF NOT EXISTS request_logs (
  id                     bigserial PRIMARY KEY,
  api_key_id             bigint NOT NULL REFERENCES api_keys(id),
  ts                     timestamptz NOT NULL DEFAULT now(),
  model                  text NOT NULL DEFAULT '',
  status                 int NOT NULL DEFAULT 0,
  latency_ms             int NOT NULL DEFAULT 0,
  is_stream              boolean NOT NULL DEFAULT false,
  is_keepalive           boolean NOT NULL DEFAULT false,
  input_tokens           bigint NOT NULL DEFAULT 0,
  output_tokens          bigint NOT NULL DEFAULT 0,
  cache_creation_tokens  bigint NOT NULL DEFAULT 0,
  cache_read_tokens      bigint NOT NULL DEFAULT 0,
  cost_usd               numeric NOT NULL DEFAULT 0,
  no_cache_cost_usd      numeric NOT NULL DEFAULT 0,
  saved_usd              numeric NOT NULL DEFAULT 0,
  prefix_block_hashes    jsonb,
  cache_breaker_detected boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_request_logs_key_ts ON request_logs(api_key_id, ts DESC);

CREATE TABLE IF NOT EXISTS keepalive_state (
  api_key_id            bigint PRIMARY KEY REFERENCES api_keys(id),
  encrypted_prefix      text,
  model                 text NOT NULL DEFAULT '',
  prefix_token_estimate int NOT NULL DEFAULT 0,
  last_request_at       timestamptz,
  last_ping_at          timestamptz,
  pings_today           int NOT NULL DEFAULT 0,
  spend_today_usd       numeric NOT NULL DEFAULT 0,
  spend_day             date NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS waitlist (
  id         bigserial PRIMARY KEY,
  email      text NOT NULL,
  company    text,
  created_at timestamptz NOT NULL DEFAULT now()
);
