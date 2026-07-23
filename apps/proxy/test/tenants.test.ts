import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { serve, type ServerType } from "@hono/node-server";
import { migrate, setPool, sha256Hex, encrypt, generateApiKey } from "@caching/shared";
import { buildApp } from "../src/app.js";
import { keepaliveSweep, PING_AFTER_MS } from "../src/keepalive.js";
import { clearApiKeyCache, clearTenantPolicyCache } from "../src/store.js";
import { startMock } from "./mock-anthropic.js";

// Sub-tenants: one enterprise key, many end-customers — per-tenant policy,
// per-request overrides, per-tenant warm slots + budgets, usage attribution,
// the ck_-authenticated management API, and gateway upstreams with header
// replay on warming pings. End to end against mock upstreams.

process.env.KEY_CACHE_TTL_MS = "0";

const DB_URL = process.env.TEST_DATABASE_URL_TENANTS ?? "postgres://localhost:5432/caching_ai_test8";
const ENC_KEY = "a".repeat(64);
const here = dirname(fileURLToPath(import.meta.url));
const BIG = "y".repeat(20_000);

let pool: pg.Pool;
let mock: Awaited<ReturnType<typeof startMock>>;
let gatewayMock: Awaited<ReturnType<typeof startMock>>;
let proxyServer: ServerType;
let proxyUrl: string;

let ck: string;
let keyId: number;

const settle = () => new Promise((r) => setTimeout(r, 300));

async function callMessages(headers: Record<string, string> = {}, body?: any): Promise<Response> {
  return fetch(`${proxyUrl}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": ck, "content-type": "application/json", ...headers },
    body: JSON.stringify(
      body ?? {
        model: "claude-sonnet-4-5",
        max_tokens: 16,
        system: BIG,
        messages: [{ role: "user", content: "hi" }],
      }
    ),
  });
}

async function admin(method: string, path: string, body?: any): Promise<Response> {
  return fetch(`${proxyUrl}/admin/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${ck}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

before(async () => {
  pool = new pg.Pool({ connectionString: DB_URL });
  setPool(pool);
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(join(here, "../../../packages/shared/migrations"), DB_URL);

  const u = await pool.query(
    "INSERT INTO users(email, password_hash) VALUES('platform@corp.co','x') RETURNING id");
  ck = generateApiKey();
  const k = await pool.query(
    `INSERT INTO api_keys(user_id, key_hash, key_prefix_display, anthropic_key_encrypted)
     VALUES($1,$2,'e…',$3) RETURNING id`,
    [u.rows[0].id, sha256Hex(ck), encrypt("sk-ant-ENTERPRISE", ENC_KEY)]
  );
  keyId = k.rows[0].id;

  mock = await startMock(45974);
  gatewayMock = await startMock(45975);
  process.env.UPSTREAM_GATEWAY_ALLOW = `${gatewayMock.url}, https://gateway.example.com`;
  const app = buildApp({ pool, upstreamUrl: mock.url, encryptionKey: ENC_KEY });
  await new Promise<void>((resolve) => {
    proxyServer = serve({ fetch: app.fetch, port: 45976 }, () => resolve());
  });
  proxyUrl = "http://127.0.0.1:45976";
});

after(async () => {
  proxyServer?.close();
  mock?.server?.close();
  gatewayMock?.server?.close();
  await pool?.end();
});

test("X-Cache-Tenant attributes request logs; untagged stays NULL", async () => {
  assert.equal((await callMessages({ "x-cache-tenant": "org-alpha" })).status, 200);
  assert.equal((await callMessages()).status, 200);
  await settle();
  const { rows } = await pool.query(
    "SELECT tenant_id FROM request_logs WHERE api_key_id=$1 ORDER BY id", [keyId]);
  assert.deepEqual(rows.map((r) => r.tenant_id), ["org-alpha", null]);
});

test("control headers are consumed, never forwarded upstream", async () => {
  await callMessages({ "x-cache-tenant": "org-alpha", "x-cache-warm-slot": "u1" });
  const h = mock.state.headers.at(-1)!;
  assert.equal(h["x-cache-tenant"], undefined);
  assert.equal(h["x-cache-warm-slot"], undefined);
});

test("malformed tenant ids fail open (untagged, request still 200)", async () => {
  const res = await callMessages({ "x-cache-tenant": "bad tenant!!/" });
  assert.equal(res.status, 200);
  await settle();
  const { rows } = await pool.query(
    "SELECT tenant_id FROM request_logs WHERE api_key_id=$1 ORDER BY id DESC LIMIT 1", [keyId]);
  assert.equal(rows[0].tenant_id, null);
});

test("tenant policy row turns injection off for that tenant only", async () => {
  const put = await admin("PUT", "/tenants/org-alpha", { auto_cache_control: false });
  assert.equal(put.status, 200);

  await callMessages({ "x-cache-tenant": "org-alpha" });
  assert.ok(!JSON.stringify(mock.state.bodies.at(-1)).includes("cache_control"),
    "org-alpha must not get injected breakpoints");

  await callMessages({ "x-cache-tenant": "org-beta" });
  assert.ok(JSON.stringify(mock.state.bodies.at(-1)).includes("cache_control"),
    "org-beta inherits the key default (injection on)");
});

test("per-request override beats the tenant policy row", async () => {
  await callMessages({ "x-cache-tenant": "org-alpha", "x-cache-injection": "on" });
  assert.ok(JSON.stringify(mock.state.bodies.at(-1)).includes("cache_control"));
  await callMessages({ "x-cache-tenant": "org-beta", "x-cache-injection": "off" });
  assert.ok(!JSON.stringify(mock.state.bodies.at(-1)).includes("cache_control"));
});

test("X-Cache-Ttl override lands on injected markers", async () => {
  await callMessages({ "x-cache-tenant": "org-beta", "x-cache-ttl": "1h" });
  const s = JSON.stringify(mock.state.bodies.at(-1));
  assert.ok(s.includes('"ttl":"1h"'), `expected 1h markers, got: ${s.slice(0, 200)}`);
});

test("warm slots: header keepalive opt-in creates per-tenant slot rows", async () => {
  // key-level keepalive is OFF — the header opts this tenant's slot in
  await callMessages({
    "x-cache-tenant": "org-alpha", "x-cache-warm-slot": "user-1", "x-cache-keepalive": "on",
  });
  // no keepalive intent → no slot row
  await callMessages({ "x-cache-tenant": "org-gamma" });
  await settle();
  const { rows } = await pool.query(
    "SELECT tenant_id, slot, header_keepalive FROM keepalive_state WHERE api_key_id=$1 ORDER BY tenant_id, slot",
    [keyId]);
  assert.deepEqual(rows, [{ tenant_id: "org-alpha", slot: "user-1", header_keepalive: true }]);
});

test("tenant policy keepalive=false wins over a key-level ON", async () => {
  await pool.query("UPDATE api_keys SET keepalive_enabled=true WHERE id=$1", [keyId]);
  clearApiKeyCache();
  await admin("PUT", "/tenants/org-quiet", { keepalive_enabled: false });
  await callMessages({ "x-cache-tenant": "org-quiet", "x-cache-warm-slot": "u9" });
  await settle();
  const { rows } = await pool.query(
    "SELECT 1 FROM keepalive_state WHERE api_key_id=$1 AND tenant_id='org-quiet'", [keyId]);
  assert.equal(rows.length, 0, "policy off → no warm slot saved");
  await pool.query("UPDATE api_keys SET keepalive_enabled=false WHERE id=$1", [keyId]);
  clearApiKeyCache();
});

test("slot cap prunes to the most recent N slots", async () => {
  await admin("PUT", "/tenants/org-slots", { keepalive_max_slots: 2 });
  for (const slot of ["s1", "s2", "s3"]) {
    await callMessages({
      "x-cache-tenant": "org-slots", "x-cache-warm-slot": slot, "x-cache-keepalive": "on",
    });
    await settle();
  }
  const { rows } = await pool.query(
    "SELECT slot FROM keepalive_state WHERE api_key_id=$1 AND tenant_id='org-slots' ORDER BY slot",
    [keyId]);
  assert.deepEqual(rows.map((r) => r.slot), ["s2", "s3"]);
});

test("sweep pings per-tenant slots, attributes pings, honors tenant budget", async () => {
  // org-alpha/user-1 exists from above with header keepalive on.
  // org-broke gets a slot but a zero budget → never pinged.
  await admin("PUT", "/tenants/org-broke", { keepalive_budget_usd_daily: 0 });
  await callMessages({
    "x-cache-tenant": "org-broke", "x-cache-warm-slot": "u1", "x-cache-keepalive": "on",
  });
  await settle();

  const before = mock.state.bodies.length;
  const pinged = await keepaliveSweep({
    pool, upstreamUrl: mock.url, encryptionKey: ENC_KEY,
    now: () => Date.now() + PING_AFTER_MS + 1_000,
  });
  assert.equal(pinged, 1, "only org-alpha's slot pings; org-broke is budget-blocked");
  assert.equal(mock.state.bodies.length, before + 1);
  assert.equal(mock.state.bodies.at(-1).max_tokens, 1);

  await settle();
  const { rows } = await pool.query(
    `SELECT tenant_id FROM request_logs
      WHERE api_key_id=$1 AND is_keepalive ORDER BY id DESC LIMIT 1`, [keyId]);
  assert.equal(rows[0].tenant_id, "org-alpha");
});

test("header OFF beats tenant policy ON — and neutralizes an existing warm slot", async () => {
  // tenant policy says keepalive on (e.g. the org default a platform pushed)…
  await admin("PUT", "/tenants/org-mixed", { keepalive_enabled: true });
  await callMessages({
    "x-cache-tenant": "org-mixed", "x-cache-warm-slot": "u1", "x-cache-keepalive": "on",
  });
  await settle();
  let rows = (await pool.query(
    "SELECT header_keepalive FROM keepalive_state WHERE api_key_id=$1 AND tenant_id='org-mixed'",
    [keyId])).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].header_keepalive, true);

  // …but this user turned it off — the slot must stop warming immediately
  await callMessages({
    "x-cache-tenant": "org-mixed", "x-cache-warm-slot": "u1", "x-cache-keepalive": "off",
  });
  await settle();
  rows = (await pool.query(
    "SELECT header_keepalive FROM keepalive_state WHERE api_key_id=$1 AND tenant_id='org-mixed'",
    [keyId])).rows;
  assert.equal(rows[0].header_keepalive, false, "existing slot neutralized by the off-header");

  const pinged = await keepaliveSweep({
    pool, upstreamUrl: mock.url, encryptionKey: ENC_KEY,
    now: () => Date.now() + PING_AFTER_MS + 1_000,
  });
  const { rows: after } = await pool.query(
    "SELECT last_ping_at FROM keepalive_state WHERE api_key_id=$1 AND tenant_id='org-mixed'",
    [keyId]);
  assert.equal(after[0].last_ping_at, null,
    `sweep must skip the opted-out slot (header beats tenant policy; pinged=${pinged})`);
  await admin("DELETE", "/tenants/org-mixed");
});

test("tenant hold command holds ONE user's slot — works with keep-warm off, denied when policy forbids", async () => {
  // keep-warm off everywhere for tenant org-hold; the chat command itself opts in
  const res = await callMessages(
    { "x-cache-tenant": "org-hold", "x-cache-warm-slot": "user-h1", "x-cache-keepalive": "off" },
    {
      model: "claude-sonnet-4-5",
      max_tokens: 16,
      system: [{ type: "text", text: BIG, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "캐시 45분 유지해" }],
    }
  );
  assert.equal(res.status, 200);
  const reply = JSON.stringify(await res.json());
  assert.ok(reply.includes("🔥"), `expected hold confirmation, got: ${reply.slice(0, 200)}`);
  const { rows } = await pool.query(
    `SELECT slot, header_keepalive, hold_until FROM keepalive_state
      WHERE api_key_id=$1 AND tenant_id='org-hold'`, [keyId]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].slot, "user-h1");
  assert.equal(rows[0].header_keepalive, true, "hold command is the opt-in");
  assert.ok(new Date(rows[0].hold_until).getTime() > Date.now() + 40 * 60 * 1000);

  // the held slot pings even though nothing else enables keepalive
  const pinged = await keepaliveSweep({
    pool, upstreamUrl: mock.url, encryptionKey: ENC_KEY,
    now: () => Date.now() + PING_AFTER_MS + 1_000,
  });
  assert.ok(pinged >= 1, "held slot must be pinged");
  await settle();
  const { rows: logged } = await pool.query(
    `SELECT tenant_id FROM request_logs WHERE api_key_id=$1 AND is_keepalive
      ORDER BY id DESC LIMIT 1`, [keyId]);
  assert.equal(logged[0].tenant_id, "org-hold");

  // an org admin who explicitly forbids warming also blocks the hold command
  await admin("PUT", "/tenants/org-forbid", { keepalive_enabled: false });
  const denied = await callMessages(
    { "x-cache-tenant": "org-forbid", "x-cache-warm-slot": "u1" },
    { model: "claude-sonnet-4-5", max_tokens: 16, messages: [{ role: "user", content: "cai:hold 2h" }] }
  );
  const deniedReply = JSON.stringify(await denied.json());
  assert.ok(!deniedReply.includes("🔥"), "policy off → hold denied");
  await admin("DELETE", "/tenants/org-hold");
  await admin("DELETE", "/tenants/org-forbid");
});

test("admin hold API sets/clears a slot hold without a chat body", async () => {
  // seed a saved conversation for user-a1 (keepalive on so the prefix is stored)
  await callMessages({
    "x-cache-tenant": "org-adminhold", "x-cache-warm-slot": "user-a1", "x-cache-keepalive": "on",
  });
  await settle();

  // hold via the management API — no chat round-trip
  const res = await admin("POST", "/tenants/org-adminhold/hold", { slot: "user-a1", hold_ms: 45 * 60_000 });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.held, 1);
  const { rows } = await pool.query(
    `SELECT header_keepalive, hold_until FROM keepalive_state
      WHERE api_key_id=$1 AND tenant_id='org-adminhold' AND slot='user-a1'`, [keyId]);
  assert.equal(rows[0].header_keepalive, true);
  assert.ok(new Date(rows[0].hold_until).getTime() > Date.now() + 40 * 60_000);

  // unknown slot → held: 0 (nothing saved to hold)
  const none = await admin("POST", "/tenants/org-adminhold/hold", { slot: "user-none", hold_ms: 60_000 });
  assert.equal((await none.json()).held, 0);

  // hold_ms=0 releases the hold — fail-closed (off until the next opted-in request)
  const clear = await admin("POST", "/tenants/org-adminhold/hold", { slot: "user-a1", hold_ms: 0 });
  assert.equal((await clear.json()).cleared, 1);
  const { rows: after } = await pool.query(
    `SELECT header_keepalive, hold_until FROM keepalive_state
      WHERE api_key_id=$1 AND tenant_id='org-adminhold' AND slot='user-a1'`, [keyId]);
  assert.equal(after[0].hold_until, null);
  assert.equal(after[0].header_keepalive, false);

  // policy ban blocks the admin hold like the chat command
  await admin("PUT", "/tenants/org-adminhold", { keepalive_enabled: false });
  const denied = await admin("POST", "/tenants/org-adminhold/hold", { slot: "user-a1", hold_ms: 60_000 });
  assert.equal(denied.status, 403);
  // validation
  assert.equal((await admin("POST", "/tenants/org-adminhold/hold", { slot: "bad slot!", hold_ms: 1 })).status, 400);
  assert.equal((await admin("POST", "/tenants/org-adminhold/hold", { slot: "user-a1", hold_ms: -1 })).status, 400);
  await admin("DELETE", "/tenants/org-adminhold");
});

test("X-Cache-Hold-Ms rides a normal request: captures + holds even with keepalive off", async () => {
  // the platform layer says "this user has an active hold" while the
  // preference header still says off — the hold must win
  const res = await callMessages(
    {
      "x-cache-tenant": "org-holdhdr", "x-cache-warm-slot": "user-hh1",
      "x-cache-keepalive": "off", "x-cache-hold-ms": String(50 * 60_000),
    },
    {
      model: "claude-sonnet-4-5",
      max_tokens: 16,
      system: [{ type: "text", text: BIG, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "please refactor the auth module" }],
    }
  );
  assert.equal(res.status, 200);
  // forwarded upstream as a NORMAL request (not swallowed like a chat hold)
  assert.ok(JSON.stringify(mock.state.bodies.at(-1)).includes("refactor the auth module"));
  const h = mock.state.headers.at(-1)!;
  assert.equal(h["x-cache-hold-ms"], undefined, "control header never forwarded");
  await settle();
  const { rows } = await pool.query(
    `SELECT header_keepalive, hold_until FROM keepalive_state
      WHERE api_key_id=$1 AND tenant_id='org-holdhdr' AND slot='user-hh1'`, [keyId]);
  assert.equal(rows.length, 1, "hold header must capture the prefix despite keepalive=off");
  assert.equal(rows[0].header_keepalive, true);
  assert.ok(new Date(rows[0].hold_until).getTime() > Date.now() + 45 * 60_000);

  // held slot is swept
  const pinged = await keepaliveSweep({
    pool, upstreamUrl: mock.url, encryptionKey: ENC_KEY,
    now: () => Date.now() + PING_AFTER_MS + 1_000,
  });
  assert.ok(pinged >= 1, "held slot must be pinged");

  // tenant-policy ban still blocks the hold header
  await admin("PUT", "/tenants/org-holdban", { keepalive_enabled: false });
  await callMessages({
    "x-cache-tenant": "org-holdban", "x-cache-warm-slot": "u1",
    "x-cache-hold-ms": String(10 * 60_000),
  });
  await settle();
  const { rows: banned } = await pool.query(
    "SELECT 1 FROM keepalive_state WHERE api_key_id=$1 AND tenant_id='org-holdban'", [keyId]);
  assert.equal(banned.length, 0, "policy off → hold header ignored");
  await admin("DELETE", "/tenants/org-holdhdr");
  await admin("DELETE", "/tenants/org-holdban");
});

test("active hold survives subsequent keepalive=off traffic; release doesn't resurrect warming", async () => {
  // keep-warm-off user gets a slot via one opted-in request, then goes off
  await callMessages({
    "x-cache-tenant": "org-survive", "x-cache-warm-slot": "u1", "x-cache-keepalive": "on",
  });
  await settle();
  const hold = await admin("POST", "/tenants/org-survive/hold", { slot: "u1", hold_ms: 2 * 60 * 60_000 });
  assert.equal((await hold.json()).held, 1);

  // the user's next ordinary message (pref off, no hold header) must NOT kill the hold
  await callMessages({
    "x-cache-tenant": "org-survive", "x-cache-warm-slot": "u1", "x-cache-keepalive": "off",
  });
  await settle();
  let { rows } = await pool.query(
    `SELECT header_keepalive, hold_until FROM keepalive_state
      WHERE api_key_id=$1 AND tenant_id='org-survive' AND slot='u1'`, [keyId]);
  assert.equal(rows[0].header_keepalive, true, "off traffic must not neutralize an active hold");
  assert.ok(new Date(rows[0].hold_until).getTime() > Date.now());

  // release with an org policy that says ON — the user's slot must stay off
  await admin("PUT", "/tenants/org-survive", { keepalive_enabled: true });
  await admin("POST", "/tenants/org-survive/hold", { slot: "u1", hold_ms: 0 });
  rows = (await pool.query(
    `SELECT header_keepalive, hold_until FROM keepalive_state
      WHERE api_key_id=$1 AND tenant_id='org-survive' AND slot='u1'`, [keyId])).rows;
  assert.equal(rows[0].hold_until, null);
  assert.equal(rows[0].header_keepalive, false, "release fails closed — policy ON must not resurrect warming");
  const pinged = await keepaliveSweep({
    pool, upstreamUrl: mock.url, encryptionKey: ENC_KEY,
    now: () => Date.now() + PING_AFTER_MS + 1_000,
  });
  const { rows: after } = await pool.query(
    `SELECT last_ping_at FROM keepalive_state
      WHERE api_key_id=$1 AND tenant_id='org-survive' AND slot='u1'`, [keyId]);
  assert.equal(after[0].last_ping_at, null, `released slot must not ping (pinged=${pinged})`);
  await admin("DELETE", "/tenants/org-survive");
});

test("management API: list, get, 404, delete (delete also stops warming)", async () => {
  const list = await admin("GET", "/tenants");
  assert.equal(list.status, 200);
  const tenants = (await list.json()).tenants.map((t: any) => t.tenant);
  assert.ok(tenants.includes("org-alpha") && tenants.includes("org-slots"));

  const one = await admin("GET", "/tenants/org-alpha");
  assert.equal(one.status, 200);
  assert.equal((await one.json()).auto_cache_control, false);

  assert.equal((await admin("GET", "/tenants/org-nope")).status, 404);
  assert.equal((await admin("PUT", "/tenants/bad id!", { keepalive_enabled: true })).status, 400);
  assert.equal((await admin("PUT", "/tenants/org-x", { anthropic_cache_ttl: "2h" })).status, 400);

  const del = await admin("DELETE", "/tenants/org-slots");
  assert.equal(del.status, 200);
  const { rows } = await pool.query(
    "SELECT 1 FROM keepalive_state WHERE api_key_id=$1 AND tenant_id='org-slots'", [keyId]);
  assert.equal(rows.length, 0, "offboarding a tenant drops its warm slots");
});

test("management API auth: no key and wrong key are rejected", async () => {
  const noAuth = await fetch(`${proxyUrl}/admin/v1/tenants`);
  assert.equal(noAuth.status, 401);
  const badKey = await fetch(`${proxyUrl}/admin/v1/tenants`, {
    headers: { "x-api-key": "ck_" + "0".repeat(40) },
  });
  assert.equal(badKey.status, 401);
});

test("tenant stats aggregate that tenant's traffic only", async () => {
  const res = await admin("GET", "/tenants/org-alpha/stats?days=7");
  assert.equal(res.status, 200);
  const stats = await res.json();
  assert.ok(stats.requests >= 2, `org-alpha requests: ${stats.requests}`);
  assert.ok(stats.warming_pings >= 1, "the sweep ping above is attributed");
  assert.ok(stats.cache_read_tokens > 0);
});

test("gateway upstream: allowlisted only; traffic and pings follow it with replayed headers", async () => {
  const deny = await admin("PUT", "/gateway", { upstream_gateway_url: "https://evil.example.com" });
  assert.equal(deny.status, 403);

  // gateways issue their own credential formats — set it per key alongside the URL
  const ok = await admin("PUT", "/gateway", {
    upstream_gateway_url: gatewayMock.url, anthropic_key: "sk-br-GATEWAY-CRED",
  });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).anthropic_key_set, true);
  clearApiKeyCache();

  const res = await callMessages({
    "x-cache-tenant": "org-gw",
    "x-cache-warm-slot": "u1",
    "x-cache-keepalive": "on",
    "x-usage-group": "customer-42",
  });
  assert.equal(res.status, 200);
  assert.equal(gatewayMock.state.keys.at(-1), "sk-br-GATEWAY-CRED",
    "traffic reached the gateway with the per-key gateway credential");
  assert.equal(gatewayMock.state.headers.at(-1)!["x-usage-group"], "customer-42");
  await settle();

  const before = gatewayMock.state.bodies.length;
  const pinged = await keepaliveSweep({
    pool, upstreamUrl: mock.url, encryptionKey: ENC_KEY,
    now: () => Date.now() + PING_AFTER_MS + 1_000,
  });
  assert.ok(pinged >= 1);
  assert.ok(gatewayMock.state.bodies.length > before, "ping went to the gateway, not the default upstream");
  assert.equal(gatewayMock.state.headers.at(-1)!["x-usage-group"], "customer-42",
    "ping replays the captured attribution header");

  const off = await admin("DELETE", "/gateway");
  assert.equal(off.status, 200);
  clearApiKeyCache();
  clearTenantPolicyCache();
});
