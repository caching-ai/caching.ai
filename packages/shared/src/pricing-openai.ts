// OpenAI list prices, USD per MTok. cachedInputMult = price multiplier for
// tokens reported in usage.prompt_tokens_details.cached_tokens.
// OpenAI caches automatically (1024+ token stable prefixes) — nothing to
// inject; we observe, price, and flag prefix instability.
// Source: OpenAI pricing as of my knowledge cutoff — ESTIMATES in the UI.

export interface OpenAIPrice {
  match: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cachedInputMult: number;
}

export const OPENAI_PRICES: OpenAIPrice[] = [
  // GPT-5.6 family (breakpoint-caching era, 2026-07): cache reads 0.1x,
  // cache WRITES bill at 1.25x — see computeCostOpenAI.
  { match: "gpt-5.6-sol", inputPerMTok: 5, outputPerMTok: 30, cachedInputMult: 0.1 },
  { match: "gpt-5.6-terra", inputPerMTok: 2.5, outputPerMTok: 15, cachedInputMult: 0.1 },
  { match: "gpt-5.6-luna", inputPerMTok: 1, outputPerMTok: 6, cachedInputMult: 0.1 },
  { match: "gpt-5.6", inputPerMTok: 5, outputPerMTok: 30, cachedInputMult: 0.1 }, // unknown 5.6 variant: assume flagship
  { match: "gpt-5-mini", inputPerMTok: 0.25, outputPerMTok: 2, cachedInputMult: 0.1 },
  { match: "gpt-5-nano", inputPerMTok: 0.05, outputPerMTok: 0.4, cachedInputMult: 0.1 },
  { match: "gpt-5", inputPerMTok: 1.25, outputPerMTok: 10, cachedInputMult: 0.1 },
  { match: "gpt-4.1-mini", inputPerMTok: 0.4, outputPerMTok: 1.6, cachedInputMult: 0.25 },
  { match: "gpt-4.1-nano", inputPerMTok: 0.1, outputPerMTok: 0.4, cachedInputMult: 0.25 },
  { match: "gpt-4.1", inputPerMTok: 2, outputPerMTok: 8, cachedInputMult: 0.25 },
  { match: "gpt-4o-mini", inputPerMTok: 0.15, outputPerMTok: 0.6, cachedInputMult: 0.5 },
  { match: "gpt-4o", inputPerMTok: 2.5, outputPerMTok: 10, cachedInputMult: 0.5 },
  { match: "o4-mini", inputPerMTok: 1.1, outputPerMTok: 4.4, cachedInputMult: 0.25 },
  { match: "o3", inputPerMTok: 2, outputPerMTok: 8, cachedInputMult: 0.25 },
];

export const OPENAI_DEFAULT: OpenAIPrice = {
  match: "*",
  inputPerMTok: 2.5,
  outputPerMTok: 10,
  cachedInputMult: 0.5,
};

export function openaiPriceFor(model: string): OpenAIPrice {
  const m = (model || "").toLowerCase();
  return OPENAI_PRICES.find((p) => m.includes(p.match)) ?? OPENAI_DEFAULT;
}

// GPT-5.6-era cache writes (usage.prompt_tokens_details.cache_write_tokens,
// a subset of prompt_tokens) bill at 1.25x the uncached input rate.
export const OPENAI_CACHE_WRITE_MULT = 1.25;

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number; // subset of prompt_tokens served from cache
  cache_write_tokens?: number; // subset of prompt_tokens written to cache (5.6+)
}

export function computeCostOpenAI(model: string, u: OpenAIUsage) {
  const p = openaiPriceFor(model);
  const per = p.inputPerMTok / 1_000_000;
  const perOut = p.outputPerMTok / 1_000_000;
  const written = u.cache_write_tokens || 0;
  const fresh = Math.max(0, (u.prompt_tokens || 0) - (u.cached_tokens || 0) - written);
  const actualUsd =
    fresh * per +
    written * per * OPENAI_CACHE_WRITE_MULT +
    (u.cached_tokens || 0) * per * p.cachedInputMult +
    (u.completion_tokens || 0) * perOut;
  const noCacheUsd = (u.prompt_tokens || 0) * per + (u.completion_tokens || 0) * perOut;
  return { actualUsd, noCacheUsd, savedUsd: noCacheUsd - actualUsd };
}
