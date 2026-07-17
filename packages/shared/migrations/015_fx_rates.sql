-- Daily-refreshed FX rates (units of `code` per 1 USD). Written by the
-- proxy's fx sweep, read by the console (budget input in local currency)
-- and the landing calculator. Static fallbacks live in code — an empty or
-- stale table never breaks anything.
CREATE TABLE IF NOT EXISTS fx_rates (
  code       text NOT NULL PRIMARY KEY,
  per_usd    numeric NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
