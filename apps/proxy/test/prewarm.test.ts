import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { serve, type ServerType } from "@hono/node-server";
import { migrate, setPool, sha256Hex, encrypt, generateApiKey } from "@caching/shared";
import { buildApp } from "../src/app.js";
import { startMock } from "./mock-anthropic.js";

// Cache commands pre-warm: a chat message asking the proxy to keep the cache
// warm is answered by the proxy AND makes the cache real right away — the
// conversation the command arrived on is captured, written upstream once, and
// held. End to end against a mock Anthropic, one key per scenario (the
// pre-warm cooldown is per slot).

process.env.KEY_CACHE_TTL_MS = "0";

const DB_URL = process.env.TEST_DATABASE_URL_PREWARM ?? "postgres://localhost:5432/caching_ai_test9";
const ENC_KEY = "a".repeat(64);
const here = dirname(fileURLToPath(import.meta.url));
const BIG = "y".repeat(20_000);

let pool: pg.Pool;
let mock: Awaited<ReturnType<typeof startMock>>;
let proxyServer: ServerType;
let proxyUrl: string;
let userId: number;

const settle = () => new Promise((r) => setTimeout(r, 300));

async function mkKey(opts: { keepalive?: boolean; withProviderKey?: boolean; budget?: number } = {}) {
  const ck = generateApiKey();
  const { rows } = await pool.query(
    `INSERT INTO api_keys(user_id, key_hash, key_prefix_display, anthropic_key_encrypted,
                          keepalive_enabled, keepalive_budget_usd_daily)
     VALUES($1,$2,'k…',$3,$4,$5) RETURNING id`,
    [
      userId, sha256Hex(ck),
      opts.withProviderKey === false ? null : encrypt("sk-ant-real-key", ENC_KEY),
      opts.keepalive ?? true,
      opts.budget ?? 1,
    ]
  );
  return { ck, id: rows[0].id as number };
}

function say(ck: string, text: string, body?: any) {
  return fetch(`${proxyUrl}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ck },
    body: JSON.stringify(
      body ?? {
        model: "claude-sonnet-4-5",
        max_tokens: 64,
        system: BIG,
        tools: [{ name: "t1", input_schema: { type: "object" } }],
        messages: [
          { role: "user", content: "let's work on the parser" },
          { role: "assistant", content: "sure" },
          { role: "user", content: text },
        ],
      }
    ),
  });
}

const replyText = async (res: Response) => (await res.json()).content?.[0]?.text ?? "";

before(async () => {
  pool = new pg.Pool({ connectionString: DB_URL });
  setPool(pool);
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(join(here, "../../../packages/shared/migrations"), DB_URL);
  const u = await pool.query(
    "INSERT INTO users(email, password_hash) VALUES('prewarm@t.co','x') RETURNING id");
  userId = u.rows[0].id;

  mock = await startMock(45981);
  const app = buildApp({ pool, upstreamUrl: mock.url, encryptionKey: ENC_KEY });
  await new Promise<void>((resolve) => {
    proxyServer = serve({ fetch: app.fetch, port: 45982 }, () => resolve());
  });
  proxyUrl = "http://127.0.0.1:45982";
});

after(async () => {
  proxyServer?.close();
  mock?.server?.close();
  await pool?.end();
});

test("Korean command on a cold key: the proxy pre-warms this very conversation", async () => {
  const { ck, id } = await mkKey();
  const before = mock.state.bodies.length;
  const res = await say(ck, "캐시 45분만 지켜줘");
  assert.equal(res.status, 200);

  // one upstream call, and it is a warming write — not the user's request
  assert.equal(mock.state.bodies.length, before + 1, "exactly one pre-warm write");
  const ping = mock.state.bodies.at(-1)!;
  assert.equal(ping.max_tokens, 1);
  assert.equal(ping.system[0].text, BIG, "the captured prefix is this request's system prompt");
  assert.deepEqual(ping.system[0].cache_control, { type: "ephemeral" }, "breakpoint injected for the write");
  assert.deepEqual(ping.tools.at(-1).cache_control, { type: "ephemeral" });
  assert.equal(
    JSON.stringify(ping.messages).includes("캐시 45분만 지켜줘"), false,
    "the command message is not part of the prefix being warmed"
  );

  // the reply quotes the tokens the provider actually reports cached
  const text = await replyText(res);
  assert.match(text, /예열/, `korean reply expected, got: ${text.slice(0, 120)}`);
  assert.match(text, /6,144/, "cache_creation + cache_read from the ping, not a guess");
  assert.match(text, /45분/);

  // state saved with the hold, and the write is metered as a warming ping
  const { rows } = await pool.query(
    `SELECT hold_until, pings_today, spend_today_usd, last_1h_write_at, prefix_token_estimate
       FROM keepalive_state WHERE api_key_id=$1`, [id]);
  assert.equal(rows.length, 1);
  assert.ok(new Date(rows[0].hold_until).getTime() > Date.now() + 40 * 60_000);
  assert.equal(Number(rows[0].pings_today), 1);
  assert.ok(Number(rows[0].spend_today_usd) > 0, "pre-warm spend counts against the daily budget");
  assert.equal(rows[0].last_1h_write_at, null, "short hold stays on the 5m TTL");
  await settle();
  const { rows: logs } = await pool.query(
    "SELECT is_keepalive, cache_creation_tokens FROM request_logs WHERE api_key_id=$1", [id]);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].is_keepalive, true, "the pre-warm write shows up as a warming ping");

  // repeating the command inside the cooldown must not pay for a second write
  const again = await say(ck, "캐시 45분만 지켜줘");
  assert.equal(mock.state.bodies.length, before + 1, "cooldown: no second write");
  assert.match(await replyText(again), /🔥/);
});

test("a long hold is pre-warmed as one 1h write instead of a ping stream", async () => {
  const { ck, id } = await mkKey();
  await say(ck, "keep my cache warm for 4 hours");
  const ping = mock.state.bodies.at(-1)!;
  assert.deepEqual(ping.system[0].cache_control, { type: "ephemeral", ttl: "1h" });
  const { rows } = await pool.query(
    "SELECT last_1h_write_at FROM keepalive_state WHERE api_key_id=$1", [id]);
  assert.ok(rows[0].last_1h_write_at, "a real 1h write is stamped so the sweep uses the 55m cadence");
});

test("replies come back in the language asked, on every wire", async () => {
  const fr = await mkKey();
  assert.match(await replyText(await say(fr.ck, "garde mon cache chaud pendant 2 heures")), /préchauffé|chaud/);

  const de = await mkKey();
  assert.match(await replyText(await say(de.ck, "halte meinen Cache zwei Stunden warm")), /Cache|vorgewärmt/);

  // OpenAI wire: the command is answered on the chat/completions path too
  const oai = await mkKey();
  const res = await fetch(`${proxyUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${oai.ck}` },
    body: JSON.stringify({
      model: "gpt-5.6",
      messages: [{ role: "user", content: "mantén mi caché caliente 2 horas" }],
    }),
  });
  const j = await res.json();
  assert.equal(j.object, "chat.completion");
  assert.match(j.choices[0].message.content, /cach[eé]/i);
});

test("nothing cacheable in the conversation → says so, spends nothing", async () => {
  const { ck, id } = await mkKey();
  const before = mock.state.bodies.length;
  const res = await say(ck, "캐시 지켜줘", {
    model: "claude-sonnet-4-5",
    max_tokens: 64,
    messages: [{ role: "user", content: "캐시 지켜줘" }],
  });
  assert.equal(mock.state.bodies.length, before, "no upstream call for an uncacheable conversation");
  assert.match(await replyText(res), /캐시로 만들 만한 분량이 없어요/);
  const { rows } = await pool.query("SELECT 1 FROM keepalive_state WHERE api_key_id=$1", [id]);
  assert.equal(rows.length, 0);
});

test("provider caches nothing → the reply says so and warming is not left running", async () => {
  const { ck, id } = await mkKey();
  const saved = mock.state.usage;
  mock.state.usage = {
    input_tokens: 900, output_tokens: 1,
    cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
  };
  const res = await say(ck, "캐시 2시간 지켜줘");
  mock.state.usage = saved;

  assert.match(await replyText(res), /캐시로 만들 만한 분량이 없어요/);
  const { rows } = await pool.query(
    "SELECT header_keepalive, hold_until FROM keepalive_state WHERE api_key_id=$1", [id]);
  assert.equal(rows[0].header_keepalive, false, "an uncacheable prefix must not keep pinging");
  assert.equal(rows[0].hold_until, null);
  const { rows: k } = await pool.query("SELECT keepalive_hold_until FROM api_keys WHERE id=$1", [id]);
  assert.equal(k[0].keepalive_hold_until, null, "the console badge must not claim a hold");
});

test("daily budget spent → held, but no pre-warm write", async () => {
  const { ck, id } = await mkKey();
  await say(ck, "cai:warm 30m"); // first command creates the slot row
  const before = mock.state.bodies.length;
  await pool.query(
    "UPDATE keepalive_state SET spend_today_usd=999, spend_day=CURRENT_DATE, last_ping_at=NULL WHERE api_key_id=$1",
    [id]
  );
  const res = await say(ck, "cai:warm 30m");
  assert.equal(mock.state.bodies.length, before, "budget guard blocks the pre-warm write");
  assert.match(await replyText(res), /예산|budget/i);
});

test("no provider key → the reply explains it instead of promising warmth", async () => {
  const { ck } = await mkKey({ withProviderKey: false });
  const before = mock.state.bodies.length;
  const res = await say(ck, "cai:warm 1h");
  assert.equal(mock.state.bodies.length, before);
  assert.match(await replyText(res), /provider key|console/i);
});

test("cache warmer off on the key → command declined, nothing spent", async () => {
  const { ck } = await mkKey({ keepalive: false });
  const before = mock.state.bodies.length;
  const res = await say(ck, "캐시 2시간 지켜줘");
  assert.equal(mock.state.bodies.length, before);
  assert.match(await replyText(res), /캐시 워머가 꺼져 있어서/);
});

test("a real request about caching is never intercepted", async () => {
  const { ck } = await mkKey();
  const before = mock.state.bodies.length;
  const res = await say(ck, "explain how our cache warming logic keeps the prefix alive");
  assert.equal(mock.state.bodies.length, before + 1);
  const fwd = mock.state.bodies.at(-1)!;
  assert.ok(fwd.max_tokens > 1, "forwarded as the user's own request");
  assert.match(JSON.stringify(fwd.messages), /explain how our cache warming/);
  assert.equal((await res.json()).content[0].text, "Hello from mock");
});
