-- Postpaid dunning (industry-standard): failed/absent payments are retried
-- and reminded; past the grace window the account's OPTIMIZATION features
-- pause (traffic still passes through untouched) until payment clears.
ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_locked boolean NOT NULL DEFAULT false;

-- charge retry bookkeeping (previously: single attempt, manual retry only)
ALTER TABLE billing_charges ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 1;
ALTER TABLE billing_charges ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz NOT NULL DEFAULT now();
