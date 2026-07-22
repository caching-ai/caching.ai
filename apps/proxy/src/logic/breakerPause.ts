// Injection auto-pause on cache breakers. When the front blocks
// (tools/system) hash differently on consecutive requests AND nothing is
// being read from cache, every injected breakpoint only buys write premiums
// (S3 in BENCHMARK.md). After BREAKER_PAUSE_STREAK consecutive such requests
// the proxy stops injecting for that key+model until a stable request shows
// up again — the dashboard keeps naming the breaker either way.
//
// Per-replica in-memory state, deliberately: it converges within a couple of
// requests on every replica, needs no coordination, and a false resume only
// costs one write premium.

const BREAKER_PAUSE_STREAK = 2;
const MAX_ENTRIES = 10_000;

const streaks = new Map<string, number>();

// sub-tenants stream independently through one key — pause per tenant, or a
// single breaker-y tenant would kill injection for every other tenant
const keyOf = (apiKeyId: number, provider: string, model: string, tenant = "") =>
  `${apiKeyId}:${provider}:${model}:${tenant}`;

/** Record one request's breaker outcome (called from the async log path). */
export function noteBreakerObservation(
  apiKeyId: number,
  provider: string,
  model: string,
  breakerDetected: boolean,
  cacheReadHit: boolean,
  tenant = ""
): void {
  const k = keyOf(apiKeyId, provider, model, tenant);
  if (breakerDetected && !cacheReadHit) {
    if (!streaks.has(k) && streaks.size >= MAX_ENTRIES) {
      const oldest = streaks.keys().next().value;
      if (oldest !== undefined) streaks.delete(oldest);
    }
    streaks.set(k, (streaks.get(k) ?? 0) + 1);
  } else {
    streaks.delete(k); // stable prefix (or cache actually hitting) → resume
  }
}

/** true → skip breakpoint/key injection for this key+model right now */
export function injectionPaused(apiKeyId: number, provider: string, model: string, tenant = ""): boolean {
  return (streaks.get(keyOf(apiKeyId, provider, model, tenant)) ?? 0) >= BREAKER_PAUSE_STREAK;
}

/** test hook */
export function resetBreakerPause(): void {
  streaks.clear();
}
