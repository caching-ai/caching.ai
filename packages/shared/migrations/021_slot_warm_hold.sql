-- Per-slot warm hold: "keep my cache warm for 2 hours", typed in chat by an
-- END USER of a sub-tenant platform, must hold exactly that user's warm slot —
-- not the whole enterprise key (api_keys.keepalive_hold_until, which remains
-- the key-level hold for untagged traffic).
ALTER TABLE keepalive_state ADD COLUMN IF NOT EXISTS hold_until timestamptz;
