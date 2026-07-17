-- Billing/report sweeps range-scan request_logs by time across all users —
-- without a ts-leading index the planner falls back to seq scans that grow
-- with the table. (Safe inline at current size; use CONCURRENTLY manually on
-- an already-large self-hosted table.)
CREATE INDEX IF NOT EXISTS idx_request_logs_ts ON request_logs(ts);

-- The waitlist predates the launch; no code path reads or writes it anymore.
DROP TABLE IF EXISTS waitlist;
