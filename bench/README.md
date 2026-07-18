**English** | [한국어](README.ko.md) | [日本語](README.ja.md) | [中文](README.zh.md) | [Español](README.es.md)

# Caching.ai effectiveness benchmark

Measures what [caching.ai](https://caching.ai) actually saves (or doesn't) against calling the
providers directly, across six traffic patterns and several models. Everything
needed to reproduce it with your own keys is in this folder: scenario
definitions, synthetic fixtures, the runner, and the raw result logs
(`results/`). The headline summary lives in [`../BENCHMARK.md`](../BENCHMARK.md).

## Arms

| arm | path | who it represents |
|---|---|---|
| **A** direct-naive | provider API, no cache hints | most real users (SDK defaults) |
| **B** direct-tuned | provider API, hand-placed `cache_control` on the last system block + last tool (exactly where the proxy would put it) | a diligent team on Anthropic |
| **C** caching.ai | same request through `proxy.caching.ai` with a `ck_` key at default settings (+ keep-alive where the scenario says so) | caching.ai users |

OpenAI, Gemini and Grok have no `cache_control` knob (caching is automatic), so
A ≡ B there and those models run two arms. **C's keep-alive ping costs are part
of C's reported net cost** — nothing is hidden in the proxy's own spend.

## Scenarios

| # | name | pattern | what it tests |
|---|---|---|---|
| S1 | agent-coding | 40-call agent loop, 0–90 s gaps, ~9k-token system+tools | value of automatic breakpoints under steady agent traffic |
| S2 | support-sparse | 12 conversations, **6–9 min idle** between them | the flagship: gaps longer than every short cache TTL |
| S3 | rag-timestamp | 30 calls with a live timestamp **inside** the system prompt | a cache breaker nobody can fix in-flight — the proxy auto-pauses its own injection and names the root cause |
| S4 | batch-classify | 300 short calls, shared ~5k-token prefix | steady-state hit rates + OpenAI `prompt_cache_key` routing |
| S5 | lunch-hold | call → **45 min idle** → call | the warm-hold chat command (`cai:hold 1h`) |
| S6 | steady | 60 calls, 30 s apart | steady-state hit rates — including the GPT-5.6 restore under load (97.8% hits vs 0% for SDK defaults) |

The `gpt-5.5` and `gpt-4o` cells in S2 double as pass-through checks: OpenAI
retains its cache upstream on pre-5.6 models, so the proxy deliberately adds
nothing there — expect near-identical arms.

## Fairness rules

1. **Cache-namespace isolation.** Every system prompt starts with a salt token
   `[bench <run-id> <arm> r<rep>]`, so arms and reps can never hit each other's
   provider-side caches.
2. **Interleaving.** Within every step the arms run back-to-back (A → B → C),
   so no arm gets a friendlier time of day or provider load.
3. **Real idle gaps.** Cache expiry is wall-clock; sparse scenarios really wait
   (S2 ≈ 85 min, S5 ≈ 45 min per rep). Reps run in parallel in separate
   namespaces.
4. **Fixed conversation scripts.** Model responses are never fed into later
   turns — response-length variance cannot contaminate input-side cost.
   Output cost is reported separately as a reference figure.
5. **Provider-reported usage only.** Costs are usage-block tokens × public
   list prices (`lib/pricing.mjs`, mirroring `packages/shared`). The caching.ai
   dashboard is used only to cross-check.
6. **Repetition.** Three reps per cell, reported as mean (min–max). Transient
   429/5xx are retried with backoff and the retry count is logged; retried
   calls are excluded from latency percentiles.
7. **Budget guard.** Every call appends to a shared ledger; the whole run
   hard-aborts at the cap (default $150).

## Reproducing

Prereqs: Node ≥ 20, a caching.ai account, and your own provider keys.

```sh
# 1. credentials (kept OUTSIDE the repo)
mkdir -p ~/.config/caching-bench && chmod 700 ~/.config/caching-bench
cat > ~/.config/caching-bench/env <<'ENV'
BENCH_EMAIL=you@example.com        # caching.ai console account
BENCH_PASSWORD=...
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
# XAI_API_KEY=xai-...              # optional; Grok cells are skipped without it
ENV
chmod 600 ~/.config/caching-bench/env

# 2. register your provider keys on the account (console → Provider keys),
#    then mint one ck_ key per C-arm cell:
node bench/setup-keys.mjs

# 3. dry-run the harness (~$0.10)
node bench/run.mjs --run-id dry --scenario S6 --model haiku --reps 1 --limit-steps 4 --gap-scale 0.2 --budget 3

# 4. full matrix (~2 h wall clock, ~$60–90 at list prices)
node bench/orchestrate.mjs --run-id run-$(date +%Y%m%d) --budget 150

# 5. keep-alive ping attribution + summary
node bench/fetch-pings.mjs --run-id run-...   # self-hosters: reads request_logs; hosted users can read the console dashboard instead
node bench/analyze.mjs --run-id run-...
```

`fetch-pings.mjs` needs a `DATABASE_URL` for the proxy's Postgres (self-hosted
deployments have this by definition). On the hosted cloud the same numbers are
on the console dashboard (keep-alive pings / spend); the run's totals are
cross-checked against `/api/stats` either way.

## Layout

```
scenarios/   declarative scenario definitions (gap schedules included)
fixtures/    synthetic prompts (gen-fixtures.mjs regenerates them byte-identically)
lib/         pricing tables, provider callers, matrix, helpers
run.mjs      one cell: arms interleaved per step, reps in parallel
orchestrate.mjs  the full matrix with a shared budget cap
analyze.mjs  raw JSONL → summary.json / summary.md
results/     raw logs of the published set (run-202607-v0100) — committed, secrets redacted at write time
```

All fixture text is synthetic (invented products, seeded generator). Raw
results for the published set are committed with secrets redacted at write
time, failed calls included.
