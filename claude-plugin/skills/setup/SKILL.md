---
name: setup
description: Connect this machine's Claude Code to the caching.ai proxy (base URL + ck_ key in ~/.claude/settings.json), verify with a real call, and enable the automatic cache keeper. Use when the user asks to set up, connect, or fix their caching.ai integration.
argument-hint: "[ck_… key, if the user pastes one]"
---

Configure Claude Code to route through the caching.ai proxy, following the
canonical guide. Safety rules are mandatory.

1. Fetch https://caching.ai/agent-setup.md (WebFetch) and follow its **safety
   rules** exactly: back up every file you touch (`settings.json` →
   `settings.json.bak-caching`), merge — never overwrite unrelated settings —
   and show the user a diff of each change.

2. You need the user's caching.ai key (`ck_…`). If it wasn't passed as an
   argument, ask for it. If they don't have one: they can sign up and create a
   key at https://caching.ai/console/keys — new keys default to Autopilot
   (cache injection + Cache Warmer on, $1/day warming budget), which is what
   the cache keeper needs. Their Anthropic provider key must be registered
   there once, too.

3. Merge into `~/.claude/settings.json`:

   ```json
   {
     "env": {
       "ANTHROPIC_BASE_URL": "https://proxy.caching.ai",
       "ANTHROPIC_AUTH_TOKEN": "ck_…"
     }
   }
   ```

   The ck_ key goes ONLY into this local file. Never send it anywhere except
   proxy.caching.ai, never commit it, never echo it into persisted logs.

4. Optional knobs (only if the user asks): `"CACHING_AUTO_HOLD": "4h"` in the
   same env block changes how long each automatic hold lasts (default 2h, max
   12h); `"off"` disables the automatic hold entirely. Self-hosters set
   `"CACHING_PROXY_URL"` to their own proxy URL instead.

5. Verify:
   - `curl -s https://proxy.caching.ai/healthz` → expect `{"ok":true,…}`
   - one tiny real call with the ck_ key (see agent-setup.md's verify section)
   - `"${CLAUDE_PLUGIN_ROOT}/bin/cache-keeper.sh" --status` → should show the
     proxy URL and the masked key

6. Tell the user: the new env takes effect for NEW Claude Code sessions
   (restart this one after setup), requests and savings appear at
   https://caching.ai/console from the first call, and from now on the plugin
   renews a warm hold automatically after every turn — stepping away for lunch
   no longer means a cold cache. Longer breaks: `/cache:hold 8h`.

7. Optional shortcut — a bare `/cache` command: plugin skills are always
   namespaced (`/cache:hold`), so if the user wants to just type `/cache 4h`,
   offer to create a personal skill at `~/.claude/skills/cache/SKILL.md`
   (create the directory; don't overwrite an existing skill of that name):

   ```markdown
   ---
   name: cache
   description: Shortcut for the caching.ai warm hold — same as /cache:hold.
   argument-hint: "[duration — e.g. 4h, 90m, 2시간]"
   ---

   Invoke the `cache:hold` skill from the Caching.ai Cache Keeper plugin,
   passing along any arguments the user gave (e.g. "4h"). If that plugin is
   not installed, tell the user to run:
   /plugin marketplace add caching-ai/caching.ai
   /plugin install cache@caching-ai
   ```

If Anthropic requests fail with 403 mentioning a missing provider key, the
user still needs to register their Anthropic key at
https://caching.ai/console/keys.
