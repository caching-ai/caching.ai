-- Card-on-file for postpaid performance-fee billing.
-- One payment method per user; psp is 'stripe' (global) or 'toss' (Korea).
CREATE TABLE IF NOT EXISTS payment_methods (
  user_id                  bigint PRIMARY KEY REFERENCES users(id),
  psp                      text NOT NULL,
  stripe_customer_id       text,
  stripe_payment_method_id text,
  toss_billing_key_encrypted text,
  toss_customer_key        text,
  card_label               text NOT NULL DEFAULT '',
  created_at               timestamptz NOT NULL DEFAULT now()
);

-- Charge attempts against closed billing periods. Money is only ever written
-- here through the charge sweep (never direct UPDATEs elsewhere).
CREATE TABLE IF NOT EXISTS billing_charges (
  id            bigserial PRIMARY KEY,
  user_id       bigint NOT NULL REFERENCES users(id),
  period_start  date NOT NULL,
  amount_usd    numeric NOT NULL,
  charged_amount numeric NOT NULL,
  currency      text NOT NULL,
  psp           text NOT NULL,
  psp_ref       text,
  status        text NOT NULL,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period_start)
);
