-- Warming pings are Anthropic-only (measured, bench run-20260718):
-- gpt-4o retains upstream through sparse gaps, GPT-5.6+ showed no
-- cross-suffix prefix hits, Gemini implicit caching ignored pings, and Grok
-- pings burn separately-billed reasoning tokens. Stored non-Anthropic
-- prefixes are dead weight now — delete them (privacy: never keep encrypted
-- customer prompts we will not use).
DELETE FROM keepalive_state WHERE provider <> 'anthropic';

-- Long warm holds on a 5m-TTL key are served by ONE 1h-TTL cache write plus
-- a 55-minute refresh cadence instead of 4-minute pings. This column is that
-- cadence's claim/anchor: when the last 1h write is under an hour old the
-- entry is still alive.
ALTER TABLE keepalive_state ADD COLUMN IF NOT EXISTS last_1h_write_at timestamptz;
