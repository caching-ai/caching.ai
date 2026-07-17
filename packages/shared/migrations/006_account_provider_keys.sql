-- Account-level provider keys (BYOK). Per-api_key columns become overrides:
-- the proxy resolves COALESCE(api_keys.<provider>_key_encrypted, user default).
CREATE TABLE IF NOT EXISTS user_provider_keys (
  user_id       bigint NOT NULL REFERENCES users(id),
  provider      text NOT NULL,
  key_encrypted text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);

-- Backfill: promote each user's most recently registered per-key provider key
-- to the account default, so existing traffic keeps flowing and new ck_ keys
-- work without re-entering provider keys.
INSERT INTO user_provider_keys(user_id, provider, key_encrypted)
SELECT DISTINCT ON (user_id) user_id, 'anthropic', anthropic_key_encrypted
  FROM api_keys WHERE anthropic_key_encrypted IS NOT NULL
 ORDER BY user_id, id DESC
ON CONFLICT DO NOTHING;

INSERT INTO user_provider_keys(user_id, provider, key_encrypted)
SELECT DISTINCT ON (user_id) user_id, 'openai', openai_key_encrypted
  FROM api_keys WHERE openai_key_encrypted IS NOT NULL
 ORDER BY user_id, id DESC
ON CONFLICT DO NOTHING;

INSERT INTO user_provider_keys(user_id, provider, key_encrypted)
SELECT DISTINCT ON (user_id) user_id, 'gemini', gemini_key_encrypted
  FROM api_keys WHERE gemini_key_encrypted IS NOT NULL
 ORDER BY user_id, id DESC
ON CONFLICT DO NOTHING;

INSERT INTO user_provider_keys(user_id, provider, key_encrypted)
SELECT DISTINCT ON (user_id) user_id, 'grok', grok_key_encrypted
  FROM api_keys WHERE grok_key_encrypted IS NOT NULL
 ORDER BY user_id, id DESC
ON CONFLICT DO NOTHING;
