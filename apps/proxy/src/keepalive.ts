import type pg from "pg";
import {
  computeCost,
  computeCostOpenAI,
  computeCostGemini,
  computeCostGrok,
  decrypt,
  openaiCacheClass,
  type Usage,
} from "@caching/shared";
import { emptyUsage, mergeUsage } from "./logic/usageTap.js";
import {
  insertRequestLog,
  PROVIDER_KEY_FALLBACK,
  PROVIDER_KEY_JOINS,
  type CostBreakdown,
} from "./store.js";

// Economics (PRD): a cache kept warm by cheap pings beats a full rewrite as
// long as the prefix is reused within ~62.5 minutes of the last real request.
// Provider cache TTLs: Anthropic 5m fixed; OpenAI/Gemini ~5-10m inactivity
// (best-effort) — the same 4-minute cadence keeps all three warm.
export const PING_AFTER_MS = 4 * 60 * 1000;
export const GIVE_UP_AFTER_MS = 62.5 * 60 * 1000;
// Anthropic 1h TTL: reads refresh the full hour, so one ping near the end of
// each window keeps it warm. Break-even mirrors the 5m math: 2.0x rewrite /
// 0.1x ping = 20 pings ≈ 20 hours of idle coverage.
export const PING_AFTER_1H_MS = 55 * 60 * 1000;
export const GIVE_UP_1H_MS = 20 * 60 * 60 * 1000;
// OpenAI GPT-5.6+ hold a ~30m server-side window (prompt_cache_options era):
// one ping per window, same ~20-window coverage as the 1h math.
export const PING_AFTER_30M_MS = 25 * 60 * 1000;
export const GIVE_UP_30M_MS = 10 * 60 * 60 * 1000;

export interface KeepaliveDeps {
  pool: pg.Pool;
  upstreamUrl: string; // Anthropic
  openaiUpstreamUrl?: string;
  geminiUpstreamUrl?: string;
  grokUpstreamUrl?: string;
  encryptionKey: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface Candidate {
  api_key_id: number;
  provider: "anthropic" | "openai" | "gemini" | "grok";
  model: string;
  encrypted_prefix: string;
  anthropic_key_encrypted: string | null;
  openai_key_encrypted: string | null;
  gemini_key_encrypted: string | null;
  grok_key_encrypted: string | null;
  keepalive_budget_usd_daily: string;
  anthropic_cache_ttl: "5m" | "1h";
  keepalive_hold_until: Date | null;
  last_request_at: Date;
  last_ping_at: Date | null;
  pings_today: number;
  spend_today_usd: string;
  spend_day: string;
}

interface PingResult {
  status: number;
  usage: Usage;
  cost: CostBreakdown;
}

async function pingAnthropic(
  deps: KeepaliveDeps, prefix: any, apiKey: string, doFetch: typeof fetch
): Promise<PingResult> {
  const body: any = {
    model: prefix.model,
    max_tokens: 1,
    messages: [...(prefix.messages ?? []), { role: "user", content: "ping" }],
  };
  if (prefix.system !== undefined) body.system = prefix.system;
  if (prefix.tools !== undefined) body.tools = prefix.tools;

  const res = await doFetch(new URL("/v1/messages", deps.upstreamUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const usage = emptyUsage();
  try {
    mergeUsage(usage, (await res.json())?.usage);
  } catch { /* ignore */ }
  return { status: res.status, usage, cost: computeCost(prefix.model, usage) };
}

async function pingOpenAI(
  deps: KeepaliveDeps, prefix: any, apiKey: string, doFetch: typeof fetch,
  baseUrl?: string, costFn: typeof computeCostOpenAI = computeCostOpenAI
): Promise<PingResult> {
  const body: any = {
    model: prefix.model,
    max_completion_tokens: 1,
    messages: [...(prefix.messages ?? []), { role: "user", content: "ping" }],
  };
  if (prefix.tools !== undefined) body.tools = prefix.tools;
  if (prefix.prompt_cache_key !== undefined) body.prompt_cache_key = prefix.prompt_cache_key;

  const res = await doFetch(
    new URL("/v1/chat/completions", baseUrl ?? deps.openaiUpstreamUrl ?? "https://api.openai.com"),
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    }
  );
  let prompt = 0, completion = 0, cached = 0;
  try {
    const u = (await res.json())?.usage;
    prompt = u?.prompt_tokens ?? 0;
    completion = u?.completion_tokens ?? 0;
    cached = u?.prompt_tokens_details?.cached_tokens ?? 0;
  } catch { /* ignore */ }
  const usage: Usage = {
    input_tokens: prompt - cached,
    output_tokens: completion,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cached,
  };
  return {
    status: res.status,
    usage,
    cost: costFn(prefix.model, {
      prompt_tokens: prompt, completion_tokens: completion, cached_tokens: cached,
    }),
  };
}

async function pingGemini(
  deps: KeepaliveDeps, prefix: any, apiKey: string, doFetch: typeof fetch
): Promise<PingResult> {
  const body: any = {
    contents: [{ role: "user", parts: [{ text: "ping" }] }],
    generationConfig: { maxOutputTokens: 1 },
  };
  if (prefix.systemInstruction !== undefined) body.systemInstruction = prefix.systemInstruction;
  if (prefix.tools !== undefined) body.tools = prefix.tools;

  const res = await doFetch(
    new URL(
      `/v1beta/models/${prefix.model}:generateContent`,
      deps.geminiUpstreamUrl ?? "https://generativelanguage.googleapis.com"
    ),
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    }
  );
  let prompt = 0, completion = 0, cached = 0;
  try {
    const m = (await res.json())?.usageMetadata;
    prompt = m?.promptTokenCount ?? 0;
    completion = m?.candidatesTokenCount ?? 0;
    cached = m?.cachedContentTokenCount ?? 0;
  } catch { /* ignore */ }
  const usage: Usage = {
    input_tokens: prompt - cached,
    output_tokens: completion,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cached,
  };
  return {
    status: res.status,
    usage,
    cost: computeCostGemini(prefix.model, {
      promptTokenCount: prompt, candidatesTokenCount: completion, cachedContentTokenCount: cached,
    }),
  };
}

const PROVIDER_KEY_COLUMN: Record<string, keyof Candidate> = {
  anthropic: "anthropic_key_encrypted",
  openai: "openai_key_encrypted",
  gemini: "gemini_key_encrypted",
  grok: "grok_key_encrypted",
};

/**
 * One sweep of the keep-alive engine across all three providers.
 * Returns the number of pings sent. Runs on an interval in the proxy
 * process; directly callable from tests with a fake clock and upstreams.
 */
export async function keepaliveSweep(deps: KeepaliveDeps): Promise<number> {
  const { pool, encryptionKey } = deps;
  const doFetch = deps.fetchImpl ?? fetch;
  const now = deps.now ? deps.now() : Date.now();

  const { rows } = await pool.query<Candidate>(
    `SELECT ks.api_key_id, ks.provider, ks.model, ks.encrypted_prefix, ks.last_request_at, ks.last_ping_at,
            ks.pings_today, ks.spend_today_usd,
            to_char(ks.spend_day, 'YYYY-MM-DD') AS spend_day,
            ${PROVIDER_KEY_FALLBACK},
            k.keepalive_budget_usd_daily, k.anthropic_cache_ttl,
            k.keepalive_hold_until
       FROM keepalive_state ks
       JOIN api_keys k ON k.id = ks.api_key_id
       ${PROVIDER_KEY_JOINS}
      WHERE k.keepalive_enabled = true
        AND k.revoked_at IS NULL
        AND ks.encrypted_prefix IS NOT NULL
        AND ks.last_request_at IS NOT NULL`
  );

  // The daily budget belongs to the KEY (that's what the console and the
  // budget-alert email promise) — sum today's spend across the key's provider
  // rows so two providers can't each burn the full budget.
  const today = new Date(now).toISOString().slice(0, 10);
  const keySpend = new Map<number, number>();
  for (const row of rows) {
    const spent = row.spend_day === today ? Number(row.spend_today_usd) : 0;
    keySpend.set(row.api_key_id, (keySpend.get(row.api_key_id) ?? 0) + spent);
  }

  let pinged = 0;
  for (const row of rows) {
    // OpenAI is fully model-aware — no user setting involved: pre-GPT-5.6
    // models keep the cache ~24h upstream (pings would only burn budget —
    // skip), GPT-5.6+ hold a ~30m window (one ping per window), non-extended
    // models (gpt-4o…) are in-memory ~5-10m (standard cadence). Rows without
    // a saved model (legacy) are skipped — never spend on unknowns. Rare ZDR
    // orgs (short retention everywhere) lose OpenAI warming; documented.
    const openaiClass =
      row.provider === "openai" ? (row.model ? openaiCacheClass(row.model) : "24h") : null;
    if (openaiClass === "24h") continue;

    // Anthropic 1h TTL needs one ping per hour, not one every 4 minutes.
    const longTtl = row.provider === "anthropic" && row.anthropic_cache_ttl === "1h";
    const pingAfter = longTtl ? PING_AFTER_1H_MS : openaiClass === "30m" ? PING_AFTER_30M_MS : PING_AFTER_MS;
    const giveUp = longTtl ? GIVE_UP_1H_MS : openaiClass === "30m" ? GIVE_UP_30M_MS : GIVE_UP_AFTER_MS;

    const lastReq = new Date(row.last_request_at).getTime();
    const sinceReq = now - lastReq;
    if (sinceReq < pingAfter) continue;
    // an active warm hold overrides the give-up window (budget still applies)
    const held = row.keepalive_hold_until && new Date(row.keepalive_hold_until).getTime() > now;
    if (sinceReq >= giveUp && !held) continue;

    const lastPing = row.last_ping_at ? new Date(row.last_ping_at).getTime() : 0;
    if (now - lastPing < pingAfter) continue; // cache still warm from last ping

    // daily budget guard: key-level, all providers combined, resets daily (UTC)
    const budget = Number(row.keepalive_budget_usd_daily);
    if ((keySpend.get(row.api_key_id) ?? 0) >= budget) continue;

    const encKey = row[PROVIDER_KEY_COLUMN[row.provider]] as string | null;
    if (!encKey) continue;

    // atomic claim: only one sweep/replica may ping this (key, provider)
    // window, and the key-level budget is re-checked against the live DB so
    // concurrent replicas can't each admit pings off a stale snapshot
    const claim = await pool.query(
      `UPDATE keepalive_state
          SET last_ping_at = to_timestamp($3 / 1000.0)
        WHERE api_key_id = $1 AND provider = $2
          AND (last_ping_at IS NULL OR last_ping_at <= to_timestamp($4 / 1000.0))
          AND (SELECT COALESCE(sum(CASE WHEN ks2.spend_day = $5::date
                                        THEN ks2.spend_today_usd ELSE 0 END), 0)
                 FROM keepalive_state ks2 WHERE ks2.api_key_id = $1) < $6`,
      [row.api_key_id, row.provider, now, now - pingAfter, today, budget]
    );
    if (!claim.rowCount) continue;

    let prefix: any;
    let providerKey: string;
    try {
      prefix = JSON.parse(decrypt(row.encrypted_prefix, encryptionKey));
      providerKey = decrypt(encKey, encryptionKey);
    } catch {
      console.error(`keepalive: decrypt failed for key ${row.api_key_id}/${row.provider}`);
      continue;
    }

    let result: PingResult;
    try {
      result =
        row.provider === "openai"
          ? await pingOpenAI(deps, prefix, providerKey, doFetch)
          : row.provider === "grok"
            ? await pingOpenAI(deps, prefix, providerKey, doFetch,
                deps.grokUpstreamUrl ?? "https://api.x.ai", computeCostGrok)
            : row.provider === "gemini"
              ? await pingGemini(deps, prefix, providerKey, doFetch)
              : await pingAnthropic(deps, prefix, providerKey, doFetch);
    } catch (e) {
      console.error(`keepalive ping failed for ${row.api_key_id}/${row.provider}:`, (e as Error).message);
      continue;
    }

    await pool.query(
      `UPDATE keepalive_state
          SET last_ping_at = to_timestamp($3 / 1000.0),
              pings_today = CASE WHEN spend_day = $4::date THEN pings_today + 1 ELSE 1 END,
              spend_today_usd = CASE WHEN spend_day = $4::date THEN spend_today_usd + $5 ELSE $5 END,
              spend_day = $4::date
        WHERE api_key_id = $1 AND provider = $2`,
      [row.api_key_id, row.provider, now, today, result.cost.actualUsd]
    );
    keySpend.set(row.api_key_id, (keySpend.get(row.api_key_id) ?? 0) + result.cost.actualUsd);
    await insertRequestLog(pool, {
      apiKeyId: row.api_key_id,
      provider: row.provider,
      model: prefix.model,
      status: result.status,
      latencyMs: 0,
      isStream: false,
      isKeepalive: true,
      usage: result.usage,
      cost: result.cost,
      prefixHashes: null,
      breakerDetected: false,
    });
    if (result.status < 400) pinged++;
  }
  return pinged;
}

export function startKeepaliveLoop(deps: KeepaliveDeps, intervalMs = 30_000): NodeJS.Timeout {
  let running = false; // a slow sweep must not overlap the next tick
  const t = setInterval(() => {
    if (running) return;
    running = true;
    keepaliveSweep(deps)
      .catch((e) => console.error("keepalive sweep error:", e.message))
      .finally(() => { running = false; });
  }, intervalMs);
  t.unref?.();
  return t;
}
