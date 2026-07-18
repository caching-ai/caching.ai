// Public list prices, USD per MTok — a plain-JS port of the entries this
// benchmark uses from packages/shared/src/pricing*.ts (single source of truth
// in this repo; that file cites the provider pricing pages, 2026-07). All
// dollar figures in the results are usage tokens × these prices.
//
// Anthropic: cache write = 1.25x input (5m TTL), cache read = 0.1x input.
// OpenAI/Gemini/Grok: no write premium; cached tokens bill at cachedInputMult.

export const PRICES = {
  anthropic: [
    { match: "claude-sonnet-5", inputPerMTok: 3, outputPerMTok: 15, minCacheableTokens: 2048 },
    { match: "claude-haiku-4-5", inputPerMTok: 1, outputPerMTok: 5, minCacheableTokens: 4096 },
  ],
  openai: [
    // substring match, first hit wins — the gpt-5.6 family has its own list
    // prices (sol $5/$30, terra $2.5/$15, luna $1/$6) and bills cache WRITES
    // at 1.25x. ERRATA: run-20260718 priced gpt-5.6-sol via the "gpt-5" row
    // ($1.25/$10, write 1x) — its absolute dollar figures are ~4x low, the
    // A-vs-C ratios are unaffected (same mispricing in every arm).
    { match: "gpt-5.6-sol", inputPerMTok: 5, outputPerMTok: 30, cachedInputMult: 0.1, writeMult: 1.25 },
    { match: "gpt-5.6-terra", inputPerMTok: 2.5, outputPerMTok: 15, cachedInputMult: 0.1, writeMult: 1.25 },
    { match: "gpt-5.6-luna", inputPerMTok: 1, outputPerMTok: 6, cachedInputMult: 0.1, writeMult: 1.25 },
    { match: "gpt-5", inputPerMTok: 1.25, outputPerMTok: 10, cachedInputMult: 0.1 },
    { match: "gpt-4o", inputPerMTok: 2.5, outputPerMTok: 10, cachedInputMult: 0.5 },
  ],
  gemini: [
    { match: "gemini-2.5-flash", inputPerMTok: 0.3, outputPerMTok: 2.5, cachedInputMult: 0.25 },
  ],
  grok: [
    { match: "grok-4", inputPerMTok: 3, outputPerMTok: 15, cachedInputMult: 0.25 },
  ],
};

export const ANTHROPIC_CACHE_WRITE_5M_MULT = 1.25;
export const ANTHROPIC_CACHE_WRITE_1H_MULT = 2.0;
export const ANTHROPIC_CACHE_READ_MULT = 0.1;

export function priceFor(provider, model) {
  const m = (model || "").toLowerCase();
  const p = (PRICES[provider] || []).find((e) => m.includes(e.match));
  if (!p) throw new Error(`no price entry for ${provider}/${model} — add it to bench/lib/pricing.mjs`);
  return p;
}

/**
 * Cost of one call from normalized usage
 * {input, cacheWrite, cacheRead, output} (tokens).
 * Returns { inputSideUsd, outputUsd } — the benchmark's primary metric is
 * inputSideUsd (output cost is reported separately as a reference figure).
 */
export function costOf(provider, model, u) {
  const p = priceFor(provider, model);
  const per = p.inputPerMTok / 1e6;
  const perOut = p.outputPerMTok / 1e6;
  // Anthropic bills 5m cache writes at 1.25x and 1h writes at 2x (usage
  // breakdown in cacheWrite1h); GPT-5.6+ cache_write_tokens bill at 1.25x
  // (per-row writeMult), Gemini reports no write tokens.
  const readMult = provider === "anthropic" ? ANTHROPIC_CACHE_READ_MULT : p.cachedInputMult;
  const writeMult = provider === "anthropic" ? ANTHROPIC_CACHE_WRITE_5M_MULT : (p.writeMult ?? 1);
  const w1h = provider === "anthropic" ? (u.cacheWrite1h || 0) : 0;
  const w = Math.max(0, (u.cacheWrite || 0) - w1h);
  const inputSideUsd =
    (u.input || 0) * per +
    w * per * writeMult +
    w1h * per * ANTHROPIC_CACHE_WRITE_1H_MULT +
    (u.cacheRead || 0) * per * readMult;
  return { inputSideUsd, outputUsd: (u.output || 0) * perOut };
}
