// The benchmark matrix: which models run which scenarios, and what the three
// arms mean. Model aliases keep file names and ck_ key names short.
//
// Arms:
//   A direct-naive — provider API called directly, no cache hints at all
//                    (what an SDK does out of the box)
//   B direct-tuned — provider API called directly with hand-placed cache
//                    hints (Anthropic cache_control on last system block +
//                    last tool). Only exists where the provider has a knob:
//                    OpenAI/Gemini/Grok cache automatically, so A ≡ B there
//                    and those models run 2 arms.
//   C caching.ai   — same request through proxy.caching.ai with a ck_ key at
//                    its default settings (+ keep-alive on where the scenario
//                    says so). Keep-alive ping costs are added to C's total.

export const MODELS = {
  haiku:    { provider: "anthropic", id: "claude-haiku-4-5-20251001" },
  sonnet:   { provider: "anthropic", id: "claude-sonnet-5" },
  gpt56:    { provider: "openai",    id: "gpt-5.6-sol" },   // 30m server-side cache window
  gpt55:    { provider: "openai",    id: "gpt-5.5" },       // 24h retention — warming is skipped upstream AND by the proxy
  gpt4o:    { provider: "openai",    id: "gpt-4o" },        // in-memory ~5-10m cache
  gemini25: { provider: "gemini",    id: "gemini-2.5-flash" }, // implicit caching, no knobs
  grok4:    { provider: "grok",      id: "grok-4.5" },      // requires an xAI key; reasoning tokens counted as output
};

// scenario -> model aliases (cost control: not the full cross product)
export const MATRIX = {
  S1: ["haiku", "sonnet"],
  S2: ["haiku", "sonnet", "gpt56", "gpt4o", "gpt55", "gemini25"],
  S3: ["haiku"],
  S4: ["haiku", "gpt56", "gpt4o", "grok4"],
  S5: ["haiku"],
  S6: ["haiku", "gpt56", "gemini25"],
};

export const REPS = 3;

export function armsFor(provider) {
  return provider === "anthropic" ? ["A", "B", "C"] : ["A", "C"];
}

export function ckKeyName(scenario, modelAlias, rep) {
  return `bench-${scenario}-${modelAlias}-r${rep}`;
}
