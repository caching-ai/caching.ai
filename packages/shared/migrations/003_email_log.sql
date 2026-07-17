-- Outbound email dedup guard: at most one email per (user, kind, period).
CREATE TABLE IF NOT EXISTS email_log (
  id         bigserial PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id),
  kind       text NOT NULL,
  period_key text NOT NULL,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, period_key)
);
