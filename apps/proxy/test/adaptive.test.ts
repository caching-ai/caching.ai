import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateAnthropicTtl, adaptiveSweep } from "@caching/ee-adaptive";

const MIN = 60_000;

test("tight traffic (1-minute gaps) stays on the 5m cache", () => {
  const gaps = Array(50).fill(1 * MIN);
  const r = simulateAnthropicTtl(gaps, false);
  assert.equal(r.recommended, "5m");
  assert.equal(r.confident, true);
  assert.equal(r.medianGapMin, 1);
});

test("sparse traffic (20-minute gaps, no warming) prefers the 1h cache", () => {
  const gaps = Array(50).fill(20 * MIN);
  const r = simulateAnthropicTtl(gaps, false);
  // 5m: every gap is a 1.25x rewrite; 1h: every gap is a 0.1x read
  assert.equal(r.recommended, "1h");
  assert.equal(r.confident, true);
  assert.ok(r.cost1h < r.cost5m);
});

test("sparse traffic with warming still prefers 1h (pings beat rewrites, one ping beats five)", () => {
  const gaps = Array(50).fill(30 * MIN);
  const r = simulateAnthropicTtl(gaps, true);
  assert.equal(r.recommended, "1h");
  assert.equal(r.confident, true);
});

test("dead traffic (25-hour gaps) stays on 5m — both regimes always rewrite, 5m writes are cheaper", () => {
  const gaps = Array(30).fill(25 * 60 * MIN);
  const r = simulateAnthropicTtl(gaps, false);
  assert.equal(r.recommended, "5m");
});

test("too few samples is never confident", () => {
  const r = simulateAnthropicTtl(Array(5).fill(20 * MIN), false);
  assert.equal(r.recommended, "1h");
  assert.equal(r.confident, false);
});

test("near-tie is not confident", () => {
  // alternating 4min (5m-friendly) and 8min gaps lands close to break-even
  const gaps = Array.from({ length: 40 }, (_, i) => (i % 2 ? 4 : 8) * MIN);
  const r = simulateAnthropicTtl(gaps, false);
  if (r.savingsPct < 0.1) assert.equal(r.confident, false);
});

test("adaptiveSweep applies confident TTL change and records the decision", async () => {
  const now = Date.now();
  // 30 anthropic requests, 20 minutes apart → confident 1h recommendation
  const logRows = Array.from({ length: 30 }, (_, i) => ({
    provider: "anthropic",
    ts: new Date(now - (30 - i) * 20 * MIN),
  }));
  const updates: any[] = [];
  const decisions: any[] = [];
  const fakePool = {
    query: async (sql: string, params?: any[]) => {
      if (sql.includes("FROM api_keys")) {
        return { rows: [{ id: 7, anthropic_cache_ttl: "5m", openai_cache_retention: "24h", keepalive_enabled: false }] };
      }
      if (sql.includes("FROM request_logs")) return { rows: logRows };
      if (sql.startsWith("UPDATE api_keys")) { updates.push(params); return { rows: [] }; }
      if (sql.includes("INSERT INTO tuning_decisions")) { decisions.push(params); return { rows: [] }; }
      throw new Error("unexpected query: " + sql);
    },
  };
  const changed = await adaptiveSweep(fakePool as any);
  assert.equal(changed, 1);
  assert.deepEqual(updates[0], [7, "1h"]);
  assert.equal(decisions[0][1], "anthropic_cache_ttl");
  assert.equal(decisions[0][2], "5m");
  assert.equal(decisions[0][3], "1h");
  const reason = JSON.parse(decisions[0][4]);
  assert.equal(reason.recommended, "1h");
  assert.ok(reason.samples >= 20);
});

test("adaptiveSweep leaves OpenAI alone — retention is model-automatic now", async () => {
  const now = Date.now();
  const logRows = Array.from({ length: 10 }, (_, i) => ({
    provider: "openai", model: "gpt-5.5", ts: new Date(now - i * 10 * MIN),
  }));
  const updates: string[] = [];
  const fakePool = {
    query: async (sql: string, params?: any[]) => {
      if (sql.includes("FROM api_keys")) {
        return { rows: [{ id: 3, anthropic_cache_ttl: "5m", openai_cache_retention: "default", keepalive_enabled: true }] };
      }
      if (sql.includes("FROM request_logs")) return { rows: logRows };
      if (sql.startsWith("UPDATE api_keys")) { updates.push(sql); return { rows: [] }; }
      if (sql.includes("INSERT INTO tuning_decisions")) return { rows: [] };
      throw new Error("unexpected query: " + sql);
    },
  };
  assert.equal(await adaptiveSweep(fakePool as any), 0);
  assert.equal(updates.length, 0, "OpenAI needs no setting changes — the sweep adapts per model");
});
