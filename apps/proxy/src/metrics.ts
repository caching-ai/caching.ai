import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import type pg from "pg";
import type { Usage } from "@caching/shared";
import { PROXY_VERSION } from "./config.js";
import type { CostBreakdown } from "./store.js";

// Prometheus exposition for self-hosters (and our own ops), dependency-free.
// Counters live in process memory — they reset on restart, which Prometheus
// handles natively (rate()/increase() are reset-aware). Labels are limited to
// closed sets (provider, status class, token kind); user-controlled strings
// like model names never become label values, so cardinality stays bounded.
//
// Keep-alive pings are metered separately (ping count + ping cost) and are
// excluded from the request/token/cost/saved counters — matching every other
// surface (console, weekly report), which filters WHERE NOT is_keepalive.
// Counter increments are clamped to >= 0 to preserve monotonicity: savedUsd
// is legitimately negative on cache-write requests (write premium), and a
// misbehaving upstream could report cached > prompt tokens; the netted truth
// lives in the database, these counters are operational signals.
//
// The endpoint is off unless METRICS_TOKEN is set; scrape with
//   authorization: Bearer <METRICS_TOKEN>

const LATENCY_BUCKETS_MS = [25, 50, 100, 250, 500, 1000, 2500, 5000, 15000, 60000];

interface ProviderStats {
  requestsByClass: Map<string, number>; // "2xx" | "4xx" | ...
  keepalivePings: number;
  keepaliveCostUsd: number;
  tokens: { input: number; output: number; cache_read: number; cache_creation: number };
  costUsd: number;
  savedUsd: number;
  latencyBuckets: number[]; // cumulative counts per LATENCY_BUCKETS_MS + +Inf
  latencySumMs: number;
  latencyCount: number;
}

const providers = new Map<string, ProviderStats>();
const startTimeSeconds = Math.floor(Date.now() / 1000 - process.uptime());

function statsFor(provider: string): ProviderStats {
  let s = providers.get(provider);
  if (!s) {
    s = {
      requestsByClass: new Map(),
      keepalivePings: 0,
      keepaliveCostUsd: 0,
      tokens: { input: 0, output: 0, cache_read: 0, cache_creation: 0 },
      costUsd: 0,
      savedUsd: 0,
      latencyBuckets: new Array(LATENCY_BUCKETS_MS.length + 1).fill(0),
      latencySumMs: 0,
      latencyCount: 0,
    };
    providers.set(provider, s);
  }
  return s;
}

export interface MetricSample {
  provider: string;
  status: number;
  latencyMs: number;
  isKeepalive: boolean;
  usage: Usage;
  cost: CostBreakdown;
}

const pos = (v: number) => (v > 0 ? v : 0);

export function recordRequestMetric(e: MetricSample): void {
  const s = statsFor(e.provider);
  if (e.isKeepalive) {
    s.keepalivePings++;
    s.keepaliveCostUsd += pos(e.cost.actualUsd);
    return;
  }
  s.tokens.input += pos(e.usage.input_tokens);
  s.tokens.output += pos(e.usage.output_tokens);
  s.tokens.cache_read += pos(e.usage.cache_read_input_tokens);
  s.tokens.cache_creation += pos(e.usage.cache_creation_input_tokens);
  s.costUsd += pos(e.cost.actualUsd);
  s.savedUsd += pos(e.cost.savedUsd);
  const cls = `${Math.min(Math.max(Math.floor(e.status / 100), 0), 9)}xx`;
  s.requestsByClass.set(cls, (s.requestsByClass.get(cls) ?? 0) + 1);
  let i = LATENCY_BUCKETS_MS.findIndex((b) => e.latencyMs <= b);
  if (i === -1) i = LATENCY_BUCKETS_MS.length; // +Inf
  for (; i < s.latencyBuckets.length; i++) s.latencyBuckets[i]++;
  s.latencySumMs += e.latencyMs;
  s.latencyCount++;
}

/** test hook */
export function resetMetrics(): void {
  providers.clear();
}

export function renderMetrics(pool: pg.Pool): string {
  const lines: string[] = [];
  // Exposition-format rule: all samples of a metric family must be contiguous
  // (strict parsers like promtool reject interleaving) — hence one family()
  // block at a time, iterating providers inside each.
  const family = (
    name: string,
    type: "counter" | "gauge" | "histogram",
    help: string,
    emit: (push: (labels: string, value: number) => void) => void
  ) => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    emit((labels, value) => lines.push(`${name}${labels} ${value}`));
  };

  family("caching_build_info", "gauge", "Build metadata (constant 1).", (push) =>
    push(`{version="${PROXY_VERSION}"}`, 1)
  );
  family("process_start_time_seconds", "gauge", "Unix time the proxy process started.", (push) =>
    push("", startTimeSeconds)
  );
  family(
    "caching_requests_total", "counter",
    "Proxied customer requests by provider and status class (keep-alive pings excluded).",
    (push) => {
      for (const [p, s] of providers)
        for (const [cls, n] of s.requestsByClass) push(`{provider="${p}",class="${cls}"}`, n);
    }
  );
  family("caching_keepalive_pings_total", "counter", "Cache warming pings sent by the keep-alive engine.", (push) => {
    for (const [p, s] of providers) push(`{provider="${p}"}`, s.keepalivePings);
  });
  family("caching_keepalive_cost_usd_total", "counter", "Provider spend on cache warming pings, USD at list prices.", (push) => {
    for (const [p, s] of providers) push(`{provider="${p}"}`, s.keepaliveCostUsd);
  });
  family(
    "caching_tokens_total", "counter",
    "Tokens metered from customer responses by kind (input, output, cache_read, cache_creation); keep-alive pings excluded.",
    (push) => {
      for (const [p, s] of providers)
        for (const [kind, n] of Object.entries(s.tokens)) push(`{provider="${p}",kind="${kind}"}`, n);
    }
  );
  family("caching_cost_usd_total", "counter", "Actual provider spend on customer requests, USD at list prices.", (push) => {
    for (const [p, s] of providers) push(`{provider="${p}"}`, s.costUsd);
  });
  family(
    "caching_saved_usd_total", "counter",
    "Gross spend avoided by cache hits on customer requests, USD at list prices (write premiums not netted here — see the console for net savings).",
    (push) => {
      for (const [p, s] of providers) push(`{provider="${p}"}`, s.savedUsd);
    }
  );
  family("caching_request_latency_ms", "histogram", "End-to-end latency of proxied customer requests.", (push) => {
    for (const [p, s] of providers) {
      LATENCY_BUCKETS_MS.forEach((b, i) => push(`_bucket{provider="${p}",le="${b}"}`, s.latencyBuckets[i]));
      push(`_bucket{provider="${p}",le="+Inf"}`, s.latencyBuckets[LATENCY_BUCKETS_MS.length]);
      push(`_sum{provider="${p}"}`, s.latencySumMs);
      push(`_count{provider="${p}"}`, s.latencyCount);
    }
  });
  family("caching_db_pool_connections", "gauge", "Postgres connection pool state.", (push) => {
    push(`{state="total"}`, pool.totalCount ?? 0);
    push(`{state="idle"}`, pool.idleCount ?? 0);
    push(`{state="waiting"}`, pool.waitingCount ?? 0);
  });

  return lines.join("\n") + "\n";
}

/** GET /metrics — 404 unless METRICS_TOKEN is configured, 403 on a bad token. */
export function metricsHandler(pool: pg.Pool) {
  return (c: Context) => {
    const token = process.env.METRICS_TOKEN;
    if (!token) return c.notFound();
    const given = Buffer.from(c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
    const want = Buffer.from(token);
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      return c.text("forbidden", 403);
    }
    return c.text(renderMetrics(pool), 200, {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
    });
  };
}
