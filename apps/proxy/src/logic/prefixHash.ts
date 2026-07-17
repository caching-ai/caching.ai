import { sha256Hex } from "@caching/shared";

export interface BlockHash {
  block: string;
  hash: string;
}

/**
 * P1-2: stable hashes for the cache-relevant prefix blocks.
 * tools / system / first user message. Comparing these across consecutive
 * requests reveals cache breakers (timestamps, random ids in the prompt).
 */
export function prefixBlockHashes(body: any): BlockHash[] {
  const out: BlockHash[] = [];
  if (body?.tools !== undefined) out.push({ block: "tools", hash: sha256Hex(JSON.stringify(body.tools)) });
  if (body?.system !== undefined) out.push({ block: "system", hash: sha256Hex(JSON.stringify(body.system)) });
  if (Array.isArray(body?.messages) && body.messages.length > 0) {
    out.push({ block: "msg0", hash: sha256Hex(JSON.stringify(body.messages[0])) });
  }
  return out;
}

/**
 * OpenAI chat/completions + Responses API. OpenAI caches 1024+ token stable
 * prefixes automatically, so instability in tools / the leading system
 * (or developer) message is exactly what silently disables their cache too.
 */
export function prefixBlockHashesOpenAI(body: any): BlockHash[] {
  const out: BlockHash[] = [];
  if (body?.tools !== undefined) out.push({ block: "tools", hash: sha256Hex(JSON.stringify(body.tools)) });
  if (typeof body?.instructions === "string") {
    // Responses API
    out.push({ block: "system", hash: sha256Hex(body.instructions) });
    const input = Array.isArray(body?.input) ? body.input[0] : body?.input;
    if (input !== undefined) out.push({ block: "msg0", hash: sha256Hex(JSON.stringify(input)) });
    return out;
  }
  if (Array.isArray(body?.messages) && body.messages.length > 0) {
    const first = body.messages[0];
    if (first?.role === "system" || first?.role === "developer") {
      out.push({ block: "system", hash: sha256Hex(JSON.stringify(first)) });
      if (body.messages[1] !== undefined) out.push({ block: "msg0", hash: sha256Hex(JSON.stringify(body.messages[1])) });
    } else {
      out.push({ block: "msg0", hash: sha256Hex(JSON.stringify(first)) });
    }
  }
  return out;
}

/** Gemini generateContent: systemInstruction / tools / first content. */
export function prefixBlockHashesGemini(body: any): BlockHash[] {
  const out: BlockHash[] = [];
  if (body?.tools !== undefined) out.push({ block: "tools", hash: sha256Hex(JSON.stringify(body.tools)) });
  const sys = body?.systemInstruction ?? body?.system_instruction;
  if (sys !== undefined) out.push({ block: "system", hash: sha256Hex(JSON.stringify(sys)) });
  if (Array.isArray(body?.contents) && body.contents.length > 0) {
    out.push({ block: "msg0", hash: sha256Hex(JSON.stringify(body.contents[0])) });
  }
  return out;
}

/**
 * A cache breaker is suspected when the front blocks (tools/system) changed
 * versus the previous request on the same key+model. msg0 changing is normal
 * (new conversations); system/tools changing per-request is the smoking gun.
 */
export function detectBreaker(prev: BlockHash[] | null | undefined, cur: BlockHash[]): boolean {
  if (!prev || prev.length === 0) return false;
  const find = (list: BlockHash[], name: string) => list.find((b) => b.block === name)?.hash;
  for (const name of ["tools", "system"]) {
    const p = find(prev, name);
    const c = find(cur, name);
    if (p !== undefined && c !== undefined && p !== c) return true;
  }
  return false;
}

/**
 * OpenAI keep-alive prefix (chat/completions only): tools + the leading run
 * of system/developer messages. Replaying it re-touches OpenAI's automatic
 * prefix cache before it expires.
 */
export function extractKeepalivePrefixOpenAI(body: any): {
  model: string;
  tools?: any;
  messages: any[];
} | null {
  if (!body?.model || !Array.isArray(body?.messages)) return null;
  const leading: any[] = [];
  for (const m of body.messages) {
    if (m?.role === "system" || m?.role === "developer") leading.push(m);
    else break;
  }
  if (leading.length === 0 && body.tools === undefined) return null;
  const out: any = { model: body.model, messages: leading };
  if (body.tools !== undefined) out.tools = body.tools;
  if (body.prompt_cache_key !== undefined) out.prompt_cache_key = body.prompt_cache_key;
  return out;
}

/** Gemini keep-alive prefix: systemInstruction + tools (implicit cache). */
export function extractKeepalivePrefixGemini(body: any, model: string): {
  model: string;
  systemInstruction?: any;
  tools?: any;
} | null {
  const sys = body?.systemInstruction ?? body?.system_instruction;
  if (sys === undefined && body?.tools === undefined) return null;
  const out: any = { model };
  if (sys !== undefined) out.systemInstruction = sys;
  if (body.tools !== undefined) out.tools = body.tools;
  return out;
}

/**
 * The keep-alive prefix: model + tools + system + messages up to (and
 * including) the last message that carries a cache_control breakpoint.
 * Replaying this exact prefix (plus a 1-token ping) refreshes the cache TTL.
 */
export function extractKeepalivePrefix(body: any): {
  model: string;
  system?: any;
  tools?: any;
  messages: any[];
} | null {
  if (!body?.model) return null;
  let lastBreakpointIdx = -1;
  if (Array.isArray(body.messages)) {
    body.messages.forEach((m: any, i: number) => {
      if (Array.isArray(m?.content) && m.content.some((b: any) => b?.cache_control)) {
        lastBreakpointIdx = i;
      }
    });
  }
  return {
    model: body.model,
    system: body.system,
    tools: body.tools,
    messages: lastBreakpointIdx >= 0 ? body.messages.slice(0, lastBreakpointIdx + 1) : [],
  };
}
