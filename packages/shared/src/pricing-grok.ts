// xAI (Grok) list prices, USD per MTok. The API is OpenAI-compatible and
// caches prompts automatically; cached tokens are reported in
// usage.prompt_tokens_details.cached_tokens and billed at cachedInputMult.
// Source: xAI pricing as of knowledge cutoff — ESTIMATES in the UI.

export interface GrokPrice {
  match: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cachedInputMult: number;
}

export const GROK_PRICES: GrokPrice[] = [
  { match: "grok-4-fast", inputPerMTok: 0.2, outputPerMTok: 0.5, cachedInputMult: 0.25 },
  { match: "grok-4", inputPerMTok: 3, outputPerMTok: 15, cachedInputMult: 0.25 },
  { match: "grok-3-mini", inputPerMTok: 0.3, outputPerMTok: 0.5, cachedInputMult: 0.25 },
  { match: "grok-3", inputPerMTok: 3, outputPerMTok: 15, cachedInputMult: 0.25 },
];

export const GROK_DEFAULT: GrokPrice = {
  match: "*",
  inputPerMTok: 3,
  outputPerMTok: 15,
  cachedInputMult: 0.25,
};

export function grokPriceFor(model: string): GrokPrice {
  const m = (model || "").toLowerCase();
  return GROK_PRICES.find((p) => m.includes(p.match)) ?? GROK_DEFAULT;
}

export function computeCostGrok(
  model: string,
  u: { prompt_tokens: number; completion_tokens: number; cached_tokens: number }
) {
  const p = grokPriceFor(model);
  const per = p.inputPerMTok / 1_000_000;
  const perOut = p.outputPerMTok / 1_000_000;
  const fresh = Math.max(0, (u.prompt_tokens || 0) - (u.cached_tokens || 0));
  const actualUsd =
    fresh * per + (u.cached_tokens || 0) * per * p.cachedInputMult + (u.completion_tokens || 0) * perOut;
  const noCacheUsd = (u.prompt_tokens || 0) * per + (u.completion_tokens || 0) * perOut;
  return { actualUsd, noCacheUsd, savedUsd: noCacheUsd - actualUsd };
}
