import { estimateTokens, priceFor } from "@caching/shared";

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
