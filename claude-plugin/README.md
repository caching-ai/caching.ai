# Caching.ai Cache Keeper — Claude Code plugin

Keeps your Anthropic prompt cache warm through the [caching.ai](https://caching.ai)
proxy, automatically. After every turn the plugin silently renews a **warm
hold** (default 2 hours, max 12), so stepping away for lunch or a meeting no
longer means coming back to a cold cache and paying a full prefix re-write.

The hold command is answered by the proxy itself — it never reaches the AI
provider and costs **zero tokens**. Server-side warming stays within the
key's daily budget (default $1/day), and long holds are served as a single
1-hour cache write when that's cheaper than a ping stream.

## Install

Inside Claude Code:

```
/plugin marketplace add caching-ai/caching.ai
/plugin install cache@caching-ai
```

Not connected to caching.ai yet? Run `/cache:setup` — it configures
`~/.claude/settings.json` (with a backup), verifies with a real call, and
explains the key registration at https://caching.ai/console/keys.

## Commands

| Command | What it does |
| --- | --- |
| `/cache:hold 4h` | Hold the cache warm for a specific window (5m–12h) |
| `/cache:status` | Show proxy routing, key, auto-hold setting, last hold |
| `/cache:setup` | Connect this machine to the caching.ai proxy |

Claude Code namespaces every plugin command, so `/cache:hold` is as short as
a plugin can make it. Want a bare `/cache 4h`? `/cache:setup` offers to add a
one-line personal skill (`~/.claude/skills/cache/`) that forwards to
`/cache:hold`.

Once a hold is set, your machine is out of the picture: the warming runs
**server-side** on the caching.ai cloud, so closing the laptop or dropping
off the network doesn't end it — the hold keeps the cache warm for its full
window.

## Configuration

Set in the `env` block of `~/.claude/settings.json`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `CACHING_AUTO_HOLD` | `2h` | Hold renewed after each turn (`off` disables) |
| `CACHING_PROXY_URL` | — | Self-hosted proxy URL (overrides the default host check) |

The automatic hold only fires when the session is actually routed through the
caching.ai proxy (`ANTHROPIC_BASE_URL`), it is throttled to one send per five
minutes, and it never blocks or fails your turn.

## Requirements

- A caching.ai key (`ck_…`) with the **Cache Warmer** enabled — new keys have
  it on by default (Autopilot preset)
- Your Anthropic provider key registered once at https://caching.ai/console/keys
- Warming is Anthropic-only, by measurement: other providers hold their caches
  upstream long enough that pings would only burn budget
