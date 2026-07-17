import type pg from "pg";

// Daily FX refresh so every locale can read money in its own currency.
// Source: open.er-api.com (free, no key, USD base). On any failure the table
// simply keeps its previous rates — consumers also carry static fallbacks.

export const FX_CODES = ["KRW", "JPY", "CNY", "EUR"] as const;

export async function fxSweep(pool: pg.Pool, fetchImpl: typeof fetch = fetch): Promise<number> {
  const res = await fetchImpl("https://open.er-api.com/v6/latest/USD", {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`fx source ${res.status}`);
  const data: any = await res.json();
  if (data?.result !== "success" || typeof data?.rates !== "object") {
    throw new Error("fx source returned an unexpected shape");
  }
  let updated = 0;
  for (const code of FX_CODES) {
    const rate = data.rates[code];
    if (typeof rate !== "number" || !(rate > 0)) continue;
    await pool.query(
      `INSERT INTO fx_rates (code, per_usd, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (code) DO UPDATE SET per_usd = $2, updated_at = now()`,
      [code, rate]
    );
    updated++;
  }
  return updated;
}

export function startFxLoop(pool: pg.Pool, intervalMs = 24 * 60 * 60 * 1000): NodeJS.Timeout {
  const run = () => {
    fxSweep(pool)
      .then((n) => console.log(`fx sweep: ${n} rate(s) refreshed`))
      .catch((e) => console.error("fx sweep error:", e.message));
  };
  const first = setTimeout(run, 90_000); // shortly after boot, post-migration
  first.unref?.();
  const t = setInterval(run, intervalMs);
  t.unref?.();
  return t;
}
