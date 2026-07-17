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
