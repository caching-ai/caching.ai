// Streaming callers for Anthropic / OpenAI-compatible / Gemini endpoints.
// Every call streams (stream=true) so TTFT is measured the same way in all
// arms: time from request start to the first response body chunk.
// Usage comes from the provider's own stream events — never estimated.

import { sleep } from "./util.mjs";

export const PROXY_URL = process.env.BENCH_PROXY_URL ?? "https://proxy.caching.ai";
const DIRECT = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com",
  gemini: "https://generativelanguage.googleapis.com",
  grok: "https://api.x.ai",
};

export function baseUrlFor(provider, arm) {
  return arm === "C" ? PROXY_URL : DIRECT[provider];
}

const MAX_RETRIES = 5;

/** SSE reader: yields parsed `data:` JSON payloads, records first-chunk time. */
async function readSse(res, onFirstChunk) {
  const events = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let first = true;
  for (;;) {
    const { done, value } = await reader.read();
    if (first && value) { onFirstChunk(); first = false; }
    if (done) break;
    // Gemini frames SSE with \r\n — normalize so event splitting works
    buf = (buf + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try { events.push(JSON.parse(data)); } catch { /* partial/non-JSON */ }
      }
    }
  }
  return events;
}

/**
 * One streamed call with retry on 429/5xx/network errors.
 * Returns { status, ttftMs, totalMs, usage:{input,cacheWrite,cacheRead,output},
 *           retries, error? } — usage fields are the provider's own numbers.
 */
async function callSse({ url, headers, body, parseUsage, timeoutMs = 180_000 }) {
  let retries = 0;
  for (;;) {
    const started = Date.now();
    let ttftMs = null;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) {
        await res.text().catch(() => {});
        if (retries < MAX_RETRIES) {
          retries++;
          await sleep(Math.min(30_000, 1000 * 2 ** retries) + Math.random() * 500);
          continue;
        }
        return { status: res.status, ttftMs: null, totalMs: Date.now() - started, usage: null, retries, error: `HTTP ${res.status} after ${retries} retries` };
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { status: res.status, ttftMs: null, totalMs: Date.now() - started, usage: null, retries, error: `HTTP ${res.status}: ${text.slice(0, 300)}` };
      }
      const events = await readSse(res, () => { ttftMs = Date.now() - started; });
      const usage = parseUsage(events);
      return { status: res.status, ttftMs, totalMs: Date.now() - started, usage, retries };
    } catch (e) {
      if (retries < MAX_RETRIES) {
        retries++;
        await sleep(Math.min(30_000, 1000 * 2 ** retries) + Math.random() * 500);
        continue;
      }
      return { status: 0, ttftMs: null, totalMs: Date.now() - started, usage: null, retries, error: String(e?.message ?? e) };
    }
  }
}

// ---------- Anthropic /v1/messages ----------
export function callAnthropic({ baseUrl, apiKey, model, system, messages, tools, maxTokens }) {
  const body = { model, max_tokens: maxTokens, stream: true, system, messages };
  // Claude 5-generation models reject `temperature` (deprecated); older
  // models still accept it. Responses never feed later turns either way.
  if (!/^claude-(sonnet|opus|fable|mythos)-5/.test(model)) body.temperature = 0;
  if (tools) body.tools = tools;
  return callSse({
    url: `${baseUrl}/v1/messages`,
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body,
    parseUsage(events) {
      const u = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
      for (const e of events) {
        if (e.type === "message_start" && e.message?.usage) {
          const mu = e.message.usage;
          u.input = mu.input_tokens ?? 0;
          u.cacheWrite = mu.cache_creation_input_tokens ?? 0;
          u.cacheRead = mu.cache_read_input_tokens ?? 0;
        }
        if (e.type === "message_delta" && e.usage?.output_tokens != null) u.output = e.usage.output_tokens;
      }
      return u;
    },
  });
}

// ---------- OpenAI-compatible /v1/chat/completions (OpenAI + Grok) ----------
export function callOpenAI({ baseUrl, apiKey, model, system, messages, maxTokens, reasoningSeparate = false }) {
  const body = {
    model,
    stream: true,
    stream_options: { include_usage: true },
    max_completion_tokens: maxTokens,
    messages: [{ role: "system", content: system }, ...messages],
  };
  // GPT-5.x rejects custom temperature on chat/completions — only send it to
  // models that accept it. Determinism note: responses never feed back into
  // later turns (fixed conversation scripts), so sampling drift cannot
  // contaminate input-side costs.
  if (!/^gpt-5\./.test(model)) body.temperature = 0;
  // keep adaptive-reasoning models from burning reasoning tokens: this bench
  // measures input-side cost, not answer quality (sent identically in every arm)
  if (/^gpt-5\.6/.test(model)) body.reasoning_effort = "none";
  if (reasoningSeparate) body.reasoning_effort = "low"; // grok-4.5: lowest supported

  return callSse({
    url: `${baseUrl}/v1/chat/completions`,
    headers: { authorization: `Bearer ${apiKey}` },
    body,
    parseUsage(events) {
      let u = null;
      for (const e of events) {
        const raw = e.usage ?? e.response?.usage;
        if (raw?.prompt_tokens != null) {
          // GPT-5.6-era usage reports cache writes (billed at plain input
          // price — no premium); classic models only report cached_tokens
          const cached = raw.prompt_tokens_details?.cached_tokens ?? 0;
          const written = raw.prompt_tokens_details?.cache_write_tokens ?? 0;
          // xAI bills reasoning tokens as output but reports them OUTSIDE
          // completion_tokens; OpenAI includes them. Add them only for xAI.
          const reasoning = reasoningSeparate ? (raw.completion_tokens_details?.reasoning_tokens ?? 0) : 0;
          u = { input: raw.prompt_tokens - cached - written, cacheWrite: written, cacheRead: cached, output: (raw.completion_tokens ?? 0) + reasoning };
        }
      }
      return u ?? { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
    },
  });
}

// ---------- Gemini streamGenerateContent ----------
export function callGemini({ baseUrl, apiKey, model, system, messages, maxTokens }) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    // thinking off: 2.5-flash otherwise spends the whole output budget on
    // thought tokens; this bench measures input-side cost, not answer quality
    generationConfig: { temperature: 0, maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } },
  };
  return callSse({
    url: `${baseUrl}/v1beta/models/${model}:streamGenerateContent?alt=sse`,
    headers: { "x-goog-api-key": apiKey },
    body,
    parseUsage(events) {
      let u = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
      for (const e of events) {
        const m = e.usageMetadata;
        if (m?.promptTokenCount != null) {
          const cached = m.cachedContentTokenCount ?? 0;
          u = { input: m.promptTokenCount - cached, cacheWrite: 0, cacheRead: cached, output: (m.candidatesTokenCount ?? 0) + (m.thoughtsTokenCount ?? 0) };
        }
      }
      return u;
    },
  });
}

/** Non-stream helper for proxy hold commands (S5): the proxy answers these itself. */
export async function sendHoldCommand({ apiKey, model, holdText }) {
  const res = await fetch(`${PROXY_URL}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 64, messages: [{ role: "user", content: holdText }] }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, reply: json?.content?.[0]?.text ?? null };
}
