import { test } from "node:test";
import assert from "node:assert/strict";
import { injectCacheControl, hasCacheControl } from "../src/logic/cacheControl.js";
import { prefixBlockHashes, detectBreaker, extractKeepalivePrefix } from "../src/logic/prefixHash.js";
import { computeCost } from "@caching/shared";

const BIG = "x".repeat(20_000); // ~5.7k estimated tokens, above every model minimum

test("injects cache_control on system + tools when absent", () => {
  const body = {
    model: "claude-sonnet-4-5",
    system: BIG,
    tools: [{ name: "a", input_schema: {} }, { name: "b", input_schema: {} }],
    messages: [{ role: "user", content: "hi" }],
  };
  const r = injectCacheControl(body, body.model);
  assert.equal(r.injected, true);
  assert.deepEqual(r.body.tools[1].cache_control, { type: "ephemeral" });
  assert.equal(r.body.tools[0].cache_control, undefined);
  assert.deepEqual(r.body.system[0].cache_control, { type: "ephemeral" });
  assert.equal(r.body.system[0].text, BIG);
  // original body untouched
  assert.equal(typeof body.system, "string");
});

test("injects 1h ttl markers when the key selects the extended cache", () => {
  const body = {
    model: "claude-sonnet-4-5",
    system: BIG,
    tools: [{ name: "a", input_schema: {} }],
    messages: [{ role: "user", content: "hi" }],
  };
  const r = injectCacheControl(body, body.model, "1h");
  assert.equal(r.injected, true);
  assert.deepEqual(r.body.system[0].cache_control, { type: "ephemeral", ttl: "1h" });
  assert.deepEqual(r.body.tools[0].cache_control, { type: "ephemeral", ttl: "1h" });
  // default stays the bare 5m marker
  const r5 = injectCacheControl(structuredClone(body), body.model);
  assert.deepEqual(r5.body.system[0].cache_control, { type: "ephemeral" });
});

test("never touches a request that already has cache_control", () => {
  const body = {
    model: "claude-sonnet-4-5",
    system: [{ type: "text", text: BIG, cache_control: { type: "ephemeral", ttl: "1h" } }],
    messages: [{ role: "user", content: "hi" }],
  };
  const r = injectCacheControl(body, body.model);
  assert.equal(r.injected, false);
  assert.equal(r.reason, "already-present");
});

test("skips injection below the model's minimum cacheable prefix", () => {
  const body = { model: "claude-opus-4-8", system: "short prompt", messages: [] };
  const r = injectCacheControl(body, body.model);
  assert.equal(r.injected, false);
  assert.equal(r.reason, "below-minimum");
});

test("detects cache_control nested in message content", () => {
  const body = {
    messages: [{ role: "user", content: [{ type: "text", text: "x", cache_control: { type: "ephemeral" } }] }],
  };
  assert.equal(hasCacheControl(body), true);
});

test("prefix hashes stable + breaker detection on system change", () => {
  const a = prefixBlockHashes({ system: "same", tools: [{ name: "t" }], messages: [{ role: "user", content: "q1" }] });
  const b = prefixBlockHashes({ system: "same", tools: [{ name: "t" }], messages: [{ role: "user", content: "q2" }] });
  assert.equal(detectBreaker(a, b), false, "msg0 change alone is not a breaker");

  const c = prefixBlockHashes({ system: "now: 12:01", tools: [{ name: "t" }], messages: [] });
  const d = prefixBlockHashes({ system: "now: 12:02", tools: [{ name: "t" }], messages: [] });
  assert.equal(detectBreaker(c, d), true, "system changing per request is a breaker");
});

test("keepalive prefix includes messages up to last breakpoint", () => {
  const body = {
    model: "m",
    system: "s",
    messages: [
      { role: "user", content: [{ type: "text", text: "ctx", cache_control: { type: "ephemeral" } }] },
      { role: "assistant", content: "ok" },
      { role: "user", content: "volatile question" },
    ],
  };
  const p = extractKeepalivePrefix(body)!;
  assert.equal(p.messages.length, 1);

  const noBp = extractKeepalivePrefix({ model: "m", system: "s", messages: [{ role: "user", content: "q" }] })!;
  assert.equal(noBp.messages.length, 0, "without message breakpoints only system/tools are kept");
});

test("cost math: savings and waste follow the pricing sheet", () => {
  // sonnet: $3/MTok input. 1M cache-read tokens should cost $0.30 vs $3 uncached.
  const c = computeCost("claude-sonnet-4-5", {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 1_000_000,
  });
  assert.ok(Math.abs(c.actualUsd - 0.3) < 1e-9);
  assert.ok(Math.abs(c.noCacheUsd - 3) < 1e-9);
  assert.ok(Math.abs(c.savedUsd - 2.7) < 1e-9);

  // cache write premium: 1M write tokens cost 1.25x
  const w = computeCost("claude-sonnet-4-5", {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 1_000_000,
    cache_read_input_tokens: 0,
  });
  assert.ok(Math.abs(w.actualUsd - 3.75) < 1e-9);
  assert.ok(w.savedUsd < 0, "pure writes are a premium, not a saving");
});

// ---------- run-20260718 benchmark-driven fixes ----------
import {
  upgradeCacheControlTo1h,
  injectOpenAIBreakpoint,
  injectOpenAIBreakpointResponses,
  isGpt56Plus,
} from "../src/logic/cacheControl.js";
import { computeCostGrok } from "@caching/shared";

test("computeCost bills 1h cache writes at 2x when the usage breakdown says so", () => {
  const c = computeCost("claude-sonnet-4-5", {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 1_000_000,
    cache_read_input_tokens: 0,
    cache_creation_5m_input_tokens: 0,
    cache_creation_1h_input_tokens: 1_000_000,
  });
  assert.ok(Math.abs(c.actualUsd - 6) < 1e-9, "1h write = 2x of $3/MTok");
  // mixed breakdown: half 5m, half 1h
  const m = computeCost("claude-sonnet-4-5", {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 1_000_000,
    cache_read_input_tokens: 0,
    cache_creation_5m_input_tokens: 500_000,
    cache_creation_1h_input_tokens: 500_000,
  });
  assert.ok(Math.abs(m.actualUsd - (0.5 * 3.75 + 0.5 * 6)) < 1e-9);
});

test("computeCostGrok bills separately-reported reasoning tokens as output", () => {
  const c = computeCostGrok("grok-4", {
    prompt_tokens: 1000, completion_tokens: 100, cached_tokens: 0, reasoning_tokens: 1400,
  });
  const expected = 1000 * 3e-6 + (100 + 1400) * 15e-6;
  assert.ok(Math.abs(c.actualUsd - expected) < 1e-12);
  // savings math unaffected: reasoning inflates both sides equally
  assert.ok(Math.abs(c.savedUsd) < 1e-12);
});

test("upgradeCacheControlTo1h rewrites every marker, leaves the original untouched", () => {
  const prefix = {
    model: "claude-sonnet-4-5",
    system: [{ type: "text", text: "s", cache_control: { type: "ephemeral" } }],
    tools: [{ name: "t", input_schema: {}, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: [{ type: "text", text: "m", cache_control: { type: "ephemeral" } }] }],
  };
  const up = upgradeCacheControlTo1h(prefix);
  assert.deepEqual(up.system[0].cache_control, { type: "ephemeral", ttl: "1h" });
  assert.deepEqual(up.tools[0].cache_control, { type: "ephemeral", ttl: "1h" });
  assert.deepEqual(up.messages[0].content[0].cache_control, { type: "ephemeral", ttl: "1h" });
  assert.deepEqual(prefix.system[0].cache_control, { type: "ephemeral" }, "original untouched");
});

test("gpt-5.6+ detection and breakpoint injection edges", () => {
  assert.equal(isGpt56Plus("gpt-5.6-sol"), true);
  assert.equal(isGpt56Plus("gpt-6"), true);
  assert.equal(isGpt56Plus("gpt-5.5"), false);
  assert.equal(isGpt56Plus("gpt-4o"), false);

  // developer-role prefix in array form: breakpoint lands on the LAST part of
  // the LAST leading message; stable key present
  const body = {
    model: "gpt-5.6-sol",
    messages: [
      { role: "system", content: BIG },
      { role: "developer", content: [{ type: "text", text: BIG }] },
      { role: "user", content: "q" },
    ],
  };
  const r = injectOpenAIBreakpoint(body, body.model);
  assert.equal(r.injected, true);
  assert.deepEqual(r.body.messages[1].content[0].prompt_cache_breakpoint, { mode: "explicit" });
  assert.equal(r.body.messages[0].content[0]?.prompt_cache_breakpoint, undefined, "only the prefix end gets the breakpoint");
  assert.match(r.body.prompt_cache_key, /^cai-[0-9a-f]{16}$/);
  assert.equal((body as any).prompt_cache_key, undefined, "original untouched");

  // caller opted in already → untouched
  const own = injectOpenAIBreakpoint({ model: "gpt-5.6", prompt_cache_options: { mode: "explicit" }, messages: [{ role: "system", content: BIG }] }, "gpt-5.6");
  assert.equal(own.injected, false);
  assert.equal(own.reason, "already-present");

  // no leading system/developer run → nothing to cache
  const none = injectOpenAIBreakpoint({ model: "gpt-5.6", messages: [{ role: "user", content: BIG }] }, "gpt-5.6");
  assert.equal(none.injected, false);
});

test("responses API breakpoint injection: leading system item, instructions-only skipped", () => {
  const body = {
    model: "gpt-5.6-sol",
    instructions: "short",
    input: [
      { role: "system", content: [{ type: "input_text", text: BIG }] },
      { role: "user", content: "q" },
    ],
  };
  const r = injectOpenAIBreakpointResponses(body, body.model);
  assert.equal(r.injected, true);
  assert.deepEqual(r.body.input[0].content[0].prompt_cache_breakpoint, { mode: "explicit" });
  assert.match(r.body.prompt_cache_key, /^cai-[0-9a-f]{16}$/);
  assert.equal((body as any).prompt_cache_key, undefined, "original untouched");

  // string content converts to an input_text part
  const s = injectOpenAIBreakpointResponses(
    { model: "gpt-5.6", input: [{ role: "developer", content: BIG }, { role: "user", content: "q" }] },
    "gpt-5.6"
  );
  assert.equal(s.injected, true);
  assert.equal(s.body.input[0].content[0].type, "input_text");
  assert.equal(s.body.input[0].content[0].text, BIG);

  // instructions-only (string input): nothing to attach a breakpoint to
  const io = injectOpenAIBreakpointResponses({ model: "gpt-5.6", instructions: BIG, input: "hello" }, "gpt-5.6");
  assert.equal(io.injected, false);

  // caller opted in → untouched
  const own = injectOpenAIBreakpointResponses(
    { model: "gpt-5.6", prompt_cache_key: "mine", input: [{ role: "system", content: BIG }] },
    "gpt-5.6"
  );
  assert.equal(own.injected, false);
  assert.equal(own.reason, "already-present");
});
