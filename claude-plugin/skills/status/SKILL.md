---
name: status
description: Show whether this Claude Code session is routed through the caching.ai proxy, which key it uses, the auto-hold setting, and when the last warm hold was sent.
allowed-tools: "Bash"
---

Report the cache-keeper state.

1. Run exactly:

   ```bash
   "${CLAUDE_PLUGIN_ROOT}/bin/cache-keeper.sh" --status
   ```

2. Summarize the output for the user in their language, briefly:
   - whether the session goes through the caching.ai proxy (and which URL)
   - the key in use (already masked by the script — show it as printed)
   - the auto-hold duration and that it renews automatically after each turn
   - when the last hold was sent and what the proxy answered

3. If the proxy is not connected, offer to run /cache:setup.

4. Mention that live savings and warming spend are on the dashboard at
   https://caching.ai/console.
