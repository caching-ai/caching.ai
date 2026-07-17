-- Adaptive cache tuning (cloud feature, ee/adaptive-cache).
--   cache_tuning_mode  'manual' (default) | 'auto' — in auto mode a periodic
--                      sweep re-derives per-provider cache settings from the
--                      key's observed traffic and applies confident wins.
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS cache_tuning_mode text NOT NULL DEFAULT 'manual'
    CHECK (cache_tuning_mode IN ('manual', 'auto'));

-- Every automatic change is recorded with its full reasoning so the console
-- can explain, in plain language, why a setting is what it is.
CREATE TABLE IF NOT EXISTS tuning_decisions (
  id          bigserial PRIMARY KEY,
  api_key_id  bigint NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  setting     text NOT NULL,
  old_value   text,
  new_value   text NOT NULL,
  reason      jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tuning_decisions_key
  ON tuning_decisions(api_key_id, created_at DESC);
