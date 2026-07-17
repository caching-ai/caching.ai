// Gemini list prices, USD per MTok. Context caching bills cached tokens at
// cachedInputMult of the input price (plus storage, which we surface as an
// estimate note, not a line item). Source: Google AI pricing as of knowledge
// cutoff — ESTIMATES in the UI.

export interface GeminiPrice {
  match: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cachedInputMult: number;
}

export const GEMINI_PRICES: GeminiPrice[] = [
  { match: "gemini-2.5-flash-lite", inputPerMTok: 0.1, outputPerMTok: 0.4, cachedInputMult: 0.25 },
  { match: "gemini-2.5-flash", inputPerMTok: 0.3, outputPerMTok: 2.5, cachedInputMult: 0.25 },
  { match: "gemini-2.5-pro", inputPerMTok: 1.25, outputPerMTok: 10, cachedInputMult: 0.25 },
  { match: "gemini-3-flash", inputPerMTok: 0.3, outputPerMTok: 2.5, cachedInputMult: 0.25 },
  { match: "gemini-3-pro", inputPerMTok: 2, outputPerMTok: 12, cachedInputMult: 0.25 },
];

export const GEMINI_DEFAULT: GeminiPrice = {
  match: "*",
  inputPerMTok: 1.25,
  outputPerMTok: 10,
  cachedInputMult: 0.25,
};

export function geminiPriceFor(model: string): GeminiPrice {
  const m = (model || "").toLowerCase();
  return GEMINI_PRICES.find((p) => m.includes(p.match)) ?? GEMINI_DEFAULT;
}

export interface GeminiUsage {
  promptTokenCount: number;
  candidatesTokenCount: number;
  cachedContentTokenCount: number; // subset of promptTokenCount
}

export function computeCostGemini(model: string, u: GeminiUsage) {
  const p = geminiPriceFor(model);
  const per = p.inputPerMTok / 1_000_000;
  const perOut = p.outputPerMTok / 1_000_000;
  const cached = u.cachedContentTokenCount || 0;
  const fresh = Math.max(0, (u.promptTokenCount || 0) - cached);
  const actualUsd = fresh * per + cached * per * p.cachedInputMult + (u.candidatesTokenCount || 0) * perOut;
  const noCacheUsd = (u.promptTokenCount || 0) * per + (u.candidatesTokenCount || 0) * perOut;
  return { actualUsd, noCacheUsd, savedUsd: noCacheUsd - actualUsd };
}
