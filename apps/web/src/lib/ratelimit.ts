// In-memory sliding-window rate limiter for the auth surface. Per replica —
// good enough to blunt brute force / mail bombing; a shared store can replace
// it if the console ever scales wide.
const buckets = new Map<string, number[]>();
const MAX_BUCKETS = 50_000;

export function rateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;
  let hits = buckets.get(key);
  if (!hits) {
    if (buckets.size >= MAX_BUCKETS) {
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined) buckets.delete(oldest);
    }
    hits = [];
    buckets.set(key, hits);
  }
  while (hits.length && hits[0] < cutoff) hits.shift();
  if (hits.length >= limit) return true;
  hits.push(now);
  return false;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : "local";
}
