-- Warm hold: an explicit "keep my cache warm while I'm away" window, set by
-- typing a hold command (cai:hold 2h / "캐시 2시간 지켜줘") into any chat that
-- runs through the proxy. While now() < keepalive_hold_until the keep-alive
-- sweep ignores its give-up window for the key; the daily budget still applies.
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS keepalive_hold_until timestamptz;
