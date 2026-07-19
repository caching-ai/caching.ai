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

// The client can put anything in X-Forwarded-For; only the entry appended by
// our own trusted reverse proxy (Caddy, one hop) is authentic, and that is the
// RIGHTMOST value. Taking the leftmost let an attacker rotate a spoofed IP per
// request and slip every IP-keyed limit. TRUSTED_PROXY_HOPS lets a deeper chain
// (e.g. an extra LB) pick the correct entry from the right.
const TRUSTED_PROXY_HOPS = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS ?? 1));

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (!fwd) return "local";
  const parts = fwd.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return "local";
  const idx = parts.length - TRUSTED_PROXY_HOPS;
  return parts[Math.max(0, idx)];
}
