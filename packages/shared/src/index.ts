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

/**
 * How OpenAI retains a prompt cache for a given model (per the official
 * prompt-caching guide, 2026-07):
 *   '24h'    gpt-4.1*, gpt-5, gpt-5.1–5.5*: extended retention is the
 *            upstream DEFAULT for non-ZDR orgs — warming pings only burn budget
 *   '30m'    gpt-5.6+ / gpt-6+: prompt_cache_options era, fixed ~30m window —
 *            one ping per window keeps it warm
 *   'memory' everything else (gpt-4o, o-series, unknown): in-memory ~5-10m
 */
export function openaiCacheClass(model: string): "24h" | "30m" | "memory" {
  const m = model.toLowerCase();
  if (/^gpt-(4\.1|5(\.[1-5])?)($|-)/.test(m)) return "24h";
  if (/^gpt-(5\.(6|7|8|9)|[6-9])/.test(m)) return "30m";
  return "memory";
}
