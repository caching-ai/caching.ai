import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { migrate, sha256Hex, generateApiKey } from "@caching/shared";
import { rollupSweep } from "../src/rollup.js";

const DB_URL = process.env.TEST_DATABASE_URL_ROLLUP ?? "postgres://localhost:5432/caching_ai_test5";
const here = dirname(fileURLToPath(import.meta.url));

let pool: pg.Pool;
let keyId: number;

async function ensureDb() {
  const admin = new pg.Pool({ connectionString: DB_URL.replace(/\/[^/]+$/, "/postgres") });
  await admin.query(`CREATE DATABASE ${DB_URL.split("/").pop()!}`).catch(() => {}); // 42P04 = exists
  await admin.end();
}

function insertLog(daysAgo: number, over: Partial<Record<string, any>> = {}) {
  const cols = {
    provider: "anthropic", model: "claude-sonnet-4-5", status: 200, latency_ms: 100,
    is_keepalive: false, input_tokens: 10, output_tokens: 5,
    cache_creation_tokens: 0, cache_read_tokens: 50,
    cost_usd: 0.01, no_cache_cost_usd: 0.03, saved_usd: 0.02,
    cache_breaker_detected: false, ...over,
  };
  return pool.query(
    `INSERT INTO request_logs (api_key_id, ts, provider, model, status, latency_ms, is_keepalive,
       input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
       cost_usd, no_cache_cost_usd, saved_usd, cache_breaker_detected)
     VALUES ($1, now() - make_interval(days => $2), $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [keyId, daysAgo, cols.provider, cols.model, cols.status, cols.latency_ms, cols.is_keepalive,
     cols.input_tokens, cols.output_tokens, cols.cache_creation_tokens, cols.cache_read_tokens,
     cols.cost_usd, cols.no_cache_cost_usd, cols.saved_usd, cols.cache_breaker_detected]
  );
}

before(async () => {
  await ensureDb();
  pool = new pg.Pool({ connectionString: DB_URL });
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(join(here, "../../../packages/shared/migrations"), DB_URL);
  const u = await pool.query("INSERT INTO users(email, password_hash) VALUES('roll@t.dev','x') RETURNING id");
  const k = await pool.query(
    "INSERT INTO api_keys(user_id, key_hash, key_prefix_display) VALUES($1,$2,'ck_…') RETURNING id",
    [u.rows[0].id, sha256Hex(generateApiKey())]
  );
  keyId = k.rows[0].id;
});

after(async () => {
  await pool?.end();
});

test("rollup: complete days aggregate, old raw rows prune, today survives", async () => {
  // 200 days ago: 2 requests + 1 keepalive ping + 1 error (past retention)
  await insertLog(200);
  await insertLog(200, { cache_read_tokens: 0, saved_usd: 0, cache_breaker_detected: true });
  await insertLog(200, { is_keepalive: true, cost_usd: 0.001, input_tokens: 1, output_tokens: 1, cache_read_tokens: 0 });
  await insertLog(200, { status: 500, latency_ms: 5000 });
  // yesterday: inside retention — rolled up but raw kept
  await insertLog(1);
  // today: incomplete day — untouched
  await insertLog(0);

  const r = await rollupSweep(pool, 100);
  assert.equal(r.rowsRolled, 2, "one daily row per (old day, yesterday)");
  assert.equal(r.rowsPruned, 4, "only the 200-day-old raw rows are pruned");

  const { rows: daily } = await pool.query(
    "SELECT * FROM request_logs_daily WHERE api_key_id=$1 ORDER BY day", [keyId]);
  assert.equal(daily.length, 2);
  const old = daily[0];
  assert.equal(old.requests, 3, "non-keepalive requests");
  assert.equal(old.errors, 1);
  assert.equal(old.keepalive_pings, 1);
  assert.equal(Number(old.uncached_input_tokens), 10, "only the no-cache-read request's input");
  assert.equal(old.breakers, 1);
  assert.equal(Number(old.cache_read_tokens), 100);
  assert.equal(Number(old.keepalive_cost_usd), 0.001);
  assert.equal(old.latency_samples, 2, "successful non-keepalive only");
  assert.equal(Number(old.latency_ms_sum), 200);

  const { rows: raw } = await pool.query(
    "SELECT count(*)::int AS n FROM request_logs WHERE api_key_id=$1", [keyId]);
  assert.equal(raw[0].n, 2, "yesterday + today raw rows remain");

  // idempotent: the watermark day (yesterday) is re-rolled with identical
  // values (midnight-straggler hardening), nothing left to prune
  const again = await rollupSweep(pool, 100);
  assert.equal(again.rowsRolled, 1, "watermark day re-upserted");
  assert.equal(again.rowsPruned, 0);
  const { rows: dailyAgain } = await pool.query(
    "SELECT count(*)::int AS n, sum(requests)::int AS req FROM request_logs_daily WHERE api_key_id=$1", [keyId]);
  assert.equal(dailyAgain[0].n, 2, "no duplicate daily rows");
  assert.equal(dailyAgain[0].req, 4, "aggregates unchanged after re-roll");
});

test("rollup: retention 0 disables pruning but still aggregates", async () => {
  await pool.query("DELETE FROM request_logs_daily WHERE api_key_id=$1", [keyId]);
  await pool.query("DELETE FROM request_logs WHERE api_key_id=$1", [keyId]);
  await insertLog(150);
  const r = await rollupSweep(pool, 0);
  assert.equal(r.rowsRolled, 1);
  assert.equal(r.rowsPruned, 0);
  const { rows } = await pool.query(
    "SELECT count(*)::int AS n FROM request_logs WHERE api_key_id=$1", [keyId]);
  assert.equal(rows[0].n, 1, "raw row kept forever");
});
