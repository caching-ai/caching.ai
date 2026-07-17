import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { recordRequestMetric, renderMetrics, resetMetrics, metricsHandler } from "../src/metrics.js";
import { PROXY_VERSION } from "../src/config.js";

// No DB needed: the exporter reads in-process counters plus pg.Pool gauges,
// which are plain properties.
const fakePool = { totalCount: 3, idleCount: 2, waitingCount: 0 } as any;

const sample = (over: Partial<Parameters<typeof recordRequestMetric>[0]> = {}) => ({
  provider: "anthropic",
  status: 200,
  latencyMs: 120,
  isKeepalive: false,
  usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 100 },
  cost: { actualUsd: 0.01, noCacheUsd: 0.05, savedUsd: 0.04 },
  ...over,
});

beforeEach(() => resetMetrics());

test("metrics: counters, histogram and gauges render in Prometheus text format", () => {
  recordRequestMetric(sample());
  recordRequestMetric(sample({ status: 429, latencyMs: 30 }));
  recordRequestMetric(sample({ isKeepalive: true }));
  recordRequestMetric(sample({ provider: "openai", latencyMs: 99999 }));

  const out = renderMetrics(fakePool);
  assert.match(out, new RegExp(`caching_build_info\\{version="${PROXY_VERSION}"\\} 1`));
  assert.match(out, /caching_requests_total\{provider="anthropic",class="2xx"\} 1/);
  assert.match(out, /caching_requests_total\{provider="anthropic",class="4xx"\} 1/);
  assert.match(out, /caching_keepalive_pings_total\{provider="anthropic"\} 1/);
  assert.match(out, /caching_keepalive_cost_usd_total\{provider="anthropic"\} 0.01/);
  // keepalive pings are excluded from token/cost/saved counters (2 samples × 100)
  assert.match(out, /caching_tokens_total\{provider="anthropic",kind="cache_read"\} 200/);
  assert.match(out, /caching_saved_usd_total\{provider="openai"\} 0.04/);
  // keepalive pings never enter the latency histogram
  assert.match(out, /caching_request_latency_ms_count\{provider="anthropic"\} 2/);
  // 30ms lands in the le=50 bucket, 120ms only from le=250 up
  assert.match(out, /caching_request_latency_ms_bucket\{provider="anthropic",le="50"\} 1/);
  assert.match(out, /caching_request_latency_ms_bucket\{provider="anthropic",le="250"\} 2/);
  // 99999ms overflows every finite bucket
  assert.match(out, /caching_request_latency_ms_bucket\{provider="openai",le="60000"\} 0/);
  assert.match(out, /caching_request_latency_ms_bucket\{provider="openai",le="\+Inf"\} 1/);
  assert.match(out, /caching_db_pool_connections\{state="idle"\} 2/);

  // counters stay monotonic: negative savings (cache-write premium) and
  // negative token anomalies are clamped, never decrement
  recordRequestMetric(sample({
    provider: "openai",
    usage: { input_tokens: -50, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 10 },
    cost: { actualUsd: 0.01, noCacheUsd: 0.005, savedUsd: -0.005 },
  }));
  const out2 = renderMetrics(fakePool);
  assert.match(out2, /caching_saved_usd_total\{provider="openai"\} 0.04/);
  assert.match(out2, /caching_tokens_total\{provider="openai",kind="input"\} 10/, "negative input clamped, first sample's 10 remains");

  // exposition format: every metric family's samples must be contiguous
  // (strict parsers like promtool reject interleaving across providers)
  const sequence = out2
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(/[{ ]/)[0].replace(/_(bucket|sum|count)$/, ""));
  const finished = new Set<string>();
  let current = "";
  for (const name of sequence) {
    if (name !== current) {
      assert.ok(!finished.has(name), `metric family ${name} interleaved`);
      if (current) finished.add(current);
      current = name;
    }
  }
});

test("GET /metrics: off without METRICS_TOKEN, 403 on bad token, 200 with bearer", async () => {
  const app = new Hono();
  app.get("/metrics", metricsHandler(fakePool));
  recordRequestMetric(sample());

  delete process.env.METRICS_TOKEN;
  assert.equal((await app.request("/metrics")).status, 404);

  process.env.METRICS_TOKEN = "s3cret";
  try {
    assert.equal((await app.request("/metrics")).status, 403);
    assert.equal(
      (await app.request("/metrics", { headers: { authorization: "Bearer wrong!" } })).status,
      403
    );
    const ok = await app.request("/metrics", { headers: { authorization: "Bearer s3cret" } });
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("content-type") ?? "", /text\/plain/);
    assert.match(await ok.text(), /caching_requests_total\{provider="anthropic",class="2xx"\} 1/);
  } finally {
    delete process.env.METRICS_TOKEN;
  }
});
