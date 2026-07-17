-- Per-key provider cache tuning.
--   anthropic_cache_ttl      '5m' (write 1.25x) | '1h' (write 2x, reads 0.1x —
--                            pays off when calls are >5min apart, ≥3 reads/hour)
--   openai_cache_retention   'default' (pass through) | '24h' (inject
--                            prompt_cache_retention when the caller sends none)
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS anthropic_cache_ttl text NOT NULL DEFAULT '5m'
    CHECK (anthropic_cache_ttl IN ('5m', '1h')),
  ADD COLUMN IF NOT EXISTS openai_cache_retention text NOT NULL DEFAULT 'default'
    CHECK (openai_cache_retention IN ('default', '24h'));
