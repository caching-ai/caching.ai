export * from "./pricing";
export * from "./pricing-openai";
export * from "./pricing-gemini";
export * from "./pricing-grok";
export * from "./crypto";
export * from "./db";

import { priceFor, CACHE_READ_MULT } from "./pricing";
import { openaiPriceFor } from "./pricing-openai";
import { geminiPriceFor } from "./pricing-gemini";
import { grokPriceFor } from "./pricing-grok";

export type Provider = "anthropic" | "openai" | "gemini" | "grok";

/**
 * Estimated USD wasted per input token that was NOT served from cache but
 * could have been (full price paid minus the cached price it could have had).
 */
export function wastePerInputTokenUsd(provider: Provider, model: string): number {
  if (provider === "openai") {
    const p = openaiPriceFor(model);
    return (p.inputPerMTok / 1_000_000) * (1 - p.cachedInputMult);
  }
  if (provider === "grok") {
    const p = grokPriceFor(model);
    return (p.inputPerMTok / 1_000_000) * (1 - p.cachedInputMult);
  }
  if (provider === "gemini") {
    const p = geminiPriceFor(model);
    return (p.inputPerMTok / 1_000_000) * (1 - p.cachedInputMult);
  }
  const p = priceFor(model);
  return (p.inputPerMTok / 1_000_000) * (1 - CACHE_READ_MULT);
}

// (openaiCacheClass removed: warming pings are Anthropic-only since bench
// run-20260718 measured OpenAI retention outlasting sparse gaps on every
// class — see apps/proxy/src/keepalive.ts header for the evidence.)
