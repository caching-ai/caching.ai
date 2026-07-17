-- OpenAI extended (24h) prompt-cache retention became the UPSTREAM default
-- for non-ZDR orgs (and GPT-5.6+ moved to prompt_cache_options, 30m only),
-- so the proxy no longer injects prompt_cache_retention at all. The per-key
-- setting's remaining job is telling keep-alive to skip redundant warming
-- pings — make '24h' the default and align keys still on the old default,
-- so nobody burns warming budget on a cache OpenAI already holds.
ALTER TABLE api_keys ALTER COLUMN openai_cache_retention SET DEFAULT '24h';
UPDATE api_keys SET openai_cache_retention = '24h' WHERE openai_cache_retention = 'default';
