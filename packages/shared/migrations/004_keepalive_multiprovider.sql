-- Keep-alive per (key, provider): one warm prefix per provider per key.
ALTER TABLE keepalive_state ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'anthropic';
ALTER TABLE keepalive_state DROP CONSTRAINT IF EXISTS keepalive_state_pkey;
ALTER TABLE keepalive_state ADD PRIMARY KEY (api_key_id, provider);
