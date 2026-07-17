# @caching/ee-adaptive — Adaptive cache tuning (Enterprise)

Learns each API key's real traffic rhythm and picks the cheapest cache
settings automatically — the longer you use it, the more it saves.

What it does, per key in `auto` mode:

- **Anthropic cache TTL (5m vs 1h)** — replays the key's recent request gaps
  through both TTL regimes (write premiums, warming pings, give-up windows)
  and applies the cheaper one when the difference is meaningful.
- **OpenAI retention** — turns on 24h `prompt_cache_retention` once the key
  has real OpenAI traffic (free, and it makes warming pings unnecessary).

Every change is recorded in `tuning_decisions` with the full reasoning
(median gap, sample size, simulated cost of both options), and the console
shows it in plain language.

## Licensing & gating

This directory is covered by the [Caching.ai Enterprise License](./LICENSE),
not Apache-2.0 (see `ee/README.md`). The core proxy imports this module but
only activates it when `CACHING_CLOUD=1` is set — self-hosted builds run
fully without it.
