-- Multi-provider support (OpenAI / Gemini observation) + performance-fee metering

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS openai_key_encrypted text;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS gemini_key_encrypted text;

ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'anthropic';

-- Monthly performance-fee metering: recomputed idempotently from request_logs
-- (never incrementally mutated). fee = 20% of net verified savings.
CREATE TABLE IF NOT EXISTS billing_periods (
  id            bigserial PRIMARY KEY,
  user_id       bigint NOT NULL REFERENCES users(id),
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  gross_saved_usd    numeric NOT NULL DEFAULT 0,
  keepalive_cost_usd numeric NOT NULL DEFAULT 0,
  net_saved_usd      numeric NOT NULL DEFAULT 0,
  fee_usd            numeric NOT NULL DEFAULT 0,
  fee_rate           numeric NOT NULL DEFAULT 0.20,
  status        text NOT NULL DEFAULT 'beta_waived',
  computed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period_start)
);
