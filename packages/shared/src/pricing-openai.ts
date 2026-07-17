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

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number; // subset of prompt_tokens served from cache
}

export function computeCostOpenAI(model: string, u: OpenAIUsage) {
  const p = openaiPriceFor(model);
  const per = p.inputPerMTok / 1_000_000;
  const perOut = p.outputPerMTok / 1_000_000;
  const fresh = Math.max(0, (u.prompt_tokens || 0) - (u.cached_tokens || 0));
  const actualUsd = fresh * per + (u.cached_tokens || 0) * per * p.cachedInputMult + (u.completion_tokens || 0) * perOut;
  const noCacheUsd = (u.prompt_tokens || 0) * per + (u.completion_tokens || 0) * perOut;
  return { actualUsd, noCacheUsd, savedUsd: noCacheUsd - actualUsd };
}
