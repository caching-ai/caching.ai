# cache-guard

CI guard for LLM prompt-cache prefixes — fails the build when a system prompt,
tool list, or first message changes unintentionally.

Why: providers (Anthropic, OpenAI, Gemini, Grok) serve repeated prompt
prefixes from cache at ~10% of list price. One "harmless" edit to a system
prompt silently invalidates that cache in production and 10x-es the token
bill. `cache-guard` pins the cache-relevant prefix blocks of your prompt
fixtures and turns that silent regression into a red build.

## Usage

Keep one or more request-body fixtures (Anthropic Messages API shape) in your
repo, then:

```sh
npx cache-guard snapshot fixtures/*.json   # write .cacheguard.json baseline
npx cache-guard check    fixtures/*.json   # exit 1 if any prefix hash changed
```

In CI:

```yaml
- run: npx cache-guard check fixtures/*.json
```

When a change is intentional, refresh the baseline with `snapshot` and commit
`.cacheguard.json`.

- `CACHE_GUARD_FILE` — override the baseline path (default `.cacheguard.json`)
- Hashes cover the blocks that decide cache hits: `tools`, `system`, and the
  first message. Nothing else in the fixture matters to the guard.

Made by [Caching.ai](https://caching.ai) — a drop-in proxy that watches,
protects, and keeps your LLM prompt cache warm.
