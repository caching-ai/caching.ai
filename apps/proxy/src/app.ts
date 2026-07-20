import { Hono } from "hono";
import type { Context } from "hono";
import type pg from "pg";
import {
  decrypt,
  computeCost,
  computeCostOpenAI,
  computeCostGemini,
  computeCostGrok,
  type Usage,
} from "@caching/shared";
import {
  injectCacheControl,
  injectOpenAIBreakpoint,
  injectOpenAIBreakpointResponses,
  estimatePrefixTokens,
} from "./logic/cacheControl.js";
import { sha256Hex } from "@caching/shared";
import {
  prefixBlockHashes,
  prefixBlockHashesOpenAI,
  prefixBlockHashesGemini,
  detectBreaker,
  extractKeepalivePrefix,
  type BlockHash,
} from "./logic/prefixHash.js";
import { tapSse, tapSseUsage, emptyUsage, mergeUsage } from "./logic/usageTap.js";
import { metricsHandler } from "./metrics.js";
import { PROXY_VERSION } from "./config.js";
import {
  parseWarmHold,
  lastUserTextAnthropic,
  lastUserTextOpenAI,
  lastUserTextResponses,
  lastUserTextGemini,
  holdReplyText,
  type WarmHold,
  type HoldOutcome,
} from "./logic/warmHold.js";
import {
  anthropicHoldResponse,
  openaiHoldResponse,
  responsesHoldResponse,
  geminiHoldResponse,
} from "./logic/holdResponse.js";
import { noteBreakerObservation, injectionPaused } from "./logic/breakerPause.js";
import { orgBudgetBlocked } from "./logic/orgBudget.js";
import {
  findApiKey,
  insertRequestLog,
  lastPrefixHashes,
  saveKeepaliveState,
  type ApiKeyRow,
  type CostBreakdown,
} from "./store.js";

export interface AppDeps {
  pool: pg.Pool;
  upstreamUrl: string; // Anthropic
  openaiUpstreamUrl?: string;
  geminiUpstreamUrl?: string;
  grokUpstreamUrl?: string;
  encryptionKey: string;
  fetchImpl?: typeof fetch;
}

const HOP_HEADERS = new Set([
  "host", "connection", "keep-alive", "transfer-encoding", "upgrade",
  "proxy-authenticate", "proxy-authorization", "te", "trailer",
  "content-length", "accept-encoding",
  // edge/CDN metadata must never reach the upstream — forwarding cf-* or
  // cdn-loop to a Cloudflare-fronted API (api.anthropic.com etc.) makes
  // their edge reject the request outright (error 1000).
  "forwarded", "x-real-ip", "true-client-ip", "cdn-loop",
]);

function isEdgeHeader(name: string): boolean {
  return name.startsWith("cf-") || name.startsWith("x-forwarded-") || name.startsWith("x-vercel-");
}

const OPENAI_PATHS = new Set([
  "/v1/chat/completions",
  "/v1/responses",
  "/v1/completions",
  "/v1/embeddings",
]);

function jsonError(type: string, message: string, status: number) {
  return new Response(JSON.stringify({ type: "error", error: { type, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const CONSOLE_KEYS_URL = process.env.CONSOLE_URL ?? "https://caching.ai/console/keys";
// Providers accept large multimodal payloads, but unbounded JSON parsing is an
// OOM vector — cap far above any legitimate request.
const MAX_JSON_BODY_BYTES = 50 * 1024 * 1024;

const authError = (m: string, s: 401 | 403 = 401) => jsonError("authentication_error", m, s);
const serviceError = () => jsonError("api_error", "Temporary service issue. Please retry.", 503);

function humanizeUpstreamAuthError(providerLabel: string): Response {
  return authError(
    `The ${providerLabel} API key linked to this Caching.ai key was rejected by the provider. Update it in your console at ${CONSOLE_KEYS_URL}.`
  );
}

/** ck_ key from x-api-key, Authorization: Bearer, x-goog-api-key, or ?key= */
function extractCk(c: Context): string | null {
  const cands = [
    c.req.header("x-api-key"),
    c.req.header("authorization")?.replace(/^Bearer\s+/i, ""),
    c.req.header("x-goog-api-key"),
    new URL(c.req.url).searchParams.get("key") ?? undefined,
  ];
  return cands.find((v) => v?.startsWith("ck_")) ?? null;
}

function tooLarge(c: Context): Response | null {
  const len = Number(c.req.header("content-length") ?? 0);
  if (Number.isFinite(len) && len > MAX_JSON_BODY_BYTES) {
    return jsonError("invalid_request_error", "Request body too large.", 413);
  }
  return null;
}

class BodyTooLargeError extends Error {}

/** Read + parse a JSON body while enforcing MAX_JSON_BODY_BYTES on the bytes
 *  actually received. content-length can be omitted (chunked transfer) to slip
 *  past a header-only check, so we count bytes off the stream and abort once the
 *  cap is crossed — a valid ck_ key otherwise gets to OOM the shared process. */
async function readJsonCapped(c: Context, maxBytes = MAX_JSON_BODY_BYTES): Promise<any> {
  const stream = c.req.raw.body;
  if (!stream) return {};
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) throw new BodyTooLargeError();
      chunks.push(value);
    }
  } finally {
    try { await reader.cancel(); } catch { /* already drained/closed */ }
  }
  return JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
}

/** Upstream fetch with a hang guard; maps aborts/refusals to clean errors. */
async function upstreamFetch(
  doFetch: typeof fetch, url: URL, init: RequestInit, timeoutMs: number
): Promise<Response> {
  try {
    return await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const name = (e as Error)?.name ?? "";
    if (name === "TimeoutError" || name === "AbortError") {
      return jsonError("api_error", "The provider did not respond in time. Please retry.", 504);
    }
    return jsonError("api_error", "Could not reach the provider. Please retry.", 502);
  }
}

/** Response headers safe to return after fetch has already decoded the body. */
function passthroughHeaders(res: Response): Headers {
  const h = new Headers(res.headers);
  h.delete("content-encoding");
  h.delete("content-length");
  return h;
}

function forwardHeaders(c: Context, drop: string[] = []): Headers {
  const headers = new Headers();
  const dropSet = new Set([...HOP_HEADERS, "x-api-key", "authorization", "x-goog-api-key", ...drop]);
  for (const [k, v] of Object.entries(c.req.header())) {
    const lower = k.toLowerCase();
    if (!dropSet.has(lower) && !isEdgeHeader(lower)) headers.set(k, v as string);
  }
  return headers;
}

export function buildApp(deps: AppDeps) {
  const { pool, encryptionKey } = deps;
  const anthropicUrl = deps.upstreamUrl;
  const openaiUrl = deps.openaiUpstreamUrl ?? "https://api.openai.com";
  const geminiUrl = deps.geminiUpstreamUrl ?? "https://generativelanguage.googleapis.com";
  const grokUrl = deps.grokUpstreamUrl ?? "https://api.x.ai";
  const doFetch = deps.fetchImpl ?? fetch;
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ ok: true, version: PROXY_VERSION }));
  app.get("/metrics", metricsHandler(pool));
  app.get("/readyz", async (c) => {
    try {
      await pool.query("SELECT 1");
      return c.json({ ok: true, db: true });
    } catch {
      return c.json({ ok: false, db: false }, 503);
    }
  });

  async function resolveKey(c: Context): Promise<{ key: ApiKeyRow } | { err: Response }> {
    const raw = extractCk(c);
    if (!raw) {
      return {
        err: authError(
          "Missing or invalid Caching.ai API key. Pass your ck_... key where you'd normally pass the provider key."
        ),
      };
    }
    let key: ApiKeyRow | null;
    try {
      key = await findApiKey(pool, raw);
    } catch {
      return { err: serviceError() };
    }
    if (!key) return { err: authError("This Caching.ai API key is invalid or has been revoked.") };
    // org workspaces can set hard monthly spend limits (action='block') per
    // org / department / member — enforced here for every provider path
    if (key.org_id != null) {
      const blocked = await orgBudgetBlocked(pool, key);
      if (blocked) {
        const who =
          blocked === "org" ? "your organization" :
          blocked === "department" ? "your department" : "this member account";
        return {
          err: jsonError(
            "rate_limit_error",
            `The monthly spend limit set for ${who} in this workspace has been reached. ` +
              `Ask a workspace admin to raise or remove the limit in the console, or wait for the new month.`,
            429
          ),
        };
      }
    }
    return { key };
  }

  function decryptProviderKey(
    encryptedKey: string | null,
    providerLabel: string
  ): { value: string } | { err: Response } {
    if (!encryptedKey) {
      return {
        err: authError(
          `No ${providerLabel} API key is registered for this Caching.ai key. Add one in your console.`,
          403
        ),
      };
    }
    try {
      return { value: decrypt(encryptedKey, encryptionKey) };
    } catch {
      return { err: serviceError() };
    }
  }

  interface LogParams {
    key: ApiKeyRow;
    provider: "anthropic" | "openai" | "gemini" | "grok";
    model: string;
    status: number;
    started: number;
    isStream: boolean;
    usage: Usage;
    cost: CostBreakdown;
    hashes: BlockHash[] | null;
  }

  // fire-and-forget: never delays the response path
  function logRequest(p: LogParams, after?: () => Promise<void>) {
    void (async () => {
      try {
        let breaker = false;
        if (p.hashes) {
          const prev = await lastPrefixHashes(pool, p.key.id, p.provider, p.model);
          breaker = detectBreaker(prev, p.hashes);
          noteBreakerObservation(
            p.key.id, p.provider, p.model, breaker, p.usage.cache_read_input_tokens > 0
          );
        }
        await insertRequestLog(pool, {
          apiKeyId: p.key.id,
          provider: p.provider,
          model: p.model,
          status: p.status,
          latencyMs: Date.now() - p.started,
          isStream: p.isStream,
          isKeepalive: false,
          usage: p.usage,
          cost: p.cost,
          prefixHashes: p.hashes,
          breakerDetected: breaker,
        });
        if (after) await after();
      } catch (e) {
        console.error("request log failed:", (e as Error).message);
      }
    })();
  }

  // ---------- warm hold: a chat message that is a command to the proxy ----------
  // Applies the hold and returns what the synthetic reply should say. Never
  // touches the upstream — the command itself costs nothing.
  async function applyWarmHold(key: ApiKeyRow, hold: WarmHold): Promise<HoldOutcome> {
    if (!key.keepalive_enabled || key.billing_locked) return "keepalive_off";
    const { rows } = await pool.query(
      "SELECT 1 FROM keepalive_state WHERE api_key_id=$1 AND encrypted_prefix IS NOT NULL LIMIT 1",
      [key.id]
    );
    if (!rows[0]) return "no_prefix";
    await pool.query(
      "UPDATE api_keys SET keepalive_hold_until = now() + make_interval(secs => $2) WHERE id = $1",
      [key.id, hold.ms / 1000]
    );
    return "held";
  }

  // ---------- Anthropic: /v1/messages (full pipeline) ----------
  async function handleAnthropicMessages(c: Context, key: ApiKeyRow): Promise<Response> {
    const cap = tooLarge(c);
    if (cap) return cap;
    let body: any;
    try {
      body = await readJsonCapped(c);
    } catch (e) {
      if (e instanceof BodyTooLargeError) {
        return jsonError("invalid_request_error", "Request body too large.", 413);
      }
      return jsonError("invalid_request_error", "Request body must be valid JSON.", 400);
    }

    const model: string = body?.model ?? "";

    // hold commands are answered by the proxy itself — before the provider-key
    // check, so they work even on a key with no provider key registered yet
    const holdText = lastUserTextAnthropic(body);
    const hold = holdText ? parseWarmHold(holdText) : null;
    if (hold) {
      const outcome = await applyWarmHold(key, hold);
      return anthropicHoldResponse(model, holdReplyText(outcome, hold.ms, hold.lang), body?.stream === true);
    }

    const dk = decryptProviderKey(key.anthropic_key_encrypted, "Anthropic");
    if ("err" in dk) return dk.err;

    // injection auto-pauses while the prefix keeps changing (cache breaker):
    // nobody can cache it, so breakpoints would only buy write premiums
    if (key.auto_cache_control && !key.billing_locked && !injectionPaused(key.id, "anthropic", model)) {
      body = injectCacheControl(body, model, key.anthropic_cache_ttl).body;
    }

    const hashes = prefixBlockHashes(body);
    const isStream = body?.stream === true;
    const started = Date.now();

    const headers = forwardHeaders(c);
    headers.set("x-api-key", dk.value);
    headers.set("content-type", "application/json");

    // keep-alive prefix is extracted up front so the log closure doesn't
    // retain the (possibly huge) request body until the DB write drains
    const kaPrefix = key.keepalive_enabled ? extractKeepalivePrefix(body) : null;
    const kaTokens = kaPrefix ? estimatePrefixTokens(body) : 0;

    const upstreamRes = await upstreamFetch(doFetch, new URL("/v1/messages", anthropicUrl), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }, isStream ? 600_000 : 180_000);

    const finish = (status: number, usage: Usage) =>
      logRequest(
        {
          key, provider: "anthropic", model, status, started, isStream, usage,
          cost: computeCost(model, usage), hashes,
        },
        async () => {
          if (status < 400 && kaPrefix) {
            await saveKeepaliveState(pool, key.id, "anthropic", kaPrefix, kaTokens, encryptionKey);
          }
        }
      );

    if (upstreamRes.status === 401) {
      finish(upstreamRes.status, emptyUsage());
      return humanizeUpstreamAuthError("Anthropic");
    }

    const respHeaders = new Headers(upstreamRes.headers);
    respHeaders.delete("content-length");
    respHeaders.delete("content-encoding");

    if (isStream && (upstreamRes.headers.get("content-type") ?? "").includes("text/event-stream") && upstreamRes.body) {
      const tapped = upstreamRes.body.pipeThrough(tapSseUsage((usage) => finish(upstreamRes.status, usage)));
      return new Response(tapped, { status: upstreamRes.status, headers: respHeaders });
    }

    const text = await upstreamRes.text();
    const usage = emptyUsage();
    try {
      mergeUsage(usage, JSON.parse(text)?.usage);
    } catch { /* non-JSON */ }
    finish(upstreamRes.status, usage);
    return new Response(text, { status: upstreamRes.status, headers: respHeaders });
  }

  // ---------- OpenAI: chat/completions + responses (observation) ----------
  // usage shapes: chat/completions {prompt_tokens, completion_tokens,
  // prompt_tokens_details:{cached_tokens}} · responses {input_tokens,
  // output_tokens, input_tokens_details:{cached_tokens}}. `reasoning` is
  // carried separately because xAI reports reasoning tokens OUTSIDE
  // completion_tokens (OpenAI includes them) — see finish().
  interface OpenAIWireUsage { prompt: number; completion: number; cached: number; written: number; reasoning: number }
  function extractOpenAIUsage(u: any): OpenAIWireUsage | null {
    if (!u || typeof u !== "object") return null;
    if (typeof u.prompt_tokens === "number") {
      return {
        prompt: u.prompt_tokens,
        completion: u.completion_tokens ?? 0,
        cached: u.prompt_tokens_details?.cached_tokens ?? 0,
        written: u.prompt_tokens_details?.cache_write_tokens ?? 0, // 5.6+ era, billed 1.25x
        reasoning: u.completion_tokens_details?.reasoning_tokens ?? 0,
      };
    }
    if (typeof u.input_tokens === "number") {
      return {
        prompt: u.input_tokens,
        completion: u.output_tokens ?? 0,
        cached: u.input_tokens_details?.cached_tokens ?? 0,
        written: u.input_tokens_details?.cache_write_tokens ?? 0,
        reasoning: u.output_tokens_details?.reasoning_tokens ?? 0,
      };
    }
    return null;
  }

  // Grok (xAI) speaks the OpenAI wire format — same handler, routed by the
  // model prefix, using the customer's xAI key and xAI pricing.
  async function handleOpenAI(c: Context, key: ApiKeyRow): Promise<Response> {
    const cap = tooLarge(c);
    if (cap) return cap;
    let body: any;
    try {
      body = await readJsonCapped(c);
    } catch (e) {
      if (e instanceof BodyTooLargeError) {
        return jsonError("invalid_request_error", "Request body too large.", 413);
      }
      return jsonError("invalid_request_error", "Request body must be valid JSON.", 400);
    }

    const model: string = body?.model ?? "";
    const isGrok = model.toLowerCase().startsWith("grok");
    const provider = (isGrok ? "grok" : "openai") as "openai" | "grok";
    const upstream = isGrok ? grokUrl : openaiUrl;
    const isStream = body?.stream === true;

    // hold commands are answered by the proxy itself — before the provider-key
    // check, so they work even on a key with no provider key registered yet
    const isResponsesPath = c.req.path === "/v1/responses";
    if (c.req.path === "/v1/chat/completions" || isResponsesPath) {
      const holdText = isResponsesPath ? lastUserTextResponses(body) : lastUserTextOpenAI(body);
      const hold = holdText ? parseWarmHold(holdText) : null;
      if (hold) {
        const outcome = await applyWarmHold(key, hold);
        const reply = holdReplyText(outcome, hold.ms, hold.lang);
        const created = Math.floor(Date.now() / 1000);
        return isResponsesPath
          ? responsesHoldResponse(model, reply, isStream, created)
          : openaiHoldResponse(model, reply, isStream, created);
      }
    }

    const dk = decryptProviderKey(
      isGrok ? key.grok_key_encrypted : key.openai_key_encrypted,
      isGrok ? "Grok (xAI)" : "OpenAI"
    );
    if ("err" in dk) return dk.err;
    // Without stream_options the final usage chunk never arrives — inject it
    // so streaming requests are metered too (extra terminal chunk with empty
    // choices; standard SDKs handle it).
    if (isStream && body.stream_options === undefined) {
      body = { ...body, stream_options: { include_usage: true } };
    }

    const isChatLike = c.req.path === "/v1/chat/completions" || c.req.path === "/v1/responses";
    const isChat = c.req.path === "/v1/chat/completions";
    const hashes = isChatLike ? prefixBlockHashesOpenAI(body) : null;

    // Pre-GPT-5.6 models get NO injection: bench run-20260718 measured LOWER
    // hit rates with a derived prompt_cache_key than with OpenAI's default
    // routing (S2: gpt-4o 88%→43%, gpt-5.5 80%→47% — our old key hashed the
    // first user message, so it changed every call), and their upstream
    // retention needs no help. GPT-5.6+ is the opposite: breakpoint-scoped
    // caching yields 0% cross-suffix hits for naive traffic, and injecting an
    // explicit breakpoint + STABLE prefix-derived key restores them (verified
    // bench S6, steady traffic: 0 → 97.8% of the prefix). Caller-set params always pass through.
    // same breaker auto-pause as Anthropic: a changing prefix can't be cached,
    // so 5.6 breakpoints would only buy 1.25x write premiums
    if (!isGrok && key.auto_cache_control && !key.billing_locked && !injectionPaused(key.id, provider, model)) {
      if (isChat) body = injectOpenAIBreakpoint(body, model).body;
      else if (isResponsesPath) body = injectOpenAIBreakpointResponses(body, model).body;
    }
    const started = Date.now();

    const headers = forwardHeaders(c);
    headers.set("authorization", `Bearer ${dk.value}`);
    headers.set("content-type", "application/json");
    // xAI routes cache lookups by conversation: a stable x-grok-conv-id pins
    // identical prefixes to the same server, lifting hit rates. Injected only
    // when the caller sends none. https://docs.x.ai/developers/advanced-api-usage/prompt-caching
    if (isGrok && key.auto_cache_control && hashes && hashes.length && !headers.get("x-grok-conv-id")) {
      headers.set("x-grok-conv-id", "cai-" + sha256Hex(JSON.stringify(hashes)).slice(0, 16));
    }

    // No keep-alive prefix is saved for OpenAI/Grok: warming pings are
    // Anthropic-only since bench run-20260718 (see keepalive.ts).
    const upstreamRes = await upstreamFetch(doFetch, new URL(c.req.path, upstream), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }, isStream ? 600_000 : 180_000);

    const finish = (status: number, raw: OpenAIWireUsage | null) => {
      const u = raw ?? { prompt: 0, completion: 0, cached: 0, written: 0, reasoning: 0 };
      // xAI reasoning tokens are billed as output but sit outside
      // completion_tokens; OpenAI's are already included in completion.
      const outTokens = isGrok ? u.completion + u.reasoning : u.completion;
      const usage: Usage = {
        input_tokens: u.prompt - u.cached - u.written,
        output_tokens: outTokens,
        cache_creation_input_tokens: u.written, // GPT-5.6+ writes bill at 1.25x
        cache_read_input_tokens: u.cached,
      };
      logRequest({
        key, provider, model, status, started, isStream, usage,
        cost: isGrok
          ? computeCostGrok(model, {
              prompt_tokens: u.prompt, completion_tokens: u.completion,
              cached_tokens: u.cached, reasoning_tokens: u.reasoning,
            })
          : computeCostOpenAI(model, {
              prompt_tokens: u.prompt, completion_tokens: u.completion,
              cached_tokens: u.cached, cache_write_tokens: u.written,
            }),
        hashes,
      });
    };

    if (upstreamRes.status === 401 || (isGrok && upstreamRes.status === 403)) {
      finish(upstreamRes.status, null);
      return humanizeUpstreamAuthError(isGrok ? "Grok (xAI)" : "OpenAI");
    }

    const respHeaders = new Headers(upstreamRes.headers);
    respHeaders.delete("content-length");
    respHeaders.delete("content-encoding");

    if (isStream && (upstreamRes.headers.get("content-type") ?? "").includes("text/event-stream") && upstreamRes.body) {
      let last: OpenAIWireUsage | null = null;
      const tapped = upstreamRes.body.pipeThrough(
        tapSse(
          (evt) => {
            const u = extractOpenAIUsage(evt.usage) ?? extractOpenAIUsage(evt.response?.usage);
            if (u) last = u;
          },
          () => finish(upstreamRes.status, last)
        )
      );
      return new Response(tapped, { status: upstreamRes.status, headers: respHeaders });
    }

    const text = await upstreamRes.text();
    // xAI reports a bad key as 400 invalid-argument rather than 401
    if (isGrok && upstreamRes.status === 400 && text.includes("Incorrect API key")) {
      finish(upstreamRes.status, null);
      return humanizeUpstreamAuthError("Grok (xAI)");
    }
    let u: OpenAIWireUsage | null = null;
    try {
      u = extractOpenAIUsage(JSON.parse(text)?.usage);
    } catch { /* non-JSON */ }
    finish(upstreamRes.status, u);
    return new Response(text, { status: upstreamRes.status, headers: respHeaders });
  }

  // ---------- Gemini: /v1beta/models/{model}:generateContent (observation) ----------
  function extractGeminiUsage(meta: any): { prompt: number; completion: number; cached: number } | null {
    if (!meta || typeof meta !== "object") return null;
    return {
      prompt: meta.promptTokenCount ?? 0,
      completion: meta.candidatesTokenCount ?? 0,
      cached: meta.cachedContentTokenCount ?? 0,
    };
  }

  async function handleGemini(c: Context, key: ApiKeyRow): Promise<Response> {
    const m = c.req.path.match(/^\/v1beta\/models\/([^:]+):(generateContent|streamGenerateContent)$/);
    const url = new URL(c.req.path, geminiUrl);
    for (const [k, v] of new URL(c.req.url).searchParams) {
      if (k !== "key") url.searchParams.set(k, v);
    }

    // non-generateContent paths: transparent pass-through with key substitution
    if (!m || c.req.method !== "POST") {
      const dk = decryptProviderKey(key.gemini_key_encrypted, "Gemini");
      if ("err" in dk) return dk.err;
      const headers = forwardHeaders(c);
      headers.set("x-goog-api-key", dk.value);
      const init: RequestInit = { method: c.req.method, headers };
      if (!["GET", "HEAD"].includes(c.req.method)) {
        (init as any).body = c.req.raw.body;
        (init as any).duplex = "half";
      }
      const res = await upstreamFetch(doFetch, url, init, 180_000);
      if (res.status === 401 || res.status === 403) return humanizeUpstreamAuthError("Gemini");
      return new Response(res.body, { status: res.status, headers: passthroughHeaders(res) });
    }

    const model = m[1];
    const isStream = m[2] === "streamGenerateContent";

    let body: any;
    try {
      body = await readJsonCapped(c);
    } catch (e) {
      if (e instanceof BodyTooLargeError) {
        return jsonError("invalid_request_error", "Request body too large.", 413);
      }
      return jsonError("invalid_request_error", "Request body must be valid JSON.", 400);
    }

    // hold commands are answered by the proxy itself — before the provider-key
    // check, so they work even on a key with no provider key registered yet
    {
      const holdText = lastUserTextGemini(body);
      const hold = holdText ? parseWarmHold(holdText) : null;
      if (hold) {
        const outcome = await applyWarmHold(key, hold);
        const mode = !isStream
          ? "json"
          : new URL(c.req.url).searchParams.get("alt") === "sse"
            ? "sse"
            : "array";
        return geminiHoldResponse(model, holdReplyText(outcome, hold.ms, hold.lang), mode);
      }
    }

    const dk = decryptProviderKey(key.gemini_key_encrypted, "Gemini");
    if ("err" in dk) return dk.err;
    const headers = forwardHeaders(c);
    headers.set("x-goog-api-key", dk.value);

    const hashes = prefixBlockHashesGemini(body);
    const started = Date.now();
    headers.set("content-type", "application/json");

    // No keep-alive prefix is saved for Gemini: bench run-20260718 measured 0
    // implicit-cache hits from warming pings — warming is Anthropic-only now.
    const upstreamRes = await upstreamFetch(doFetch, url,
      { method: "POST", headers, body: JSON.stringify(body) },
      isStream ? 600_000 : 180_000);

    const finish = (status: number, raw: { prompt: number; completion: number; cached: number } | null) => {
      const u = raw ?? { prompt: 0, completion: 0, cached: 0 };
      const usage: Usage = {
        input_tokens: u.prompt - u.cached,
        output_tokens: u.completion,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: u.cached,
      };
      logRequest({
        key, provider: "gemini", model, status, started, isStream, usage,
        cost: computeCostGemini(model, {
          promptTokenCount: u.prompt,
          candidatesTokenCount: u.completion,
          cachedContentTokenCount: u.cached,
        }),
        hashes,
      });
    };

    if (upstreamRes.status === 401 || upstreamRes.status === 403) {
      finish(upstreamRes.status, null);
      return humanizeUpstreamAuthError("Gemini");
    }

    const respHeaders = new Headers(upstreamRes.headers);
    respHeaders.delete("content-length");
    respHeaders.delete("content-encoding");

    if (isStream && (upstreamRes.headers.get("content-type") ?? "").includes("text/event-stream") && upstreamRes.body) {
      let last: { prompt: number; completion: number; cached: number } | null = null;
      const tapped = upstreamRes.body.pipeThrough(
        tapSse(
          (evt) => {
            const u = extractGeminiUsage(evt.usageMetadata);
            if (u) last = u;
          },
          () => finish(upstreamRes.status, last)
        )
      );
      return new Response(tapped, { status: upstreamRes.status, headers: respHeaders });
    }

    const text = await upstreamRes.text();
    // Google reports a bad key as 400 API_KEY_INVALID rather than 401
    if (upstreamRes.status === 400 && text.includes("API_KEY_INVALID")) {
      finish(upstreamRes.status, null);
      return humanizeUpstreamAuthError("Gemini");
    }
    let u: { prompt: number; completion: number; cached: number } | null = null;
    try {
      const parsed = JSON.parse(text);
      // non-SSE streamGenerateContent returns a JSON array of chunks
      const meta = Array.isArray(parsed)
        ? [...parsed].reverse().find((p) => p?.usageMetadata)?.usageMetadata
        : parsed?.usageMetadata;
      u = extractGeminiUsage(meta);
    } catch { /* non-JSON */ }
    finish(upstreamRes.status, u);
    return new Response(text, { status: upstreamRes.status, headers: respHeaders });
  }

  // ---------- Anthropic misc /v1/* pass-through ----------
  async function handleAnthropicPassthrough(c: Context, key: ApiKeyRow): Promise<Response> {
    const dk = decryptProviderKey(key.anthropic_key_encrypted, "Anthropic");
    if ("err" in dk) return dk.err;
    const headers = forwardHeaders(c);
    headers.set("x-api-key", dk.value);
    const url = new URL(c.req.path + (new URL(c.req.url).search || ""), anthropicUrl);
    const init: RequestInit = { method: c.req.method, headers };
    if (!["GET", "HEAD"].includes(c.req.method)) {
      (init as any).body = c.req.raw.body;
      (init as any).duplex = "half";
    }
    const res = await upstreamFetch(doFetch, url, init, 180_000);
    if (res.status === 401) return humanizeUpstreamAuthError("Anthropic");
    return new Response(res.body, { status: res.status, headers: passthroughHeaders(res) });
  }

  app.all("/v1beta/*", async (c) => {
    const r = await resolveKey(c);
    if ("err" in r) return r.err;
    return handleGemini(c, r.key);
  });

  app.all("/v1/*", async (c) => {
    const r = await resolveKey(c);
    if ("err" in r) return r.err;

    if (c.req.path === "/v1/messages" && c.req.method === "POST") {
      return handleAnthropicMessages(c, r.key);
    }
    if (OPENAI_PATHS.has(c.req.path) && c.req.method === "POST") {
      return handleOpenAI(c, r.key);
    }
    // ambiguous paths (e.g. /v1/models): route by auth style —
    // Anthropic SDKs send x-api-key, OpenAI SDKs send Authorization: Bearer
    if (!c.req.header("x-api-key") && c.req.header("authorization")) {
      const dk = decryptProviderKey(r.key.openai_key_encrypted, "OpenAI");
      if ("err" in dk) return dk.err;
      const headers = forwardHeaders(c);
      headers.set("authorization", `Bearer ${dk.value}`);
      const url = new URL(c.req.path + (new URL(c.req.url).search || ""), openaiUrl);
      const init: RequestInit = { method: c.req.method, headers };
      if (!["GET", "HEAD"].includes(c.req.method)) {
        (init as any).body = c.req.raw.body;
        (init as any).duplex = "half";
      }
      const res = await upstreamFetch(doFetch, url, init, 180_000);
      if (res.status === 401) return humanizeUpstreamAuthError("OpenAI");
      return new Response(res.body, { status: res.status, headers: passthroughHeaders(res) });
    }
    return handleAnthropicPassthrough(c, r.key);
  });

  app.notFound((c) =>
    c.json({ type: "error", error: { type: "not_found_error", message: "Unknown endpoint." } }, 404)
  );

  return app;
}
