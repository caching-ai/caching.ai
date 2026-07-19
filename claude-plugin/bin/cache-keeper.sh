#!/bin/bash
# cache-keeper — keeps the caching.ai warm hold alive from Claude Code.
#
# Modes:
#   auto            fired by the Stop / SessionEnd hooks. Silent and throttled:
#                   renews a warm hold for CACHING_AUTO_HOLD (default 2h) so
#                   the cache survives the user stepping away.
#   --hold <dur>    manual hold (used by /cache:hold). Prints the proxy's
#                   reply text. <dur> may be anything the proxy parses:
#                   "4h", "90m", "3 hours", "2시간" …
#   --status        prints resolved config + last auto-hold, for /cache:status.
#
# The hold command is intercepted by the caching.ai proxy itself — it is never
# forwarded to the AI provider and costs zero tokens. Warming stays within the
# key's daily budget, enforced server-side.
#
# Config resolution (first hit wins):
#   proxy URL : $CACHING_PROXY_URL → $ANTHROPIC_BASE_URL → settings env blocks
#   ck_ key   : $ANTHROPIC_AUTH_TOKEN → $ANTHROPIC_API_KEY → settings env blocks
#   auto hold : $CACHING_AUTO_HOLD → settings env blocks → "2h" ("off" disables)
# Settings files scanned (later overrides earlier):
#   ~/.claude/settings.json, ~/.claude/settings.local.json,
#   $CLAUDE_PROJECT_DIR/.claude/settings.json, …/settings.local.json
#
# Safety: in auto mode the script must never fail the turn — every exit path
# is `exit 0`, and the network call has a hard timeout well under the hook's.

set -u

MODE="${1:-auto}"
ARG="${2:-}"

STATE_DIR="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/caching-ai-cache-keeper}"
THROTTLE_SECS=300
DEFAULT_HOLD="2h"
OFFICIAL_HOST="proxy.caching.ai"

# ---- read one env-block value out of the Claude settings files ----
# Scope matters for security: project-level settings files
# ($CLAUDE_PROJECT_DIR/.claude/*) are attacker-controllable — any repo you open
# can ship one. So secrets (the API key) and the self-host proxy URL are read
# from $HOME files ONLY. The one project-scoped value we honor is
# ANTHROPIC_BASE_URL, and only after its host is validated to be exactly the
# official proxy (see resolve_proxy) — a hostile repo therefore cannot redirect
# the key anywhere but our own server.
settings_env() { # $1 = key name, $2 = scope ("home" default | "all")
  local key="$1" scope="${2:-home}" f v=""
  local files=("$HOME/.claude/settings.json" "$HOME/.claude/settings.local.json")
  if [ "$scope" = "all" ] && [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
    files+=("$CLAUDE_PROJECT_DIR/.claude/settings.json" "$CLAUDE_PROJECT_DIR/.claude/settings.local.json")
  fi
  for f in "${files[@]}"; do
    [ -f "$f" ] || continue
    local got=""
    if command -v python3 >/dev/null 2>&1; then
      got=$(python3 -c 'import json,sys
try:
    v=json.load(open(sys.argv[1])).get("env",{}).get(sys.argv[2],"")
    print(v if isinstance(v,str) else "")
except Exception:
    pass' "$f" "$key" 2>/dev/null)
    elif command -v node >/dev/null 2>&1; then
      got=$(node -e 'try{const s=require(process.argv[1]);const v=(s.env||{})[process.argv[2]];if(typeof v==="string")process.stdout.write(v)}catch(e){}' "$f" "$key" 2>/dev/null)
    else
      got=$(grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$f" 2>/dev/null | head -1 | sed 's/.*:[[:space:]]*"//; s/"$//')
    fi
    [ -n "$got" ] && v="$got"
  done
  printf '%s' "$v"
}

# exact hostname out of a URL — scheme, path, query, port and userinfo removed.
# Used so the host check is a real equality test, not a substring match
# ("proxy.caching.ai.evil.com" and "evil.com/?x=proxy.caching.ai" must fail).
url_host() { # $1 = url → bare host, lowercased
  local u="${1#*://}"   # drop scheme://
  u="${u%%/*}"          # drop /path…
  u="${u%%\?*}"         # drop ?query (when there was no path)
  u="${u##*@}"          # drop any user:pass@
  u="${u%%:*}"          # drop :port
  printf '%s' "$u" | tr 'A-Z' 'a-z'
}

resolve_proxy() {
  # Self-host override: arbitrary host, but trusted-source only (env or $HOME —
  # never a project file), so a hostile repo cannot point us at its server.
  local url="${CACHING_PROXY_URL:-}"
  [ -z "$url" ] && url=$(settings_env CACHING_PROXY_URL home)
  if [ -n "$url" ]; then printf '%s' "${url%/}"; return; fi
  # Otherwise ride ANTHROPIC_BASE_URL (may be project-scoped) but ONLY when its
  # host is exactly the official proxy — the key is never sent elsewhere.
  url="${ANTHROPIC_BASE_URL:-}"
  [ -z "$url" ] && url=$(settings_env ANTHROPIC_BASE_URL all)
  if [ "$(url_host "$url")" = "$OFFICIAL_HOST" ]; then
    printf '%s' "${url%/}"
  else
    printf ''  # not routed through caching.ai — do nothing
  fi
}

resolve_key() {
  # Secrets come from the environment or $HOME settings only — a key is
  # machine-global config and must never be sourced from a project file.
  local k="${ANTHROPIC_AUTH_TOKEN:-}"
  [ -z "$k" ] && k="${ANTHROPIC_API_KEY:-}"
  [ -z "$k" ] && k=$(settings_env ANTHROPIC_AUTH_TOKEN home)
  [ -z "$k" ] && k=$(settings_env ANTHROPIC_API_KEY home)
  printf '%s' "$k"
}

resolve_hold() {
  local d="${CACHING_AUTO_HOLD:-}"
  [ -z "$d" ] && d=$(settings_env CACHING_AUTO_HOLD)
  [ -z "$d" ] && d="$DEFAULT_HOLD"
  printf '%s' "$d"
}

send_hold() { # $1 = proxy, $2 = key, $3 = duration text → prints raw JSON reply
  local proxy="$1" key="$2" dur="$3"
  # the duration text is embedded verbatim so the proxy answers in the same
  # language the user asked in (e.g. "2시간" → Korean reply)
  local text="cai:hold $dur"
  local esc
  esc=$(printf '%s' "$text" | sed 's/\\/\\\\/g; s/"/\\"/g')
  curl -sS --max-time 8 "$proxy/v1/messages" \
    -H "content-type: application/json" \
    -H "x-api-key: $key" \
    -H "anthropic-version: 2023-06-01" \
    -d "{\"model\":\"claude-sonnet-4-5\",\"max_tokens\":8,\"messages\":[{\"role\":\"user\",\"content\":\"$esc\"}]}" 2>&1
}

reply_text() { # stdin = anthropic JSON reply → prints its text (raw on failure)
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys
raw = sys.stdin.read()
try:
    d = json.loads(raw)
    t = "".join(b.get("text", "") for b in d.get("content", []) if b.get("type") == "text")
    print(t if t else raw)
except Exception:
    print(raw)'
  else
    cat
  fi
}

fmt_epoch() { # $1 = epoch secs → local time string (BSD or GNU date)
  date -r "$1" '+%Y-%m-%d %H:%M:%S %Z' 2>/dev/null \
    || date -d "@$1" '+%Y-%m-%d %H:%M:%S %Z' 2>/dev/null \
    || echo "$1"
}

case "$MODE" in
  auto)
    PROXY=$(resolve_proxy); [ -z "$PROXY" ] && exit 0
    KEY=$(resolve_key);     [ -z "$KEY" ] && exit 0
    DUR=$(resolve_hold)
    case "$DUR" in off|OFF|0|none) exit 0 ;; esac
    mkdir -p "$STATE_DIR" 2>/dev/null || exit 0
    NOW=$(date +%s)
    LAST=$(cat "$STATE_DIR/last-hold" 2>/dev/null || echo 0)
    case "$LAST" in ''|*[!0-9]*) LAST=0 ;; esac
    [ $((NOW - LAST)) -lt $THROTTLE_SECS ] && exit 0
    echo "$NOW" > "$STATE_DIR/last-hold"
    send_hold "$PROXY" "$KEY" "$DUR" > "$STATE_DIR/last-reply.json" 2>&1
    exit 0
    ;;
  --hold)
    PROXY=$(resolve_proxy)
    if [ -z "$PROXY" ]; then
      echo "not-connected: this session is not routed through the caching.ai proxy (ANTHROPIC_BASE_URL). Run /cache:setup first."
      exit 0
    fi
    KEY=$(resolve_key)
    if [ -z "$KEY" ]; then
      echo "no-key: no caching.ai key found (ANTHROPIC_AUTH_TOKEN). Run /cache:setup first."
      exit 0
    fi
    DUR="${ARG:-$DEFAULT_HOLD}"
    mkdir -p "$STATE_DIR" 2>/dev/null
    OUT=$(send_hold "$PROXY" "$KEY" "$DUR")
    printf '%s' "$OUT" > "$STATE_DIR/last-reply.json" 2>/dev/null
    date +%s > "$STATE_DIR/last-hold" 2>/dev/null
    printf '%s\n' "$OUT" | reply_text
    ;;
  --status)
    PROXY=$(resolve_proxy)
    KEY=$(resolve_key)
    DUR=$(resolve_hold)
    LAST=$(cat "$STATE_DIR/last-hold" 2>/dev/null || echo "")
    if [ -n "$PROXY" ]; then
      echo "proxy: $PROXY"
    else
      echo "proxy: not connected — ANTHROPIC_BASE_URL does not point at caching.ai (run /cache:setup)"
    fi
    if [ -n "$KEY" ]; then
      echo "key: ${KEY:0:11}…${KEY: -4}"
    else
      echo "key: none found"
    fi
    echo "auto-hold: $DUR (Stop/SessionEnd hooks renew the hold, at most once per ${THROTTLE_SECS}s)"
    if [ -n "$LAST" ]; then
      echo "last hold sent: $(fmt_epoch "$LAST")"
      [ -f "$STATE_DIR/last-reply.json" ] && echo "last reply: $(reply_text < "$STATE_DIR/last-reply.json")"
    else
      echo "last hold sent: never"
    fi
    ;;
  *)
    echo "usage: cache-keeper.sh [auto | --hold <duration> | --status]"
    ;;
esac
exit 0
