import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { serve, type ServerType } from "@hono/node-server";
import { migrate, setPool, sha256Hex, encrypt, generateApiKey } from "@caching/shared";
import { buildApp } from "../src/app.js";
import { billingSweep, FEE_RATE } from "../src/billing.js";
import { weeklyReportSweep, isoWeekKey, renderWeeklyReportHtml } from "../src/emailReport.js";
import { startMock } from "./mock-anthropic.js";
import { startMockOpenAI, startMockGemini, startMockResend } from "./mock-providers.js";

const DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/caching_ai_test2";
const ENC_KEY = "c".repeat(64);
const here = dirname(fileURLToPath(import.meta.url));

let pool: pg.Pool;
let servers: ServerType[] = [];
let proxyUrl: string;
let ck: string;
let userId: number;
let openaiState: Awaited<ReturnType<typeof startMockOpenAI>>["state"];
let anthroState: Awaited<ReturnType<typeof startMock>>["state"];
let geminiState: Awaited<ReturnType<typeof startMockGemini>>["state"];
let resend: Awaited<ReturnType<typeof startMockResend>>;

async function waitRows(sql: string, params: any[], min = 1, ms = 3000): Promise<any[]> {
  const start = Date.now();
  for (;;) {
    const { rows } = await pool.query(sql, params);
    if (rows.length >= min) return rows;
    if (Date.now() - start > ms) throw new Error("waitRows timeout: " + sql);
    await new Promise((r) => setTimeout(r, 50));
  }
}

before(async () => {
  pool = new pg.Pool({ connectionString: DB_URL });
  setPool(pool);
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(join(here, "../../../packages/shared/migrations"), DB_URL);

  const u = await pool.query("INSERT INTO users(email, password_hash) VALUES('mp@t.co','x') RETURNING id");
  userId = u.rows[0].id;
  ck = generateApiKey();
  await pool.query(
    `INSERT INTO api_keys(user_id, key_hash, key_prefix_display, anthropic_key_encrypted,
                          openai_key_encrypted, gemini_key_encrypted)
     VALUES($1,$2,'ck_…',$3,$4,$5)`,
    [userId, sha256Hex(ck), encrypt("sk-ant-x", ENC_KEY), encrypt("sk-openai-x", ENC_KEY), encrypt("gm-key-x", ENC_KEY)]
  );

  const anthropic = await startMock(45881);
  const openai = await startMockOpenAI(45882);
  const gemini = await startMockGemini(45883);
  resend = await startMockResend(45884);
  openaiState = openai.state;
  geminiState = gemini.state;
  anthroState = anthropic.state;
  servers.push(anthropic.server, openai.server, gemini.server, resend.server);

  const app = buildApp({
    pool,
    upstreamUrl: anthropic.url,
    openaiUpstreamUrl: openai.url,
    geminiUpstreamUrl: gemini.url,
    encryptionKey: ENC_KEY,
  });
  await new Promise<void>((resolve) => {
    servers.push(serve({ fetch: app.fetch, port: 45885 }, () => resolve()));
  });
  proxyUrl = "http://127.0.0.1:45885";
});

after(async () => {
  servers.forEach((s) => s.close());
  await pool?.end();
});

test("openai non-stream: Bearer substitution + cached_tokens metered as savings", async () => {
  const res = await fetch(`${proxyUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ck}` },
    body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }] }),
  });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.choices[0].message.content, "Hello from mock OpenAI");
  assert.equal(openaiState.authHeaders.at(-1), "Bearer sk-openai-x");

  const [row] = await waitRows(
    "SELECT * FROM request_logs WHERE provider='openai' AND is_stream=false ORDER BY id DESC LIMIT 1", []
  );
  assert.equal(Number(row.cache_read_tokens), 2048);
  assert.equal(Number(row.input_tokens), 3000 - 2048);
  assert.equal(Number(row.output_tokens), 40);
  // gpt-4o: 2048 cached at 50% of $2.5/MTok → saved = 2048 * 2.5e-6 * 0.5
  assert.ok(Math.abs(Number(row.saved_usd) - 2048 * 2.5e-6 * 0.5) < 1e-9);
});

test("openai stream: stream_options injected, usage tapped from final chunk", async () => {
  const res = await fetch(`${proxyUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ck}` },
    body: JSON.stringify({ model: "gpt-4o", stream: true, messages: [{ role: "user", content: "hi" }] }),
  });
  assert.equal(res.status, 200);
  await res.text(); // drain
  assert.deepEqual(openaiState.bodies.at(-1).stream_options, { include_usage: true });

  const [row] = await waitRows(
    "SELECT * FROM request_logs WHERE provider='openai' AND is_stream=true ORDER BY id DESC LIMIT 1", []
  );
  assert.equal(Number(row.cache_read_tokens), 2048);
  assert.equal(Number(row.output_tokens), 40);
});

test("openai responses API usage shape (input_tokens_details)", async () => {
  const res = await fetch(`${proxyUrl}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ck}` },
    body: JSON.stringify({ model: "gpt-5", instructions: "be nice", input: "hello" }),
  });
  assert.equal(res.status, 200);
  const [row] = await waitRows(
    "SELECT * FROM request_logs WHERE provider='openai' AND model='gpt-5' ORDER BY id DESC LIMIT 1", []
  );
  assert.equal(Number(row.cache_read_tokens), 1024);
  assert.equal(Number(row.input_tokens), 1500 - 1024);
});

test("gemini generateContent: key substitution + usageMetadata metered", async () => {
  const res = await fetch(`${proxyUrl}/v1beta/models/gemini-2.5-pro:generateContent?key=${ck}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }] }),
  });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.match(j.candidates[0].content.parts[0].text, /mock Gemini/);
  assert.equal(geminiState.keys.at(-1), "gm-key-x");

  const [row] = await waitRows("SELECT * FROM request_logs WHERE provider='gemini' ORDER BY id DESC LIMIT 1", []);
  assert.equal(row.model, "gemini-2.5-pro");
  assert.equal(Number(row.cache_read_tokens), 4000);
  // gemini-2.5-pro: 4000 cached at 25% of $1.25/MTok → saved = 4000 * 1.25e-6 * 0.75
  assert.ok(Math.abs(Number(row.saved_usd) - 4000 * 1.25e-6 * 0.75) < 1e-9);
});

test("gemini upstream 403 humanized", async () => {
  geminiState.forceStatus = 403;
  const res = await fetch(`${proxyUrl}/v1beta/models/gemini-2.5-pro:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": ck },
    body: JSON.stringify({ contents: [] }),
  });
  geminiState.forceStatus = 0;
  assert.equal(res.status, 401);
  const j = await res.json();
  assert.match(j.error.message, /Gemini API key.*console/s);
});

test("billing sweep: fee = 20% of net savings, idempotent upsert", async () => {
  await new Promise((r) => setTimeout(r, 300)); // let fire-and-forget logs land
  const n1 = await billingSweep(pool);
  assert.ok(n1 >= 1);
  const { rows } = await pool.query("SELECT * FROM billing_periods WHERE user_id=$1", [userId]);
  assert.equal(rows.length, 1);
  const bp = rows[0];
  const agg = await pool.query(
    `SELECT COALESCE(sum(saved_usd) FILTER (WHERE NOT is_keepalive),0)::float AS gross,
            COALESCE(sum(cost_usd) FILTER (WHERE is_keepalive),0)::float AS ka
       FROM request_logs rl JOIN api_keys k ON k.id=rl.api_key_id WHERE k.user_id=$1`,
    [userId]
  );
  const net = agg.rows[0].gross - agg.rows[0].ka;
  assert.ok(Math.abs(Number(bp.net_saved_usd) - net) < 1e-9);
  assert.ok(Math.abs(Number(bp.fee_usd) - Math.max(0, net) * FEE_RATE) < 1e-9);
  assert.equal(bp.status, "beta_waived");

  await billingSweep(pool); // second run must not duplicate
  const again = await pool.query("SELECT count(*)::int c FROM billing_periods WHERE user_id=$1", [userId]);
  assert.equal(again.rows[0].c, 1);
});

test("weekly report: sends once per ISO week via resend, skips duplicates", async () => {
  const deps = { pool, resendApiKey: "re_test", resendUrl: resend.url };
  const sent1 = await weeklyReportSweep(deps, true);
  assert.equal(sent1, 1);
  assert.equal(resend.state.sent.length, 1);
  const mail = resend.state.sent[0];
  assert.deepEqual(mail.to, ["mp@t.co"]);
  assert.match(mail.auth, /Bearer re_test/);
  assert.match(mail.html, /SAVED BY CACHING/);
  assert.match(mail.html, /caching\.ai\/console/);

  const sent2 = await weeklyReportSweep(deps, true);
  assert.equal(sent2, 0, "same ISO week must not send twice");

  // non-Monday scheduled runs are no-ops without force
  const tue = new Date("2026-07-14T10:00:00Z");
  assert.equal(await weeklyReportSweep({ ...deps, now: () => tue }, false), 0);
});

test("report renderer: breaker warning appears only at high rates", () => {
  const base = {
    email: "x@y.z", userId: 1, locale: "en", requests: 100, savedUsd: 12.34, wastedUsd: 5, hitRate: 0.8,
    cacheReadTokens: 1, totalInputTokens: 2, keepalivePings: 3, keepaliveCostUsd: 0.01,
    breakerRate: 0.05, topModel: "claude-opus-4-8",
    tuningChanges: 0, tuningExample: null as any,
  };
  assert.doesNotMatch(renderWeeklyReportHtml(base).html, /prompt prefix changed/);
  assert.match(renderWeeklyReportHtml({ ...base, breakerRate: 0.5 }).html, /prompt prefix changed/);
  assert.match(renderWeeklyReportHtml(base).subject, /\$12\.34/);

  // auto-tune line renders only when decisions exist, with the key name escaped
  assert.doesNotMatch(renderWeeklyReportHtml(base).html, /Auto-Tune adjusted/);
  const tuned = renderWeeklyReportHtml({
    ...base,
    tuningChanges: 2,
    tuningExample: { keyName: "<b>prod</b>", setting: "anthropic_cache_ttl", from: "5m", to: "1h" },
  }).html;
  assert.match(tuned, /Auto-Tune adjusted 2 cache settings/);
  assert.match(tuned, /Anthropic cache TTL 5m → 1h/);
  assert.ok(tuned.includes("&lt;b&gt;prod&lt;/b&gt;"), "key name must be escaped");
});

test("isoWeekKey stable across year boundaries", () => {
  assert.equal(isoWeekKey(new Date("2026-01-01T00:00:00Z")), "2026-W01");
  assert.equal(isoWeekKey(new Date("2025-12-29T00:00:00Z")), "2026-W01"); // ISO week spills
  assert.equal(isoWeekKey(new Date("2026-07-16T00:00:00Z")), "2026-W29");
});

// ---------- full-pipeline additions: openai/gemini keep-alive + cache-key injection ----------
import { keepaliveSweep, PING_AFTER_MS, TTL_5M_MS } from "../src/keepalive.js";

const BIGSYS = "You are a precise assistant. ".repeat(200); // ~1.7k estimated tokens

test("openai: pre-5.6 gets NO injection; gpt-5.6+ gets explicit breakpoint + STABLE prompt_cache_key", async () => {
  // pre-5.6: run-20260718 measured our injected key LOWERING hit rates — nothing is injected
  await fetch(`${proxyUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ck}` },
    body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "system", content: BIGSYS }, { role: "user", content: "q" }] }),
  });
  assert.equal(openaiState.bodies.at(-1).prompt_cache_key, undefined, "pre-5.6 must stay untouched");
  assert.equal(typeof openaiState.bodies.at(-1).messages[0].content, "string");

  // gpt-5.6+: breakpoint-scoped caching — inject breakpoint at end of the shared prefix + stable key
  await fetch(`${proxyUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ck}` },
    body: JSON.stringify({ model: "gpt-5.6-sol", messages: [{ role: "system", content: BIGSYS }, { role: "user", content: "q one" }] }),
  });
  const b1 = openaiState.bodies.at(-1);
  assert.match(b1.prompt_cache_key, /^cai-[0-9a-f]{16}$/);
  assert.equal(b1.messages[0].content[0].text, BIGSYS);
  assert.deepEqual(b1.messages[0].content[0].prompt_cache_breakpoint, { mode: "explicit" });

  // the key must be STABLE across different user messages (a per-call key
  // defeats cache routing — that mistake caused the run-20260718 hit-rate drop)
  await fetch(`${proxyUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ck}` },
    body: JSON.stringify({ model: "gpt-5.6-sol", messages: [{ role: "system", content: BIGSYS }, { role: "user", content: "a totally different question" }] }),
  });
  assert.equal(openaiState.bodies.at(-1).prompt_cache_key, b1.prompt_cache_key, "key must not vary per call");

  // caller-set caching params are never replaced
  await fetch(`${proxyUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ck}` },
    body: JSON.stringify({ model: "gpt-5.6-sol", prompt_cache_key: "mine", messages: [{ role: "system", content: BIGSYS }, { role: "user", content: "q" }] }),
  });
  assert.equal(openaiState.bodies.at(-1).prompt_cache_key, "mine", "existing key must never be replaced");
  assert.equal(typeof openaiState.bodies.at(-1).messages[0].content, "string", "no breakpoint when caller opted in themselves");

  // prefixes under the 1024-token cache minimum stay untouched
  await fetch(`${proxyUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ck}` },
    body: JSON.stringify({ model: "gpt-5.6-sol", messages: [{ role: "system", content: "tiny" }, { role: "user", content: "q" }] }),
  });
  assert.equal(openaiState.bodies.at(-1).prompt_cache_key, undefined, "below-minimum prefix: no injection");
});

test("openai/gemini: keep-alive state is never saved — warming is Anthropic-only", async () => {
  await pool.query("UPDATE api_keys SET keepalive_enabled=true WHERE key_hash=$1", [sha256Hex(ck)]);
  await fetch(`${proxyUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ck}` },
    body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "system", content: BIGSYS }, { role: "user", content: "real" }] }),
  });
  await fetch(`${proxyUrl}/v1beta/models/gemini-2.5-pro:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": ck },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: BIGSYS }] },
      contents: [{ role: "user", parts: [{ text: "real" }] }],
    }),
  });
  await new Promise((r) => setTimeout(r, 400)); // let fire-and-forget logs land
  const { rows } = await pool.query("SELECT provider FROM keepalive_state WHERE provider <> 'anthropic'");
  assert.equal(rows.length, 0, "non-anthropic prefixes must never be stored (run-20260718)");
  await pool.query("UPDATE api_keys SET keepalive_enabled=false WHERE key_hash=$1", [sha256Hex(ck)]);
});

// ---------- Grok (xAI): OpenAI-compatible, routed by model prefix ----------
import { startMockOpenAI as startMockGrok } from "./mock-providers.js";

// tests flip key flags via direct SQL — the hot-path key cache must not mask that
process.env.KEY_CACHE_TTL_MS = "0";

test("grok: routed to xAI upstream by model prefix, priced with grok table, no prompt_cache_key", async () => {
  const grokMock = await startMockGrok(45886);
  servers.push(grokMock.server);
  await pool.query("UPDATE api_keys SET grok_key_encrypted=$1 WHERE key_hash=$2",
    [encrypt("xai-key-x", ENC_KEY), sha256Hex(ck)]);

  // rebuild app with grok upstream (separate port from openai mock)
  const { buildApp: build2 } = await import("../src/app.js");
  const app2 = build2({
    pool,
    upstreamUrl: "http://127.0.0.1:45881",
    openaiUpstreamUrl: "http://127.0.0.1:45882",
    geminiUpstreamUrl: "http://127.0.0.1:45883",
    grokUpstreamUrl: grokMock.url,
    encryptionKey: ENC_KEY,
  });
  const srv = serve({ fetch: app2.fetch, port: 45887 });
  servers.push(srv);
  await new Promise((r) => setTimeout(r, 100));

  const res = await fetch("http://127.0.0.1:45887/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ck}` },
    body: JSON.stringify({ model: "grok-4", messages: [{ role: "system", content: "s" }, { role: "user", content: "hi" }] }),
  });
  assert.equal(res.status, 200);
  assert.equal(grokMock.state.authHeaders.at(-1), "Bearer xai-key-x", "must use the xAI key");
  assert.equal(grokMock.state.bodies.at(-1).prompt_cache_key, undefined, "no prompt_cache_key for grok");

  const [row] = await waitRows("SELECT * FROM request_logs WHERE provider='grok' ORDER BY id DESC LIMIT 1", []);
  assert.equal(row.model, "grok-4");
  assert.equal(Number(row.cache_read_tokens), 2048);
  // xAI bills reasoning as output but reports it OUTSIDE completion_tokens —
  // 40 completion + 500 reasoning must both be metered (run-20260718 bug fix)
  assert.equal(Number(row.output_tokens), 540);
  const expectCost = (3000 - 2048) * 3e-6 + 2048 * 3e-6 * 0.25 + 540 * 15e-6;
  assert.ok(Math.abs(Number(row.cost_usd) - expectCost) < 1e-9, "reasoning tokens billed as output");
  // grok-4: 2048 cached at 25% of $3/MTok → saved = 2048 * 3e-6 * 0.75
  assert.ok(Math.abs(Number(row.saved_usd) - 2048 * 3e-6 * 0.75) < 1e-9);
});

// ---------- provider cache tuning (TTL / retention / conv-id) ----------

test("grok: stable x-grok-conv-id injected when absent, preserved when present", async () => {
  const grokMock = await startMockGrok(45896);
  servers.push(grokMock.server);
  const { buildApp: build3 } = await import("../src/app.js");
  const app3 = build3({
    pool,
    upstreamUrl: "http://127.0.0.1:45881",
    openaiUpstreamUrl: "http://127.0.0.1:45882",
    geminiUpstreamUrl: "http://127.0.0.1:45883",
    grokUpstreamUrl: grokMock.url,
    encryptionKey: ENC_KEY,
  });
  const srv = serve({ fetch: app3.fetch, port: 45897 });
  servers.push(srv);
  await new Promise((r) => setTimeout(r, 100));

  await fetch("http://127.0.0.1:45897/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ck}` },
    body: JSON.stringify({ model: "grok-4", messages: [{ role: "system", content: "s" }, { role: "user", content: "hi" }] }),
  });
  assert.match(grokMock.state.convIds.at(-1) ?? "", /^cai-[0-9a-f]{16}$/, "conv-id injected for cache routing");

  await fetch("http://127.0.0.1:45897/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ck}`,
      "x-grok-conv-id": "user-set-conv",
    },
    body: JSON.stringify({ model: "grok-4", messages: [{ role: "user", content: "hi" }] }),
  });
  assert.equal(grokMock.state.convIds.at(-1), "user-set-conv", "caller's conv-id must never be replaced");
});

test("openai: prompt_cache_retention is never injected (upstream default since 2026), caller values pass through", async () => {
  await pool.query("UPDATE api_keys SET openai_cache_retention='24h' WHERE key_hash=$1", [sha256Hex(ck)]);
  await fetch(`${proxyUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ck}` },
    body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "q" }] }),
  });
  assert.equal(openaiState.bodies.at(-1).prompt_cache_retention, undefined,
    "24h keys: nothing injected — 24h is already the upstream default and GPT-5.6+ rejects the old param");

  await fetch(`${proxyUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ck}` },
    body: JSON.stringify({ model: "gpt-4o", prompt_cache_retention: "in_memory", messages: [{ role: "user", content: "q" }] }),
  });
  assert.equal(openaiState.bodies.at(-1).prompt_cache_retention, "in_memory", "caller's value must never be replaced");

  await pool.query("UPDATE api_keys SET openai_cache_retention='default' WHERE key_hash=$1", [sha256Hex(ck)]);
  await fetch(`${proxyUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ck}` },
    body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "q" }] }),
  });
  assert.equal(openaiState.bodies.at(-1).prompt_cache_retention, undefined, "default = pass through untouched");
});

test("keepalive: 24h-retention openai keys are skipped; anthropic 1h TTL pings hourly, not every 4 minutes", async () => {
  const { PING_AFTER_1H_MS } = await import("../src/keepalive.js");
  const u = await pool.query("INSERT INTO users(email, password_hash) VALUES('ttl-ka@t.co','x') RETURNING id");
  const kaCk = generateApiKey();
  const k = await pool.query(
    `INSERT INTO api_keys(user_id, key_hash, key_prefix_display, keepalive_enabled,
        anthropic_key_encrypted, openai_key_encrypted, anthropic_cache_ttl, openai_cache_retention)
     VALUES($1,$2,'ck_…',true,$3,$4,'1h','24h') RETURNING id`,
    [u.rows[0].id, sha256Hex(kaCk), encrypt("sk-ant-x", ENC_KEY), encrypt("sk-openai-x", ENC_KEY)]
  );
  // anchored to 03:00 UTC today — these simulated timelines span an hour or
  // more, and crossing UTC midnight resets pings_today/spend_day mid-test
  const base = new Date().setUTCHours(3, 0, 0, 0);
  const anthroPrefix = encrypt(JSON.stringify({ model: "claude-sonnet-4-5", messages: [{ role: "user", content: "ctx" }] }), ENC_KEY);
  const openaiPrefix = encrypt(JSON.stringify({ model: "gpt-4o", messages: [{ role: "system", content: "ctx" }] }), ENC_KEY);
  await pool.query(
    `INSERT INTO keepalive_state(api_key_id, provider, encrypted_prefix, prefix_token_estimate, last_request_at)
     VALUES($1,'anthropic',$2,2000,to_timestamp($4/1000.0)), ($1,'openai',$3,2000,to_timestamp($4/1000.0))`,
    [k.rows[0].id, anthroPrefix, openaiPrefix, base]
  );
  const deps = {
    pool,
    upstreamUrl: "http://127.0.0.1:45881",
    openaiUpstreamUrl: "http://127.0.0.1:45882",
    geminiUpstreamUrl: "http://127.0.0.1:45883",
    encryptionKey: ENC_KEY,
  };
  // 5 minutes idle: 5m-TTL keys would ping here — a 1h-TTL anthropic key must not,
  // and the 24h-retention openai key must never ping at all
  assert.equal(await keepaliveSweep({ ...deps, now: () => base + PING_AFTER_MS + 60_000 }), 0);
  // 56 minutes idle: the 1h-TTL anthropic prefix gets its hourly re-warm
  assert.equal(await keepaliveSweep({ ...deps, now: () => base + PING_AFTER_1H_MS + 60_000 }), 1);
  const { rows } = await pool.query(
    "SELECT provider, pings_today FROM keepalive_state WHERE api_key_id=$1 ORDER BY provider", [k.rows[0].id]);
  assert.equal(rows[0].provider, "anthropic");
  assert.equal(rows[0].pings_today, 1);
  assert.equal(rows[1].provider, "openai");
  assert.equal(rows[1].pings_today, 0, "openai with 24h retention must not be pinged");
});

test("keepalive: daily budget guard — at budget no ping, raised budget pings", async () => {
  const u = await pool.query("INSERT INTO users(email, password_hash) VALUES('budget-sum@t.co','x') RETURNING id");
  const k = await pool.query(
    `INSERT INTO api_keys(user_id, key_hash, key_prefix_display, keepalive_enabled, keepalive_budget_usd_daily,
        anthropic_key_encrypted)
     VALUES($1,$2,'ck_…',true,1.0,$3) RETURNING id`,
    [u.rows[0].id, sha256Hex(generateApiKey()), encrypt("sk-ant-x", ENC_KEY)]
  );
  // anchored to 03:00 UTC today — these simulated timelines span an hour or
  // more, and crossing UTC midnight resets pings_today/spend_day mid-test
  const base = new Date().setUTCHours(3, 0, 0, 0);
  const today = new Date(base).toISOString().slice(0, 10);
  const anthroPrefix = encrypt(JSON.stringify({ model: "claude-sonnet-4-5", messages: [{ role: "user", content: "ctx" }] }), ENC_KEY);
  await pool.query(
    `INSERT INTO keepalive_state(api_key_id, provider, encrypted_prefix, prefix_token_estimate, last_request_at, spend_today_usd, spend_day)
     VALUES($1,'anthropic',$2,2000,to_timestamp($3/1000.0),1.0,$4::date)`,
    [k.rows[0].id, anthroPrefix, base, today]
  );
  const deps = { pool, upstreamUrl: "http://127.0.0.1:45881", encryptionKey: ENC_KEY };
  await keepaliveSweep({ ...deps, now: () => base + PING_AFTER_MS + 60_000 });
  let { rows } = await pool.query(
    "SELECT pings_today FROM keepalive_state WHERE api_key_id=$1", [k.rows[0].id]);
  assert.equal(rows[0].pings_today, 0, "spend at budget: no ping");

  await pool.query("UPDATE api_keys SET keepalive_budget_usd_daily=2.0 WHERE id=$1", [k.rows[0].id]);
  await keepaliveSweep({ ...deps, now: () => base + PING_AFTER_MS + 60_000 });
  rows = (await pool.query("SELECT pings_today FROM keepalive_state WHERE api_key_id=$1", [k.rows[0].id])).rows;
  assert.equal(rows[0].pings_today, 1, "budget raised: ping goes out");
});

test("warm hold: anthropic command intercepted, hold set, nothing forwarded", async () => {
  const u = await pool.query("INSERT INTO users(email, password_hash) VALUES('hold@t.co','x') RETURNING id");
  const holdCk = generateApiKey();
  const k = await pool.query(
    `INSERT INTO api_keys(user_id, key_hash, key_prefix_display, keepalive_enabled, anthropic_key_encrypted, openai_key_encrypted)
     VALUES($1,$2,'ck_…',true,$3,$4) RETURNING id`,
    [u.rows[0].id, sha256Hex(holdCk), encrypt("sk-ant-x", ENC_KEY), encrypt("sk-openai-x", ENC_KEY)]
  );
  await pool.query(
    `INSERT INTO keepalive_state(api_key_id, provider, encrypted_prefix, prefix_token_estimate, last_request_at)
     VALUES($1,'anthropic',$2,2000,now())`,
    [k.rows[0].id, encrypt(JSON.stringify({ model: "claude-sonnet-4-5", messages: [] }), ENC_KEY)]
  );

  const res = await fetch(`${proxyUrl}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": holdCk },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 100,
      messages: [{ role: "user", content: "캐시 30분 지켜줘" }] }),
  });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.role, "assistant");
  assert.match(j.content[0].text, /예열해뒀어요/, "the saved prefix is warmed on the spot");
  assert.match(j.content[0].text, /30분 동안/);
  const { rows } = await pool.query(
    `SELECT extract(epoch FROM (keepalive_hold_until - now()))::int AS secs FROM api_keys WHERE id=$1`,
    [k.rows[0].id]
  );
  assert.ok(rows[0].secs > 28 * 60 && rows[0].secs <= 30 * 60, `hold ~30min, got ${rows[0].secs}s`);

  // keepalive off -> guidance, no hold
  await pool.query("UPDATE api_keys SET keepalive_enabled=false, keepalive_hold_until=NULL WHERE id=$1", [k.rows[0].id]);
  const res2 = await fetch(`${proxyUrl}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": holdCk },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 100,
      messages: [{ role: "user", content: "cai:hold 2h" }] }),
  });
  const j2 = await res2.json();
  assert.match(j2.content[0].text, /Cache Warmer is off/);
  const after = await pool.query("SELECT keepalive_hold_until FROM api_keys WHERE id=$1", [k.rows[0].id]);
  assert.equal(after.rows[0].keepalive_hold_until, null);
  await pool.query("UPDATE api_keys SET keepalive_enabled=true WHERE id=$1", [k.rows[0].id]);
});

test("warm hold: openai stream command returns synthetic SSE; real prompts pass through", async () => {
  const holdCk2 = generateApiKey();
  const u = await pool.query("SELECT id FROM users WHERE email='hold@t.co'");
  const k = await pool.query(
    `INSERT INTO api_keys(user_id, key_hash, key_prefix_display, keepalive_enabled, openai_key_encrypted, anthropic_key_encrypted)
     VALUES($1,$2,'ck_…',true,$3,$4) RETURNING id`,
    [u.rows[0].id, sha256Hex(holdCk2), encrypt("sk-openai-x", ENC_KEY), encrypt("sk-ant-x", ENC_KEY)]
  );
  await pool.query(
    `INSERT INTO keepalive_state(api_key_id, provider, encrypted_prefix, prefix_token_estimate, last_request_at)
     VALUES($1,'openai',$2,2000,now())`,
    [k.rows[0].id, encrypt(JSON.stringify({ model: "gpt-4o", messages: [] }), ENC_KEY)]
  );

  const before = openaiState.bodies.length;
  const res = await fetch(`${proxyUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${holdCk2}` },
    body: JSON.stringify({ model: "gpt-4o", stream: true,
      messages: [{ role: "user", content: "keep my cache warm for 1 hour" }] }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
  const sseText = await res.text();
  assert.match(sseText, /only applies to Anthropic traffic/,
    "no Anthropic prefix on this key: warming has nothing to hold, and we say why");
  assert.match(sseText, /data: \[DONE\]/);
  assert.equal(openaiState.bodies.length, before, "command must not reach the upstream");

  // a real coding question about caching passes through untouched
  const res3 = await fetch(`${proxyUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${holdCk2}` },
    body: JSON.stringify({ model: "gpt-4o",
      messages: [{ role: "user", content: "explain how our cache hold logic works" }] }),
  });
  assert.equal(res3.status, 200);
  assert.equal((await res3.json()).choices[0].message.content, "Hello from mock OpenAI");
  assert.equal(openaiState.bodies.length, before + 1, "real prompt forwarded upstream");
});

test("warm hold: sweep pings past give-up while held, stops when hold expires", async () => {
  const u = await pool.query("INSERT INTO users(email, password_hash) VALUES('hold-sweep@t.co','x') RETURNING id");
  const k = await pool.query(
    `INSERT INTO api_keys(user_id, key_hash, key_prefix_display, keepalive_enabled, anthropic_key_encrypted)
     VALUES($1,$2,'ck_…',true,$3) RETURNING id`,
    [u.rows[0].id, sha256Hex(generateApiKey()), encrypt("sk-ant-x", ENC_KEY)]
  );
  // anchored to 03:00 UTC today — these simulated timelines span an hour or
  // more, and crossing UTC midnight resets pings_today/spend_day mid-test
  const base = new Date().setUTCHours(3, 0, 0, 0);
  const twoHoursAgo = base - 2 * 3600_000; // far past the 62.5min give-up
  await pool.query(
    `INSERT INTO keepalive_state(api_key_id, provider, encrypted_prefix, prefix_token_estimate, last_request_at)
     VALUES($1,'anthropic',$2,2000,to_timestamp($3/1000.0))`,
    [k.rows[0].id, encrypt(JSON.stringify({ model: "claude-sonnet-4-5", messages: [{ role: "user", content: "ctx" }] }), ENC_KEY), twoHoursAgo]
  );
  const deps = {
    pool,
    upstreamUrl: "http://127.0.0.1:45881",
    openaiUpstreamUrl: "http://127.0.0.1:45882",
    geminiUpstreamUrl: "http://127.0.0.1:45883",
    encryptionKey: ENC_KEY,
  };

  // no hold: give-up window closed, no ping
  await keepaliveSweep({ ...deps, now: () => base });
  let rows = (await pool.query("SELECT pings_today FROM keepalive_state WHERE api_key_id=$1", [k.rows[0].id])).rows;
  assert.equal(rows[0].pings_today, 0, "past give-up without hold: silent");

  // active hold: give-up is overridden
  await pool.query(
    "UPDATE api_keys SET keepalive_hold_until = to_timestamp($2/1000.0) WHERE id=$1",
    [k.rows[0].id, base + 3600_000]);
  await keepaliveSweep({ ...deps, now: () => base });
  rows = (await pool.query("SELECT pings_today FROM keepalive_state WHERE api_key_id=$1", [k.rows[0].id])).rows;
  assert.equal(rows[0].pings_today, 1, "held: pinged past give-up");

  // hold expired: silent again on the next window
  await pool.query(
    "UPDATE api_keys SET keepalive_hold_until = to_timestamp($2/1000.0) WHERE id=$1",
    [k.rows[0].id, base - 60_000]);
  await keepaliveSweep({ ...deps, now: () => base + PING_AFTER_MS + 60_000 });
  rows = (await pool.query("SELECT pings_today FROM keepalive_state WHERE api_key_id=$1", [k.rows[0].id])).rows;
  assert.equal(rows[0].pings_today, 1, "expired hold: no further pings");
});

test("warm hold: responses API (Codex) command intercepted with responses-shaped reply", async () => {
  const ck2 = generateApiKey();
  const u = await pool.query("SELECT id FROM users WHERE email='hold@t.co'");
  const k = await pool.query(
    `INSERT INTO api_keys(user_id, key_hash, key_prefix_display, keepalive_enabled, openai_key_encrypted)
     VALUES($1,$2,'ck_…',true,$3) RETURNING id`,
    [u.rows[0].id, sha256Hex(ck2), encrypt("sk-openai-x", ENC_KEY)]
  );
  await pool.query(
    `INSERT INTO keepalive_state(api_key_id, provider, encrypted_prefix, prefix_token_estimate, last_request_at)
     VALUES($1,'openai',$2,2000,now())`,
    [k.rows[0].id, encrypt(JSON.stringify({ model: "gpt-5.6", messages: [] }), ENC_KEY)]
  );

  const before = openaiState.bodies.length;
  const res = await fetch(`${proxyUrl}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ck2}` },
    body: JSON.stringify({ model: "gpt-5.6", input: "キャッシュを2時間保温して" }),
  });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.object, "response");
  assert.equal(j.status, "completed");
  assert.match(j.output[0].content[0].text, /Anthropic/, "answered in Japanese, on the responses wire");
  assert.match(j.output[0].content[0].text, /保温/);
  assert.equal(openaiState.bodies.length, before, "command must not reach the upstream");

  // streaming variant emits the responses SSE event sequence
  const res2 = await fetch(`${proxyUrl}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ck2}` },
    body: JSON.stringify({ model: "gpt-5.6", stream: true, input: "cai:hold 1h" }),
  });
  const sseText = await res2.text();
  assert.match(sseText, /event: response\.created/);
  assert.match(sseText, /event: response\.output_text\.delta/);
  assert.match(sseText, /event: response\.completed/);
});

test("warm hold: gemini command intercepted with candidates-shaped reply", async () => {
  const ck3 = generateApiKey();
  const u = await pool.query("SELECT id FROM users WHERE email='hold@t.co'");
  const k = await pool.query(
    `INSERT INTO api_keys(user_id, key_hash, key_prefix_display, keepalive_enabled, gemini_key_encrypted)
     VALUES($1,$2,'ck_…',true,$3) RETURNING id`,
    [u.rows[0].id, sha256Hex(ck3), encrypt("gm-key-x", ENC_KEY)]
  );
  await pool.query(
    `INSERT INTO keepalive_state(api_key_id, provider, encrypted_prefix, prefix_token_estimate, last_request_at)
     VALUES($1,'gemini',$2,2000,now())`,
    [k.rows[0].id, encrypt(JSON.stringify({ model: "gemini-2.5-pro" }), ENC_KEY)]
  );

  const before = geminiState.bodies.length;
  const res = await fetch(`${proxyUrl}/v1beta/models/gemini-2.5-pro:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": ck3 },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "帮我保温缓存 2 小时" }] }] }),
  });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.candidates[0].content.role, "model");
  assert.match(j.candidates[0].content.parts[0].text, /保温只对 Anthropic 流量生效/);
  assert.equal(j.candidates[0].finishReason, "STOP");
  assert.equal(geminiState.bodies.length, before, "command must not reach the upstream");
});

test("keepalive: legacy non-anthropic state rows are never pinged — warming is Anthropic-only", async () => {
  const u = await pool.query("INSERT INTO users(email, password_hash) VALUES('cls@t.co','x') RETURNING id");
  const k = await pool.query(
    `INSERT INTO api_keys(user_id, key_hash, key_prefix_display, keepalive_enabled, openai_key_encrypted, gemini_key_encrypted)
     VALUES($1,$2,'ck_…',true,$3,$4) RETURNING id`,
    [u.rows[0].id, sha256Hex(generateApiKey()), encrypt("sk-openai-x", ENC_KEY), encrypt("gm-key-x", ENC_KEY)]
  );
  // anchored to 03:00 UTC today — these simulated timelines span an hour or
  // more, and crossing UTC midnight resets pings_today/spend_day mid-test
  const base = new Date().setUTCHours(3, 0, 0, 0);
  // rows a pre-migration deployment might have left behind
  const mkState = (provider: string, model: string, prefix: object) =>
    pool.query(
      `INSERT INTO keepalive_state(api_key_id, provider, encrypted_prefix, model, prefix_token_estimate, last_request_at)
       VALUES($1,$2,$3,$4,2000,to_timestamp($5/1000.0))`,
      [k.rows[0].id, provider, encrypt(JSON.stringify(prefix), ENC_KEY), model, base]
    );
  await mkState("openai", "gpt-4o", { model: "gpt-4o", messages: [{ role: "system", content: "ctx" }] });
  await mkState("gemini", "gemini-2.5-pro", { model: "gemini-2.5-pro", systemInstruction: { parts: [{ text: "ctx" }] } });

  const deps = { pool, upstreamUrl: "http://127.0.0.1:45881", encryptionKey: ENC_KEY };
  const nOpenai = openaiState.bodies.length;
  const nGemini = geminiState.bodies.length;
  for (const idle of [PING_AFTER_MS + 60_000, 26 * 60_000, 56 * 60_000]) {
    await keepaliveSweep({ ...deps, now: () => base + idle });
  }
  const { rows } = await pool.query(
    "SELECT provider, pings_today FROM keepalive_state WHERE api_key_id=$1 ORDER BY provider", [k.rows[0].id]);
  assert.deepEqual(rows.map((r: any) => [r.provider, r.pings_today]), [["gemini", 0], ["openai", 0]]);
  assert.equal(openaiState.bodies.length, nOpenai, "no openai ping traffic");
  assert.equal(geminiState.bodies.length, nGemini, "no gemini ping traffic");
});

test("warm hold ≥30min on a 5m key: ONE 1h-TTL upgrade ping now, then 55m cadence", async () => {
  const u = await pool.query("INSERT INTO users(email, password_hash) VALUES('hold-1h@t.co','x') RETURNING id");
  const k = await pool.query(
    `INSERT INTO api_keys(user_id, key_hash, key_prefix_display, keepalive_enabled, anthropic_key_encrypted, anthropic_cache_ttl)
     VALUES($1,$2,'ck_…',true,$3,'5m') RETURNING id`,
    [u.rows[0].id, sha256Hex(generateApiKey()), encrypt("sk-ant-x", ENC_KEY)]
  );
  // anchored to 03:00 UTC today — these simulated timelines span an hour or
  // more, and crossing UTC midnight resets pings_today/spend_day mid-test
  const base = new Date().setUTCHours(3, 0, 0, 0);
  const prefix = {
    model: "claude-sonnet-4-5",
    system: [{ type: "text", text: "ctx", cache_control: { type: "ephemeral" } }],
    messages: [],
  };
  await pool.query(
    `INSERT INTO keepalive_state(api_key_id, provider, encrypted_prefix, prefix_token_estimate, last_request_at)
     VALUES($1,'anthropic',$2,2000,to_timestamp($3/1000.0))`,
    [k.rows[0].id, encrypt(JSON.stringify(prefix), ENC_KEY), base]
  );
  // a 2-hour hold — comfortably past the 30min upgrade threshold
  await pool.query(
    "UPDATE api_keys SET keepalive_hold_until = to_timestamp($2/1000.0) WHERE id=$1",
    [k.rows[0].id, base + 2 * 3600_000]
  );
  const deps = { pool, upstreamUrl: "http://127.0.0.1:45881", encryptionKey: ENC_KEY };
  const pings = async () =>
    (await pool.query("SELECT pings_today FROM keepalive_state WHERE api_key_id=$1", [k.rows[0].id])).rows[0].pings_today;

  // 30s after the hold lands: the 5m entry is still warm — a 1h marker would
  // only READ it (measured, prod e2e 2026-07-18), so the sweep stays silent
  // and lets it expire. No 4-minute cadence either.
  await keepaliveSweep({ ...deps, now: () => base + 30_000 });
  await keepaliveSweep({ ...deps, now: () => base + PING_AFTER_MS + 30_000 });
  assert.equal(await pings(), 0, "silent while the 5m entry is still warm");

  // just past 5m expiry: the upgrade fires once and cold-writes the 1h TTL
  await keepaliveSweep({ ...deps, now: () => base + TTL_5M_MS + 60_000 });
  assert.equal(await pings(), 1, "upgrade ping fires right after 5m expiry");
  const upgradeBody = anthroState.bodies.at(-1);
  assert.deepEqual(upgradeBody.system[0].cache_control, { type: "ephemeral", ttl: "1h" },
    "hold upgrade must write the 1h TTL");

  // 30 minutes in: the 1h entry is alive — NO 4-minute cadence
  await keepaliveSweep({ ...deps, now: () => base + 30 * 60_000 });
  assert.equal(await pings(), 1, "no pings while the 1h entry is alive");

  // ~56 minutes after the upgrade: one refresh per 55m window keeps it warm
  await keepaliveSweep({ ...deps, now: () => base + 62 * 60_000 });
  assert.equal(await pings(), 2, "hourly refresh, not 4-minute pings");
  assert.deepEqual(anthroState.bodies.at(-1).system[0].cache_control, { type: "ephemeral", ttl: "1h" });

  // shortly after: still inside the fresh window — silent
  await keepaliveSweep({ ...deps, now: () => base + 64 * 60_000 });
  assert.equal(await pings(), 2);
});

test("breaker auto-pause: injection stops while the prefix keeps changing, resumes when stable", async () => {
  const { resetBreakerPause } = await import("../src/logic/breakerPause.js");
  resetBreakerPause();
  // a broken prefix never reads from cache — reflect that in the mock usage
  const savedUsage = { ...anthroState.usage };
  anthroState.usage = { ...anthroState.usage, cache_read_input_tokens: 0 };
  const u = await pool.query("INSERT INTO users(email, password_hash) VALUES('brk@t.co','x') RETURNING id");
  const brkCk = generateApiKey();
  await pool.query(
    `INSERT INTO api_keys(user_id, key_hash, key_prefix_display, anthropic_key_encrypted)
     VALUES($1,$2,'ck_…',$3)`,
    [u.rows[0].id, sha256Hex(brkCk), encrypt("sk-ant-x", ENC_KEY)]
  );
  const send = async (sys: string) => {
    await fetch(`${proxyUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": brkCk },
      body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 8, system: sys + " " + BIGSYS,
        messages: [{ role: "user", content: "q" }] }),
    });
    await new Promise((r) => setTimeout(r, 250)); // let the async breaker log land
    return anthroState.bodies.at(-1);
  };

  // timestamp-style breaker: system changes every call
  const b1 = await send("t=1");
  assert.ok(Array.isArray(b1.system), "call 1 injected (no history yet)");
  await send("t=2"); // breaker #1 observed
  await send("t=3"); // breaker #2 observed → paused from the next call
  const b4 = await send("t=4");
  assert.equal(typeof b4.system, "string", "paused: request passes through untouched");

  // prefix stabilizes: the pause clears once two consecutive requests share
  // the same prefix, and injection resumes on the call after that
  await send("stable"); // transition call — still differs from t=4
  await send("stable"); // matches previous → streak cleared
  const b7 = await send("stable");
  assert.ok(Array.isArray(b7.system), "resumed after a stable prefix");
  anthroState.usage = savedUsage;
});
