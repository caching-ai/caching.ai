# Does caching.ai actually save money? We measured it.

One run, three arms, six traffic patterns, seven models, **9,972 API calls + 207
keep-alive pings, $74.52 at list prices** (2026-07-18, proxy v0.9.0). Everything
here is reproducible with your own keys — method, fixtures, runner and **all raw
logs** are in [`bench/`](bench/README.md). Scenarios where we win nothing (or
lose) are published below, unedited.

**Arms.** A = provider called directly, no cache hints (SDK defaults). B =
direct, hand-placed `cache_control` exactly where our proxy would put it
(Anthropic only — OpenAI/Gemini/Grok cache automatically, so A ≡ B there). C =
the same requests through caching.ai at default settings, **net of keep-alive
ping costs**. Costs are provider-reported usage tokens × public list prices;
fixed conversation scripts; per-arm salt tokens so arms can never share a
provider cache. Details: [`bench/README.md`](bench/README.md).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/bench-scenarios-dark.svg">
  <img alt="Input-side cost of arms A/B/C across the six scenarios on claude-haiku-4.5" src=".github/assets/bench-scenarios-light.svg" width="820">
</picture>

## Where caching.ai wins

| workload (claude-haiku-4.5) | A direct | C caching.ai (net) | saved |
|---|---|---|---|
| S2 sparse support — 12 calls, 6–9 min idle | $0.0720 | **$0.0240** (incl. 16 pings) | **67%** |
| S1 agent loop — 40 calls, 0–90 s gaps | $0.4104 | **$0.1378** | **66%** |
| S4 classify batch — 300 calls | $1.7268 | **$0.1868** | **89%** |
| S6 steady traffic — 60 calls, 30 s apart | $0.3123 | **$0.0387** | **88%** |

Same pattern on claude-sonnet-5: S2 **68%**, S1 **69%** saved vs direct.

Two things drive this:

1. **Anthropic caching is opt-in, and most integrations never opt in.** Arm A's
   hit rate is 0% in every Anthropic cell — that is what SDK-default traffic
   looks like. C injects the breakpoints automatically and matches hand-tuned B
   to the token (S1/S4/S6: B and C byte-identical).
2. **Short TTLs die in idle gaps — keep-alive is the only arm that survives
   them.** In S2, hand-tuned B actually costs **25% more than naive A**: its
   cache expires in every 6–9 min gap, so it pays the 1.25× write premium
   twelve times and reads nothing. C's pings hold the prefix warm (91% hit
   rate) and still win 67% after paying for every ping.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/bench-s2-models-dark.svg">
  <img alt="S2 sparse support: cost of each arm relative to direct, per model" src=".github/assets/bench-s2-models-light.svg" width="820">
</picture>

## Where it doesn't (published on purpose)

| cell | result | what it means |
|---|---|---|
| S6 steady traffic, gpt-5.6 / gemini-2.5-flash | **±0%** | auto-caching providers keep themselves warm at a 30 s cadence; C adds only a proxy hop |
| S3 timestamp-in-prompt breaker | **C costs 25% more than A** | nobody can cache a prefix that changes every call; injection just buys write premiums. C's actual value here was diagnosis: the proxy flagged the breaker on **29 of 30 calls** per run |
| S5 45-min lunch hold (haiku, 5 m TTL) | **C costs 23% more than A** | eleven pings cost slightly more than one rewrite — at a 4-min cadence the hold is a **latency/freshness guarantee, not a savings feature**, for a single return call (fix queued below) |
| S2 sparse on gpt-4o / gpt-5.5 / gemini | **C 2.1–2.5× worse** | OpenAI retained its cache across the gaps upstream (hit rates: 88% on gpt-4o, 80% on gpt-5.5 — with zero effort), so warming pings were pure cost, and our injected `prompt_cache_key` correlated with *lower* hit rates than default routing. Gemini's implicit cache never hit in this pattern, making pings pure waste |
| S4 batch on gpt-4o / grok-4.5 | **−1.4% / −1.1%** (noise) | automatic caching already handles steady batches; `prompt_cache_key` / `x-grok-conv-id` injection added nothing measurable |
| gpt-5.6 (all scenarios) | **0% cache hits in every arm** | in 3,240 calls we never observed a cross-suffix prefix hit on `gpt-5.6-sol` — only byte-identical repeat prompts hit. If that's the new cache behavior, prefix-sharing workloads currently get nothing from it, proxied or not |

**Latency.** The proxy hop was smaller than provider noise in most cells: TTFT
p50 deltas ranged from −77 ms (C faster, cache hits) to +121 ms (S6 gpt-5.6,
pure pass-through). Raw percentiles per cell are in
[`bench/results/run-20260718/summary.md`](bench/results/run-20260718/summary.md).

## The honest summary

- On **Anthropic models**, caching.ai's automation matched hand-tuning exactly
  and saved **66–89%** vs SDK-default traffic across every pattern we tested —
  and on sparse traffic it beat hand-tuning, which *loses* money there.
- On **OpenAI, Gemini and Grok**, providers already cache without being asked.
  Today C's measurable value there is metering, breaker diagnosis and budget
  alerts — **not cost savings** — and two of our defaults (OpenAI/Gemini
  warming pings, `prompt_cache_key` injection) measured *negative* in sparse
  patterns.

## Fixes this run put on our roadmap

1. Stop warming gpt-4o-class models (they now behave like extended retention
   upstream) and make OpenAI/Gemini warming data-driven instead of default-on.
2. Re-evaluate `prompt_cache_key` auto-injection — it reduced hit rates vs
   default routing in our S2 runs.
3. Warm holds ≥ 30 min on Anthropic should switch to a 1 h-TTL cache write
   instead of 5 m pings (one 2× write beats eleven 0.1× pings).
4. Grok metering: count xAI's separately-reported reasoning tokens as output
   (they're billed but currently under-displayed in our dashboard).

## Reproduce it

```sh
node bench/setup-keys.mjs
node bench/orchestrate.mjs --run-id run-$(date +%Y%m%d) --budget 150
node bench/analyze.mjs --run-id run-...
```

Raw JSONL for every call of the published run (secrets redacted at write time,
failures included): [`bench/results/run-20260718/`](bench/results/run-20260718/).
Prices: public list prices as of 2026-07 (see `bench/lib/pricing.mjs`).
Caveats: single day, single region (client in Seoul), 3 reps per cell;
grok-4.5 ran 150 of 300 S4 steps (cost control) with `reasoning_effort: "low"`
in **both** arms.
