// Anthropic list prices, USD per million tokens (MTok).
// Source: Anthropic docs as of 2026-06. Cache read = 0.1x input,
// cache write = 1.25x input (5m TTL) / 2x input (1h TTL).
// All customer-facing dollar figures derived from this table are ESTIMATES.

export interface ModelPrice {
  /** substring matched against the request's model id */
  match: string;
  inputPerMTok: number;
  outputPerMTok: number;
  /** minimum cacheable prefix in tokens (silently uncached below this) */
  minCacheableTokens: number;
}

// Ordered: first substring match wins. Longer/more specific first.
export const MODEL_PRICES: ModelPrice[] = [
  { match: "claude-fable-5", inputPerMTok: 10, outputPerMTok: 50, minCacheableTokens: 2048 },
  { match: "claude-mythos-5", inputPerMTok: 10, outputPerMTok: 50, minCacheableTokens: 2048 },
  { match: "claude-opus-4-8", inputPerMTok: 5, outputPerMTok: 25, minCacheableTokens: 4096 },
  { match: "claude-opus-4-7", inputPerMTok: 5, outputPerMTok: 25, minCacheableTokens: 4096 },
  { match: "claude-opus-4-6", inputPerMTok: 5, outputPerMTok: 25, minCacheableTokens: 4096 },
  { match: "claude-opus-4-5", inputPerMTok: 5, outputPerMTok: 25, minCacheableTokens: 4096 },
  { match: "claude-opus-4-1", inputPerMTok: 15, outputPerMTok: 75, minCacheableTokens: 1024 },
  { match: "claude-opus-4", inputPerMTok: 15, outputPerMTok: 75, minCacheableTokens: 1024 },
  { match: "claude-sonnet-5", inputPerMTok: 3, outputPerMTok: 15, minCacheableTokens: 2048 },
  { match: "claude-sonnet-4-6", inputPerMTok: 3, outputPerMTok: 15, minCacheableTokens: 2048 },
  { match: "claude-sonnet-4-5", inputPerMTok: 3, outputPerMTok: 15, minCacheableTokens: 1024 },
  { match: "claude-sonnet-4", inputPerMTok: 3, outputPerMTok: 15, minCacheableTokens: 1024 },
  { match: "claude-sonnet-3", inputPerMTok: 3, outputPerMTok: 15, minCacheableTokens: 1024 },
  { match: "claude-haiku-4-5", inputPerMTok: 1, outputPerMTok: 5, minCacheableTokens: 4096 },
  { match: "claude-3-5-haiku", inputPerMTok: 0.8, outputPerMTok: 4, minCacheableTokens: 2048 },
  { match: "claude-3-haiku", inputPerMTok: 0.25, outputPerMTok: 1.25, minCacheableTokens: 2048 },
];

export const DEFAULT_PRICE: ModelPrice = {
  match: "*",
  inputPerMTok: 5,
  outputPerMTok: 25,
  minCacheableTokens: 4096,
};

export const CACHE_READ_MULT = 0.1;
export const CACHE_WRITE_5M_MULT = 1.25;
export const CACHE_WRITE_1H_MULT = 2.0;

export function priceFor(model: string): ModelPrice {
  const m = (model || "").toLowerCase();
  return MODEL_PRICES.find((p) => m.includes(p.match)) ?? DEFAULT_PRICE;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  /** per-TTL write breakdown (Anthropic usage.cache_creation) — when present,
   * 1h writes are priced at their real 2x premium instead of the 5m 1.25x */
  cache_creation_5m_input_tokens?: number;
  cache_creation_1h_input_tokens?: number;
}

export interface CostBreakdown {
  /** what the customer actually paid (estimated, USD) */
  actualUsd: number;
  /** what the same request would have cost with zero caching */
  noCacheUsd: number;
  /** savings vs no caching (actual reads at 0.1x instead of 1x, minus write premium) */
  savedUsd: number;
}

/**
 * Cost of one request from its usage block.
 * When the usage carries Anthropic's per-TTL cache_creation breakdown, 1h
 * writes are billed at their real 2x premium; otherwise all writes are
 * assumed 5m (1.25x) as before.
 */
export function computeCost(model: string, u: Usage): CostBreakdown {
  const p = priceFor(model);
  const per = p.inputPerMTok / 1_000_000;
  const perOut = p.outputPerMTok / 1_000_000;
  const inTok = u.input_tokens || 0;
  const outTok = u.output_tokens || 0;
  const cw = u.cache_creation_input_tokens || 0;
  const cr = u.cache_read_input_tokens || 0;
  const cw1h = u.cache_creation_1h_input_tokens || 0;
  const cw5m = u.cache_creation_5m_input_tokens ?? Math.max(0, cw - cw1h);

  const actualUsd =
    inTok * per +
    cw5m * per * CACHE_WRITE_5M_MULT +
    cw1h * per * CACHE_WRITE_1H_MULT +
    cr * per * CACHE_READ_MULT +
    outTok * perOut;
  const noCacheUsd = (inTok + cw + cr) * per + outTok * perOut;
  return { actualUsd, noCacheUsd, savedUsd: noCacheUsd - actualUsd };
}

/** rough token estimate from a string (chars / 3.5 — Anthropic English average) */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}
