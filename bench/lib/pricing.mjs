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
    // substring match, first hit wins — gpt-5.5 / gpt-5.6-* all match "gpt-5"
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
  // Anthropic bills cache writes at a 1.25x premium; OpenAI's cache_write_tokens
  // bill at the plain input price (no premium), Gemini reports no write tokens.
  const readMult = provider === "anthropic" ? ANTHROPIC_CACHE_READ_MULT : p.cachedInputMult;
  const writeMult = provider === "anthropic" ? ANTHROPIC_CACHE_WRITE_5M_MULT : 1;
  const inputSideUsd =
    (u.input || 0) * per + (u.cacheWrite || 0) * per * writeMult + (u.cacheRead || 0) * per * readMult;
  return { inputSideUsd, outputUsd: (u.output || 0) * perOut };
}
