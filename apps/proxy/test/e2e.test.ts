import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { serve, type ServerType } from "@hono/node-server";
import { migrate, setPool, sha256Hex, encrypt, generateApiKey } from "@caching/shared";
import { buildApp } from "../src/app.js";
import { keepaliveSweep, PING_AFTER_MS, GIVE_UP_AFTER_MS } from "../src/keepalive.js";
import { startMock, type MockState } from "./mock-anthropic.js";

// tests flip key flags via direct SQL — the hot-path key cache must not mask that
process.env.KEY_CACHE_TTL_MS = "0";

const DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/caching_ai_test";
const ENC_KEY = "a".repeat(64);
const here = dirname(fileURLToPath(import.meta.url));

let pool: pg.Pool;
let mock: { server: ServerType; state: MockState; url: string };
let proxyServer: ServerType;
let proxyUrl: string;
let ckKey: string;
let keyId: number;

const BIG = "y".repeat(20_000);

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 3000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
}

before(async () => {
  pool = new pg.Pool({ connectionString: DB_URL });
  setPool(pool);
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(join(here, "../../../packages/shared/migrations"), DB_URL);

  const u = await pool.query(
    "INSERT INTO users(email, password_hash) VALUES('t@t.co','x') RETURNING id"
  );
  ckKey = generateApiKey();
  const k = await pool.query(
    `INSERT INTO api_keys(user_id, key_hash, key_prefix_display, anthropic_key_encrypted)
     VALUES($1,$2,$3,$4) RETURNING id`,
    [u.rows[0].id, sha256Hex(ckKey), ckKey.slice(0, 8) + "...", encrypt("sk-ant-real-key", ENC_KEY)]
  );
  keyId = k.rows[0].id;

  mock = await startMock(45871);
  const app = buildApp({ pool, upstreamUrl: mock.url, encryptionKey: ENC_KEY });
  await new Promise<void>((resolve) => {
    proxyServer = serve({ fetch: app.fetch, port: 45872 }, () => resolve());
  });
  proxyUrl = "http://127.0.0.1:45872";
});

after(async () => {
  proxyServer?.close();
  mock?.server.close();
  await pool?.end();
});

function call(body: any, key = ckKey) {
  return fetch(`${proxyUrl}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
}

test("① key auth: bad key rejected, real Anthropic key substituted upstream", async () => {
  const bad = await call({ model: "m", messages: [] }, "ck_nope");
  assert.equal(bad.status, 401);
  const j = await bad.json();
  assert.match(j.error.message, /invalid or has been revoked/);

  const ok = await call({ model: "claude-sonnet-4-5", max_tokens: 8, messages: [{ role: "user", content: "hi" }] });
  assert.equal(ok.status, 200);
  assert.equal(mock.state.keys.at(-1), "sk-ant-real-key", "upstream must receive the customer's Anthropic key");
});

test("② usage recorded with cost math", async () => {
  const countBefore = Number((await pool.query("SELECT count(*) c FROM request_logs")).rows[0].c);
  const res = await call({ model: "claude-sonnet-4-5", max_tokens: 8, messages: [{ role: "user", content: "hi" }] });
  assert.equal(res.status, 200);
  const row = await waitFor(async () => {
    const { rows } = await pool.query(
      "SELECT * FROM request_logs WHERE is_keepalive=false ORDER BY id DESC LIMIT 1"
    );
    const c = Number((await pool.query("SELECT count(*) c FROM request_logs")).rows[0].c);
    return c > countBefore ? rows[0] : null;
  });
  assert.equal(Number(row.input_tokens), 10);
  assert.equal(Number(row.output_tokens), 25);
  assert.equal(Number(row.cache_read_tokens), 4096);
  assert.equal(Number(row.cache_creation_tokens), 2048);
  assert.ok(Number(row.saved_usd) > 0, "cache reads must register savings");
  assert.equal(row.model, "claude-sonnet-4-5");
});

test("③ cache_control injected into system+tools when absent (verified at upstream)", async () => {
  await call({
    model: "claude-sonnet-4-5",
    max_tokens: 8,
    system: BIG,
    tools: [{ name: "t1", input_schema: { type: "object" } }],
    messages: [{ role: "user", content: "hi" }],
  });
  const received = mock.state.bodies.at(-1);
  assert.deepEqual(received.tools[0].cache_control, { type: "ephemeral" });
  assert.equal(Array.isArray(received.system), true);
  assert.deepEqual(received.system[0].cache_control, { type: "ephemeral" });
});

test("④ existing cache_control passes through untouched", async () => {
  const system = [{ type: "text", text: BIG, cache_control: { type: "ephemeral", ttl: "1h" } }];
  await call({ model: "claude-sonnet-4-5", max_tokens: 8, system, messages: [{ role: "user", content: "hi" }] });
  const received = mock.state.bodies.at(-1);
  assert.deepEqual(received.system, system);
});

test("⑤ SSE streams through without buffering and usage still logged", async () => {
  mock.state.sseChunkDelayMs = 60;
  const countBefore = Number((await pool.query("SELECT count(*) c FROM request_logs")).rows[0].c);
  const res = await call({ model: "claude-sonnet-4-5", max_tokens: 8, stream: true, messages: [{ role: "user", content: "hi" }] });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);

  const reader = res.body!.getReader();
  const arrivals: number[] = [];
  const t0 = Date.now();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
    arrivals.push(Date.now() - t0);
  }
  mock.state.sseChunkDelayMs = 0;
  assert.ok(arrivals.length >= 3, `expected multiple chunks, got ${arrivals.length}`);
  assert.ok(
    arrivals[0] < arrivals[arrivals.length - 1] - 100,
    `first chunk must arrive well before the last (got ${JSON.stringify(arrivals)})`
  );

  const row = await waitFor(async () => {
    const { rows } = await pool.query("SELECT * FROM request_logs ORDER BY id DESC LIMIT 1");
    const c = Number((await pool.query("SELECT count(*) c FROM request_logs")).rows[0].c);
    return c > countBefore && rows[0]?.is_stream ? rows[0] : null;
  });
  assert.equal(Number(row.output_tokens), 25, "usage tapped from message_delta");
  assert.equal(Number(row.cache_read_tokens), 4096, "usage tapped from message_start");
});

test("⑥ upstream 401 is humanized", async () => {
  mock.state.forceStatus = 401;
  const res = await call({ model: "claude-sonnet-4-5", max_tokens: 8, messages: [{ role: "user", content: "hi" }] });
  mock.state.forceStatus = 0;
  assert.equal(res.status, 401);
  const j = await res.json();
  assert.match(j.error.message, /console/);
  assert.doesNotMatch(JSON.stringify(j), /stack|postgres|sql|internal/i);
});

test("⑦ cache breaker detected when system changes between requests", async () => {
  await call({ model: "claude-opus-4-8", max_tokens: 8, system: "now: 12:00:01", messages: [{ role: "user", content: "q" }] });
  await new Promise((r) => setTimeout(r, 300));
  await call({ model: "claude-opus-4-8", max_tokens: 8, system: "now: 12:00:02", messages: [{ role: "user", content: "q" }] });
  const row = await waitFor(async () => {
    const { rows } = await pool.query(
      "SELECT cache_breaker_detected FROM request_logs WHERE model='claude-opus-4-8' ORDER BY id DESC LIMIT 1"
    );
    return rows[0]?.cache_breaker_detected ? rows[0] : null;
  });
  assert.equal(row.cache_breaker_detected, true);
});

test("⑧ keep-alive: pings after 4min, respects budget, gives up after 62.5min", async () => {
  await pool.query("UPDATE api_keys SET keepalive_enabled=true WHERE id=$1", [keyId]);
  await call({
    model: "claude-sonnet-4-5",
    max_tokens: 8,
    system: BIG,
    messages: [{ role: "user", content: "real traffic" }],
  });
  await waitFor(async () => {
    const { rows } = await pool.query("SELECT 1 FROM keepalive_state WHERE api_key_id=$1 AND encrypted_prefix IS NOT NULL", [keyId]);
    return rows[0];
  });

  // keep the whole simulated window (base … base+62.5min) inside one UTC day —
  // the daily budget legitimately resets at UTC midnight, which made this test
  // flake when run within ~65 minutes of it
  let base = Date.now();
  if (86_400_000 - (base % 86_400_000) < 70 * 60_000) {
    base -= 70 * 60_000;
    await pool.query(
      "UPDATE keepalive_state SET last_request_at=to_timestamp($2/1000.0) WHERE api_key_id=$1",
      [keyId, base]
    );
  }
  const deps = { pool, upstreamUrl: mock.url, encryptionKey: ENC_KEY };

  // t+1min: too early
  assert.equal(await keepaliveSweep({ ...deps, now: () => base + 60_000 }), 0);

  // t+5min: ping fires with max_tokens=1 and the saved prefix
  const nBodies = mock.state.bodies.length;
  assert.equal(await keepaliveSweep({ ...deps, now: () => base + PING_AFTER_MS + 60_000 }), 1);
  const ping = mock.state.bodies.at(-1);
  assert.equal(mock.state.bodies.length, nBodies + 1);
  assert.equal(ping.max_tokens, 1);
  assert.equal(Array.isArray(ping.system) ? ping.system[0].text : ping.system, BIG);

  // immediately again: cache still warm, no second ping
  assert.equal(await keepaliveSweep({ ...deps, now: () => base + PING_AFTER_MS + 61_000 }), 0);

  // ping cost was recorded
  const kaLog = await waitFor(async () => {
    const { rows } = await pool.query("SELECT * FROM request_logs WHERE is_keepalive=true ORDER BY id DESC LIMIT 1");
    return rows[0];
  });
  assert.equal(kaLog.is_keepalive, true);

  // budget exhausted → hard stop
  await pool.query("UPDATE keepalive_state SET spend_today_usd=999 WHERE api_key_id=$1", [keyId]);
  assert.equal(await keepaliveSweep({ ...deps, now: () => base + 2 * PING_AFTER_MS + 120_000 }), 0);
  await pool.query("UPDATE keepalive_state SET spend_today_usd=0 WHERE api_key_id=$1", [keyId]);

  // past 62.5 minutes → give up
  assert.equal(await keepaliveSweep({ ...deps, now: () => base + GIVE_UP_AFTER_MS + 1000 }), 0);

  await pool.query("UPDATE api_keys SET keepalive_enabled=false WHERE id=$1", [keyId]);
});

test("⑨ non-messages /v1 path passes through transparently", async () => {
  const res = await fetch(`${proxyUrl}/v1/models`, { headers: { "x-api-key": ckKey } });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.data[0].id, "claude-opus-4-8");
});
