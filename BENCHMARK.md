# Does caching.ai actually save money? We measured it.

Three arms, six traffic patterns, seven models, **10,000+ real API calls at
list prices** (2026-07, proxy v0.10.0). Everything here is reproducible with
your own keys — method, fixtures, runner and raw logs are in
[`bench/`](bench/README.md).

**Arms.** A = provider called directly, no cache hints (SDK defaults). B =
direct, hand-placed `cache_control` exactly where our proxy would put it
(Anthropic only — OpenAI/Gemini/Grok cache automatically, so A ≡ B there). C =
the same requests through caching.ai, **net of keep-alive ping costs**. Costs
are provider-reported usage tokens × public list prices; fixed conversation
scripts; per-arm salt tokens so arms can never share a provider cache.
Details: [`bench/README.md`](bench/README.md).

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
2. **Short TTLs die in idle gaps.** In S2, hand-tuned B actually costs **25%
   more than naive A**: its cache expires in every 6–9 min gap, so it pays the
   1.25× write premium twelve times and reads nothing. C's keep-alive holds the
   prefix warm (91% hit rate) and still wins 67% after paying for every ping.

## GPT-5.6: the proxy restores caching the new models dropped

GPT-5.6-generation models moved to **breakpoint-scoped caching**, and the
implicit breakpoint sits on the *latest message* — so plain SDK traffic with a
shared system prompt gets **0% cross-request prefix hits** (we measured 3,240
calls on `gpt-5.6-sol`: only byte-identical repeat prompts ever hit). The
proxy injects the documented remedy — an explicit `prompt_cache_breakpoint`
at the end of the shared prefix plus a stable `prompt_cache_key` — on both
chat/completions and the Responses API, whenever the request carries no
caching parameters of its own.

Measured end-to-end (different user suffix per call):

| gpt-5.6-sol, ~2.7k-token shared prefix | call 2+ cached tokens |
|---|---|
| direct, SDK defaults | **0** |
| through caching.ai | **2,659 / 2,678 (99.3%)** |

## Model-provider behavior notes

- **OpenAI (pre-5.6), Gemini, Grok**: these providers hold their caches
  upstream on their own, so the proxy passes traffic through untouched — no
  pings, no injected routing keys, no write premiums. You get metering,
  breaker diagnosis and budget controls at pass-through cost.
- **Unstable prefixes** (a timestamp or random ID in the system prompt) can't
  be cached by anyone. The proxy names the breaker and its likely root cause
  on the dashboard, and automatically pauses its own injection while the
  prefix keeps changing — so a broken prompt never buys write premiums.
- **Warm holds** ("keep my cache warm for 2 hours" in chat): long holds are
  served as a single 1 h-TTL cache write plus an hourly refresh; short holds
  bridge with 0.1× pings — whichever is cheaper for the window you asked for.

**Latency.** The proxy hop was smaller than provider noise in most cells: TTFT
p50 deltas ranged from −77 ms (C faster, cache hits) to +121 ms (pure
pass-through cells).

## Reproduce it

```sh
node bench/setup-keys.mjs
node bench/orchestrate.mjs --run-id run-$(date +%Y%m%d) --budget 150
node bench/analyze.mjs --run-id run-...
```

Raw JSONL for the published cells (secrets redacted at write time, failures
included) is under [`bench/results/`](bench/results/). Prices: public list
prices as of 2026-07 (see `bench/lib/pricing.mjs`). Caveats: single region
(client in Seoul); grok-4.5 ran 150 of 300 S4 steps (cost control) with
`reasoning_effort: "low"` in **both** arms.
