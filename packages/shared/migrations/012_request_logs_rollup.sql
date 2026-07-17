-- Daily rollup of request_logs (scale + long-range analytics).
-- The proxy's rollup loop aggregates every complete UTC day into this table,
-- then prunes raw request_logs rows older than the retention window
-- (LOG_RETENTION_DAYS, default 100 — always longer than the console's 90-day
-- view, which keeps reading raw rows). One row per day×key×provider×model.
CREATE TABLE IF NOT EXISTS request_logs_daily (
  day                    date   NOT NULL,
  api_key_id             bigint NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  provider               text   NOT NULL DEFAULT 'anthropic',
  model                  text   NOT NULL DEFAULT '',
  requests               int    NOT NULL DEFAULT 0, -- non-keepalive
  errors                 int    NOT NULL DEFAULT 0, -- non-keepalive, status >= 400
  keepalive_pings        int    NOT NULL DEFAULT 0,
  input_tokens           bigint NOT NULL DEFAULT 0,
  output_tokens          bigint NOT NULL DEFAULT 0,
  cache_creation_tokens  bigint NOT NULL DEFAULT 0,
  cache_read_tokens      bigint NOT NULL DEFAULT 0,
  -- full-price input on requests that had no cache read (waste estimation)
  uncached_input_tokens  bigint NOT NULL DEFAULT 0,
  cost_usd               numeric NOT NULL DEFAULT 0,
  saved_usd              numeric NOT NULL DEFAULT 0,
  keepalive_cost_usd     numeric NOT NULL DEFAULT 0,
  breakers               int    NOT NULL DEFAULT 0,
  -- percentiles can't be aggregated; sum+samples keeps the daily mean
  latency_ms_sum         bigint NOT NULL DEFAULT 0,
  latency_samples        int    NOT NULL DEFAULT 0,
  PRIMARY KEY (day, api_key_id, provider, model)
);
CREATE INDEX IF NOT EXISTS idx_request_logs_daily_key
  ON request_logs_daily(api_key_id, day DESC);
