<p align="center">
  <img src="apps/web/public/logo.png" alt="caching.ai" width="360" />
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
- **Cache guard** — auto `cache_control` injection (Anthropic), stable
  `prompt_cache_key` routing (OpenAI), and cache-breaker detection with the
  likely root cause (timestamps, random IDs, reordered tools).
- **Keep-alive warming** *(opt-in per key)* — 1-token pings re-warm your
  prefix exactly while re-use is economical (up to 62.5 min), within a daily
  budget you control.
- **Prefix optimizer** — measures which part of your prompt changes between
  requests and tells you how to fix it.

Works with every SDK — integration is a base-URL swap:

```bash
# before
ANTHROPIC_BASE_URL=https://api.anthropic.com
# after
ANTHROPIC_BASE_URL=https://your-proxy-host   # or https://proxy.caching.ai
ANTHROPIC_API_KEY=ck_your_caching_ai_key
```

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
- Proxy → http://localhost:8787 (health: `/healthz`)

Sign up in the console, register your provider API keys (encrypted at rest
with AES-256-GCM), create a `ck_` key, and point your SDK's base URL at the
proxy. Postgres migrations run automatically when the proxy boots.

Optional integrations (all off by default): Google OAuth
(`GOOGLE_CLIENT_ID/SECRET`), transactional email (`RESEND_API_KEY`),
Prometheus metrics (`METRICS_TOKEN` → `GET /metrics` with
`authorization: Bearer <token>`), raw log retention tuning
(`LOG_RETENTION_DAYS`, default 100 — complete days are rolled up into
`request_logs_daily` before pruning), and the postpaid billing pipeline
(`BILLING_LIVE=1` + Stripe/Toss keys — you almost certainly don't want this
self-hosted).

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
