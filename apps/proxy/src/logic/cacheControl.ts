import { estimateTokens, priceFor, sha256Hex } from "@caching/shared";

/** true if any cache_control marker exists anywhere in the request body */
export function hasCacheControl(body: any): boolean {
  if (body?.cache_control) return true;
  const scanBlocks = (blocks: any): boolean =>
    Array.isArray(blocks) && blocks.some((b) => b && typeof b === "object" && b.cache_control);
  if (scanBlocks(body?.tools)) return true;
  if (scanBlocks(body?.system)) return true;
  if (Array.isArray(body?.messages)) {
    for (const m of body.messages) {
      if (scanBlocks(m?.content)) return true;
    }
  }
  return false;
}

/** rough token estimate of the cacheable prefix (tools + system) */
export function estimatePrefixTokens(body: any): number {
  let text = "";
  if (body?.tools) text += JSON.stringify(body.tools);
  if (typeof body?.system === "string") text += body.system;
  else if (Array.isArray(body?.system)) text += JSON.stringify(body.system);
  return estimateTokens(text);
}

export interface InjectResult {
  body: any;
  injected: boolean;
  reason?: "already-present" | "below-minimum" | "nothing-to-cache";
}

/**
 * P0-2: if the request has no cache_control at all, inject
 * {"type":"ephemeral"} on the last tools element and the last system block.
 * Never touches a request that already has any breakpoint.
 */
export type CacheTtl = "5m" | "1h";

export function injectCacheControl(body: any, model: string, ttl: CacheTtl = "5m"): InjectResult {
  if (hasCacheControl(body)) return { body, injected: false, reason: "already-present" };

  const min = priceFor(model).minCacheableTokens;
  if (estimatePrefixTokens(body) < min) {
    return { body, injected: false, reason: "below-minimum" };
  }

  const out = structuredClone(body);
  let touched = false;
  const cc = ttl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };

  if (Array.isArray(out.tools) && out.tools.length > 0) {
    const last = out.tools[out.tools.length - 1];
    if (last && typeof last === "object") {
      last.cache_control = { ...cc };
      touched = true;
    }
  }

  if (typeof out.system === "string" && out.system.length > 0) {
    out.system = [{ type: "text", text: out.system, cache_control: { ...cc } }];
    touched = true;
  } else if (Array.isArray(out.system) && out.system.length > 0) {
    const last = out.system[out.system.length - 1];
    if (last && typeof last === "object") {
      last.cache_control = { ...cc };
      touched = true;
    }
  }

  if (!touched) return { body, injected: false, reason: "nothing-to-cache" };
  return { body: out, injected: true };
}

// ---------- OpenAI GPT-5.6+ breakpoint injection ----------
// GPT-5.6 moved to breakpoint-scoped caching: implicit mode auto-places the
// only breakpoint on the LATEST message, so shared prefixes with varying
// suffixes never match (run-20260718: 0% cross-suffix hits over 3,240 calls).
// The documented remedy — an explicit prompt_cache_breakpoint at the end of
// the shared prefix plus a STABLE prompt_cache_key — was verified live
// (bench run-202607-v0100, S6 steady): cross-suffix hits went 0 -> 97.8% of the prefix.
// https://developers.openai.com/api/docs/guides/prompt-caching

/** gpt-5.6/5.7/…/6+ — the breakpoint-caching era */
export function isGpt56Plus(model: string): boolean {
  return /^gpt-(5\.(6|7|8|9)|[6-9])/.test((model || "").toLowerCase());
}

function hasOpenAIBreakpoint(body: any): boolean {
  if (!Array.isArray(body?.messages)) return false;
  return body.messages.some(
    (m: any) =>
      Array.isArray(m?.content) &&
      m.content.some((p: any) => p && typeof p === "object" && p.prompt_cache_breakpoint)
  );
}

// chars/3.5 over-estimates real tokens by ~1.37x (run-20260718) — 1400
// estimated ≈ the documented 1024-token cache minimum
const OPENAI_MIN_CACHEABLE_EST = 1400;

/**
 * For GPT-5.6+ chat/completions: place an explicit breakpoint on the last
 * message of the leading system/developer run and inject a stable
 * prompt_cache_key derived from tools + that run (NEVER from user messages —
 * a per-call key defeats cache routing; that mistake cost us hit rate in
 * run-20260718). Never touches a request that already carries any caching
 * parameter.
 */
export function injectOpenAIBreakpoint(body: any, model: string): InjectResult {
  if (!isGpt56Plus(model)) return { body, injected: false, reason: "below-minimum" };
  if (
    body?.prompt_cache_key !== undefined ||
    body?.prompt_cache_options !== undefined ||
    hasOpenAIBreakpoint(body)
  ) {
    return { body, injected: false, reason: "already-present" };
  }
  if (!Array.isArray(body?.messages)) return { body, injected: false, reason: "nothing-to-cache" };

  let lastLeading = -1;
  for (const [i, m] of body.messages.entries()) {
    if (m?.role === "system" || m?.role === "developer") lastLeading = i;
    else break;
  }
  if (lastLeading < 0) return { body, injected: false, reason: "nothing-to-cache" };

  const leading = body.messages.slice(0, lastLeading + 1);
  const prefixText = JSON.stringify(leading) + (body.tools ? JSON.stringify(body.tools) : "");
  if (estimateTokens(prefixText) < OPENAI_MIN_CACHEABLE_EST) {
    return { body, injected: false, reason: "below-minimum" };
  }

  const out = structuredClone(body);
  const target = out.messages[lastLeading];
  if (typeof target.content === "string") {
    target.content = [{ type: "text", text: target.content, prompt_cache_breakpoint: { mode: "explicit" } }];
  } else if (Array.isArray(target.content) && target.content.length > 0) {
    const last = target.content[target.content.length - 1];
    if (!last || typeof last !== "object") return { body, injected: false, reason: "nothing-to-cache" };
    last.prompt_cache_breakpoint = { mode: "explicit" };
  } else {
    return { body, injected: false, reason: "nothing-to-cache" };
  }
  out.prompt_cache_key = "cai-" + sha256Hex(prefixText).slice(0, 16);
  return { body: out, injected: true };
}

/**
 * Responses-API variant (verified live 2026-07-18: same part-level
 * `prompt_cache_breakpoint` shape works on /v1/responses — cross-suffix hits
 * 0 → 99.3%). The breakpoint lands on the last part of the leading
 * system/developer run in `input`. A string `instructions` prefix has no
 * part to carry a breakpoint, so instructions-only requests are skipped —
 * documented limitation.
 */
export function injectOpenAIBreakpointResponses(body: any, model: string): InjectResult {
  if (!isGpt56Plus(model)) return { body, injected: false, reason: "below-minimum" };
  if (body?.prompt_cache_key !== undefined || body?.prompt_cache_options !== undefined) {
    return { body, injected: false, reason: "already-present" };
  }
  const input = body?.input;
  if (!Array.isArray(input)) return { body, injected: false, reason: "nothing-to-cache" };
  const isLeadingRole = (it: any) =>
    it && (it.role === "system" || it.role === "developer") &&
    (it.type === undefined || it.type === "message");
  const hasBp = input.some(
    (it: any) =>
      Array.isArray(it?.content) &&
      it.content.some((p: any) => p && typeof p === "object" && p.prompt_cache_breakpoint)
  );
  if (hasBp) return { body, injected: false, reason: "already-present" };

  let lastLeading = -1;
  for (const [i, it] of input.entries()) {
    if (isLeadingRole(it)) lastLeading = i;
    else break;
  }
  if (lastLeading < 0) return { body, injected: false, reason: "nothing-to-cache" };

  const leading = input.slice(0, lastLeading + 1);
  const prefixText =
    (typeof body.instructions === "string" ? body.instructions : "") +
    JSON.stringify(leading) +
    (body.tools ? JSON.stringify(body.tools) : "");
  if (estimateTokens(prefixText) < OPENAI_MIN_CACHEABLE_EST) {
    return { body, injected: false, reason: "below-minimum" };
  }

  const out = structuredClone(body);
  const target = out.input[lastLeading];
  if (typeof target.content === "string") {
    target.content = [{ type: "input_text", text: target.content, prompt_cache_breakpoint: { mode: "explicit" } }];
  } else if (Array.isArray(target.content) && target.content.length > 0) {
    const last = target.content[target.content.length - 1];
    if (!last || typeof last !== "object") return { body, injected: false, reason: "nothing-to-cache" };
    last.prompt_cache_breakpoint = { mode: "explicit" };
  } else {
    return { body, injected: false, reason: "nothing-to-cache" };
  }
  out.prompt_cache_key = "cai-" + sha256Hex(prefixText).slice(0, 16);
  return { body: out, injected: true };
}

/**
 * Clone an Anthropic request/prefix with every cache_control marker upgraded
 * to the 1h TTL. Used by the keep-alive engine for long warm holds: one 2x
 * 1h write beats a 0.1x ping every 4 minutes once the hold exceeds ~30 min.
 */
export function upgradeCacheControlTo1h<T>(prefix: T): T {
  const out = structuredClone(prefix) as any;
  const upgrade = (blocks: any) => {
    if (!Array.isArray(blocks)) return;
    for (const b of blocks) {
      if (b && typeof b === "object" && b.cache_control?.type === "ephemeral") {
        b.cache_control = { type: "ephemeral", ttl: "1h" };
      }
    }
  };
  upgrade(out?.tools);
  upgrade(out?.system);
  if (Array.isArray(out?.messages)) {
    for (const m of out.messages) upgrade(m?.content);
  }
  return out;
}
