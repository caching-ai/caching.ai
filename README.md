<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/logo-dark.png">
    <img src="apps/web/public/logo.png" alt="caching.ai" width="360">
  </picture>
</p>

<p align="center">
  <b>The proxy that keeps your AI prompt cache warm — and your bill low.</b><br/>
  Drop-in for Anthropic, OpenAI, Gemini, and Grok. One base-URL swap.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License" /></a>
  <a href="https://www.npmjs.com/package/cache-guard"><img src="https://img.shields.io/npm/v/cache-guard?label=cache-guard" alt="npm" /></a>
  <a href="https://caching.ai"><img src="https://img.shields.io/badge/cloud-caching.ai-00d722" alt="Cloud" /></a>
</p>

---

Model providers already discount repeated prompt prefixes by ~90% — but only
while the cache stays warm. In real traffic it silently expires (≈5 idle
minutes) or breaks (one unstable byte in the prefix), and you pay full price
again. Caching.ai sits between your app and the provider and makes the
discount actually land:

- **Cache analytics** — real hit rate, dollars saved, and the number nobody
  shows you: dollars wasted on prompts that should have been cached. Token
  counts only; prompt/response bodies are never stored.
- **Cache guard** — auto `cache_control` injection (Anthropic), GPT-5.6+
  cache restore (the 5.6 generation only matches at breakpoints, so naive
  shared prefixes get 0% cross-request hits — we inject an explicit
  `prompt_cache_breakpoint` plus a STABLE `prompt_cache_key`, verified live
  0% → 99.6% prefix hits), and cache-breaker detection with the likely root
  cause (timestamps, random IDs, reordered tools).
- **Keep-alive warming** *(opt-in per key, Anthropic only — by design)* —
  1-token pings re-warm your prefix exactly while re-use is economical (up to
  62.5 min), within a daily budget you control. Other providers hold their
  caches upstream on their own (we measured — [BENCHMARK.md](BENCHMARK.md)),
  so the proxy never spends your budget where a ping can't pay off. Holds
  of 30+ minutes are served as a single 1h-TTL write instead of pings.
  Stepping away? Say `"keep my cache warm for 2 hours"`
  in chat — the proxy answers it itself and holds warming (see below).
- **Prefix optimizer** — measures which part of your prompt changes between
  requests and tells you how to fix it.

<p align="center">
  <img src=".github/assets/hero-cache-warm.png" alt="A robot keeping the cache flame warm while the cold one costs 10x" width="640">
</p>

**Measured, not promised:** we benchmarked caching.ai against calling the
providers directly — three arms, six traffic patterns, ~10k calls, raw logs
committed, including the scenarios where we win nothing. See
[BENCHMARK.md](BENCHMARK.md).

Works with every SDK — integration is a base-URL swap:

```bash
# before
ANTHROPIC_BASE_URL=https://api.anthropic.com
# after
ANTHROPIC_BASE_URL=https://your-proxy-host   # or https://proxy.caching.ai
ANTHROPIC_API_KEY=ck_your_caching_ai_key
```

## Warm holds, in plain language

Send one short chat message through any SDK — the proxy intercepts it,
replies instantly, and never forwards it upstream, so it costs zero tokens:

```
"keep my cache warm for 2 hours"
"캐시 2시간 지켜줘" · "キャッシュを2時間保温して"
"mantén mi caché caliente 2 horas" · "帮我保温缓存 2 小时"
cai:hold 45m          # explicit command — works anywhere, any language

→ 🔥 Warming held for 2 hours. (answered at the proxy, $0)
```

Default 2 h, clamped to 5 min – 12 h. Works on every path — Anthropic
Messages, OpenAI chat & responses (Codex), Gemini, Grok — and replies in the
language you asked in (ko/en/ja/es/zh). The message must be short (≤ 60
chars) and clearly about the cache; anything that looks like a real prompt
passes through untouched. Keep-alive must be enabled on the key, and the
daily warming budget still applies. The console shows a
"Warm hold active · until HH:MM" badge while it lasts.

## Cloud vs. self-host

| | **Caching.ai Cloud** | **Self-host** |
|---|---|---|
| Ops | Zero — we run the proxy, warming daemon, and dashboard 24/7 | You run it |
| Price | 20% of your *net verified savings*, under $5/mo waived | Free forever |
| Billing infra | Postpaid card-on-file, savings verification included | Not needed |
| Get started | [caching.ai](https://caching.ai) — 2 minutes | `docker compose up` below |

If we save you nothing, you pay nothing — that's the whole pricing model.

## Self-hosting

Requirements: Docker + Docker Compose.

```bash
git clone https://github.com/caching-ai/caching.ai.git
cd caching.ai
cp .env.example .env          # then fill in the two secrets:
# ENCRYPTION_KEY=$(openssl rand -hex 32)
# SESSION_SECRET=$(openssl rand -hex 32)
docker compose up -d --build
```

- Web console → http://localhost:3000
- Proxy → http://localhost:8787 (liveness: `/healthz`, readiness: `/readyz` —
  checks the database)

Sign up in the console, register your provider API keys (encrypted at rest
with AES-256-GCM), create a `ck_` key, and point your SDK's base URL at the
proxy. Postgres migrations run automatically when the proxy boots.

Optional integrations (all off by default): Google OAuth
(`GOOGLE_CLIENT_ID/SECRET`), transactional email (`RESEND_API_KEY` — enables
signup verification, the weekly savings report, and keep-alive budget
alerts, all with one-click RFC 8058 unsubscribe), Prometheus metrics
(`METRICS_TOKEN` → `GET /metrics` with `authorization: Bearer <token>`:
request/token/cost/saved counters, keep-alive ping cost, latency histogram,
DB pool gauges), raw log retention tuning (`LOG_RETENTION_DAYS`, default
100 — complete days are rolled up into `request_logs_daily` before pruning),
upstream URL overrides (`UPSTREAM_URL`, `OPENAI_UPSTREAM_URL`,
`GEMINI_UPSTREAM_URL`, `GROK_UPSTREAM_URL`), and the postpaid billing
pipeline (`BILLING_LIVE=1` + Stripe/Toss keys — you almost certainly don't
want this self-hosted). Every knob is listed with comments in
[.env.example](.env.example).

## Architecture

pnpm monorepo:

```
apps/proxy          Hono proxy — key exchange, usage metering from the live
                    stream (SSE passthrough, no buffering), cache_control
                    injection, breaker detection, keep-alive scheduler,
                    savings/billing sweeps
apps/web            Next.js console — dashboard, key management, billing
packages/shared     pricing tables, crypto, db + forward-only migrations
packages/cache-guard-cli   `npx cache-guard` — scan a repo for cache breakers
ee/                 source-visible, commercially licensed (see ee/README.md) —
                    adaptive cache tuning that powers the cloud's Auto-Tune
```

### Catch cache breakers in CI

[`cache-guard`](https://www.npmjs.com/package/cache-guard) is a tiny npm CLI
that hashes the cacheable prefix (tools, system, first message) of Anthropic
Messages request fixtures — so the PR that accidentally destabilizes your
prompt prefix fails CI instead of silently 10×-ing your bill:

```bash
npx cache-guard snapshot fixtures/*.json   # write the .cacheguard.json baseline
npx cache-guard check fixtures/*.json      # exit 1 if any prefix hash changed
```

Privacy model: the proxy stores token counts, model names, latency, status
codes, and SHA-256 hashes of prefix blocks — never prompt or response bodies.
The one exception is opt-in keep-alive, which stores the last prompt prefix
encrypted (AES-256-GCM) because re-sending it is how the cache stays warm.
It's your database — verify all of this in the code.

## Development

```bash
pnpm install
cd apps/proxy && pnpm test    # needs local Postgres 16
cd apps/web && pnpm dev
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE) © 2026 AI3 Inc. — everything in this repository
EXCEPT the `ee/` directory, which is source-visible under a commercial
license (see [ee/README.md](ee/README.md)); self-hosted builds run fully
without it. "caching.ai" and the flame logo are trademarks of AI3 Inc. —
see [NOTICE](NOTICE).
