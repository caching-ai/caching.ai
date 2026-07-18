import type pg from "pg";
import { encrypt, sha256Hex, type Usage } from "@caching/shared";
import type { BlockHash } from "./logic/prefixHash.js";
import { recordRequestMetric } from "./metrics.js";

export interface ApiKeyRow {
  id: number;
  user_id: number;
  billing_locked: boolean;
  anthropic_key_encrypted: string | null;
  openai_key_encrypted: string | null;
  gemini_key_encrypted: string | null;
  grok_key_encrypted: string | null;
  auto_cache_control: boolean;
  keepalive_enabled: boolean;
  keepalive_budget_usd_daily: string;
  anthropic_cache_ttl: "5m" | "1h";
  openai_cache_retention: "default" | "24h";
}

// Provider keys resolve per-key override first, then the account default
// (user_provider_keys) — users register a provider key once and every ck_ key
// they mint uses it, unless a key pins its own.
const PROVIDER_KEY_FALLBACK = `
  COALESCE(k.anthropic_key_encrypted, ua.key_encrypted) AS anthropic_key_encrypted,
  COALESCE(k.openai_key_encrypted,   uo.key_encrypted) AS openai_key_encrypted,
  COALESCE(k.gemini_key_encrypted,   ug.key_encrypted) AS gemini_key_encrypted,
  COALESCE(k.grok_key_encrypted,     ux.key_encrypted) AS grok_key_encrypted`;

const PROVIDER_KEY_JOINS = `
  LEFT JOIN user_provider_keys ua ON ua.user_id = k.user_id AND ua.provider = 'anthropic'
  LEFT JOIN user_provider_keys uo ON uo.user_id = k.user_id AND uo.provider = 'openai'
  LEFT JOIN user_provider_keys ug ON ug.user_id = k.user_id AND ug.provider = 'gemini'
  LEFT JOIN user_provider_keys ux ON ux.user_id = k.user_id AND ux.provider = 'grok'`;

// Hot-path key cache: one DB read per key per TTL instead of per request, and
// the proxy keeps serving traffic through short DB blips (stale-on-error).
// Trade-off: setting changes / revokes take up to KEY_CACHE_TTL_MS to apply.
const KEY_CACHE = new Map<string, { row: ApiKeyRow; exp: number }>();
// read per call, not at module load — tests (and cautious self-hosters) set
// KEY_CACHE_TTL_MS after this module is already imported
const keyCacheTtlMs = () => Number(process.env.KEY_CACHE_TTL_MS ?? 30_000);
const KEY_CACHE_MAX = 10_000;

export function clearApiKeyCache() {
  KEY_CACHE.clear();
}

export async function findApiKey(pool: pg.Pool, rawKey: string): Promise<ApiKeyRow | null> {
  const hash = sha256Hex(rawKey);
  const hit = KEY_CACHE.get(hash);
  const nowMs = Date.now();
  if (hit && hit.exp > nowMs) return hit.row;
  try {
    const { rows } = await pool.query(
      `SELECT k.id, k.user_id, u.billing_locked, ${PROVIDER_KEY_FALLBACK},
              k.auto_cache_control, k.keepalive_enabled, k.keepalive_budget_usd_daily,
              k.anthropic_cache_ttl, k.openai_cache_retention
         FROM api_keys k
         JOIN users u ON u.id = k.user_id
         ${PROVIDER_KEY_JOINS}
        WHERE k.key_hash=$1 AND k.revoked_at IS NULL`,
      [hash]
    );
    const row: ApiKeyRow | null = rows[0] ?? null;
    if (row && keyCacheTtlMs() > 0) {
      KEY_CACHE.delete(hash);
      if (KEY_CACHE.size >= KEY_CACHE_MAX) {
        const oldest = KEY_CACHE.keys().next().value;
        if (oldest !== undefined) KEY_CACHE.delete(oldest);
      }
      KEY_CACHE.set(hash, { row, exp: nowMs + keyCacheTtlMs() });
    } else {
      KEY_CACHE.delete(hash); // never cache misses: new keys work immediately
    }
    return row;
  } catch (e) {
    if (hit) return hit.row; // DB blip: serve stale so customer traffic survives
    throw e;
  }
}

export { PROVIDER_KEY_FALLBACK, PROVIDER_KEY_JOINS };

export interface CostBreakdown {
  actualUsd: number;
  noCacheUsd: number;
  savedUsd: number;
}

export interface LogEntry {
  apiKeyId: number;
  provider: "anthropic" | "openai" | "gemini" | "grok";
  model: string;
  status: number;
  latencyMs: number;
  isStream: boolean;
  isKeepalive: boolean;
  usage: Usage;
  cost: CostBreakdown;
  prefixHashes: BlockHash[] | null;
  breakerDetected: boolean;
}

export async function insertRequestLog(pool: pg.Pool, e: LogEntry): Promise<void> {
  recordRequestMetric(e); // before the write: /metrics sees traffic even through DB blips
  await pool.query(
    `INSERT INTO request_logs
       (api_key_id, provider, model, status, latency_ms, is_stream, is_keepalive,
        input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
        cost_usd, no_cache_cost_usd, saved_usd, prefix_block_hashes, cache_breaker_detected)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      e.apiKeyId, e.provider, e.model, e.status, e.latencyMs, e.isStream, e.isKeepalive,
      e.usage.input_tokens, e.usage.output_tokens,
      e.usage.cache_creation_input_tokens, e.usage.cache_read_input_tokens,
      e.cost.actualUsd, e.cost.noCacheUsd, e.cost.savedUsd,
      e.prefixHashes ? JSON.stringify(e.prefixHashes) : null,
      e.breakerDetected,
    ]
  );
}

export async function lastPrefixHashes(
  pool: pg.Pool,
  apiKeyId: number,
  provider: string,
  model: string
): Promise<BlockHash[] | null> {
  const { rows } = await pool.query(
    `SELECT prefix_block_hashes FROM request_logs
      WHERE api_key_id=$1 AND provider=$2 AND model=$3 AND is_keepalive=false
        AND prefix_block_hashes IS NOT NULL
      ORDER BY ts DESC, id DESC LIMIT 1`,
    [apiKeyId, provider, model]
  );
  return rows[0]?.prefix_block_hashes ?? null;
}

/** upsert keep-alive state after a real customer request (opt-in keys only) */
export async function saveKeepaliveState(
  pool: pg.Pool,
  apiKeyId: number,
  provider: string,
  prefix: object,
  prefixTokenEstimate: number,
  encryptionKey: string
): Promise<void> {
  const enc = encrypt(JSON.stringify(prefix), encryptionKey);
  // model is stored in the clear so the sweep can pick the right ping cadence
  // (e.g. GPT-5.6+ 30m windows) without decrypting every prefix
  const model = typeof (prefix as any)?.model === "string" ? (prefix as any).model : "";
  await pool.query(
    `INSERT INTO keepalive_state (api_key_id, provider, encrypted_prefix, model, prefix_token_estimate, last_request_at)
     VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (api_key_id, provider) DO UPDATE
       SET encrypted_prefix=$3, model=$4, prefix_token_estimate=$5, last_request_at=now()`,
    [apiKeyId, provider, enc, model, prefixTokenEstimate]
  );
}

