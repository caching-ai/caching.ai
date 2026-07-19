---
name: hold
description: Hold the caching.ai prompt cache warm for a while (default 2h, max 12h) so stepping away doesn't cost a cold cache re-write. Use when the user says things like "keep my cache warm", "hold the cache for 4 hours", "캐시 지켜줘", "점심 먹고 올게 캐시 유지해줘".
argument-hint: "[duration — e.g. 4h, 90m, 3 hours, 2시간]"
allowed-tools: "Bash"
---

Send a warm-hold command to the caching.ai proxy and relay its answer.

1. Run exactly:

   ```bash
   "${CLAUDE_PLUGIN_ROOT}/bin/cache-keeper.sh" --hold "$ARGUMENTS"
   ```

   If the user gave no duration, omit the second argument (the proxy defaults
   to 2 hours). Pass the duration in the user's own words/language — the proxy
   parses "4h", "90m", "3 hours", "2시간", "media hora" and replies in kind.

2. Relay the script's output to the user verbatim (it is the proxy's reply,
   already in the user's language, starting with 🔥 on success).

3. If the output starts with `not-connected:` or `no-key:`, tell the user this
   session isn't routed through caching.ai yet and offer to run /cache:setup.

4. If the reply says the Cache Warmer is off for the key, point the user to
   https://caching.ai/console → key settings to enable it.

Never send the hold as a chat message yourself — the script talks to the proxy
directly, which is reliable regardless of how this session is configured.
