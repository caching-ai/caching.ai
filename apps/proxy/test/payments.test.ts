import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { Hono } from "hono";
import { serve, type ServerType } from "@hono/node-server";
import { migrate, setPool, sha256Hex, encrypt, generateApiKey } from "@caching/shared";
import { buildApp } from "../src/app.js";
import { billingSweep } from "../src/billing.js";
import { chargeSweep, retryFailedCharges, dunningSweep } from "../src/charge.js";
import { weeklyStatsFor } from "../src/emailReport.js";
import { startMockOpenAI } from "./mock-providers.js";

// tests flip key flags via direct SQL — the hot-path key cache must not mask that
process.env.KEY_CACHE_TTL_MS = "0";

const DB_URL = process.env.TEST_DATABASE_URL_PAYMENTS ?? "postgres://localhost:5432/caching_ai_test3";
const ENC_KEY = "d".repeat(64);
const here = dirname(fileURLToPath(import.meta.url));

let pool: pg.Pool;
let servers: ServerType[] = [];
let proxyUrl: string;
let openaiState: Awaited<ReturnType<typeof startMockOpenAI>>["state"];

// ---- mock PSPs ----
interface PspState {
  stripeCalls: { path: string; body: URLSearchParams; idempotency: string }[];
  tossCalls: { path: string; body: any; auth: string }[];
  stripeFail: boolean;
}
const psp: PspState = { stripeCalls: [], tossCalls: [], stripeFail: false };
let stripeUrl = "";
let tossUrl = "";

function startMockStripe(port: number): Promise<ServerType> {
  const app = new Hono();
  app.post("/v1/payment_intents", async (c) => {
    psp.stripeCalls.push({
      path: c.req.path,
      body: new URLSearchParams(await c.req.text()),
      idempotency: c.req.header("idempotency-key") ?? "",
    });
    if (psp.stripeFail) return c.json({ error: { message: "card declined" } }, 402);
    return c.json({ id: "pi_mock_1", status: "succeeded" });
  });
  return new Promise((resolve) => {
    const s = serve({ fetch: app.fetch, port }, () => resolve(s));
  });
}

function startMockToss(port: number): Promise<ServerType> {
  const app = new Hono();
  app.post("/v1/billing/:key", async (c) => {
    psp.tossCalls.push({
      path: c.req.path,
      body: await c.req.json(),
      auth: c.req.header("authorization") ?? "",
    });
    return c.json({ paymentKey: "tosspay_mock_1", status: "DONE" });
  });
  return new Promise((resolve) => {
    const s = serve({ fetch: app.fetch, port }, () => resolve(s));
  });
}

async function newUser(email: string): Promise<number> {
  const u = await pool.query("INSERT INTO users(email, password_hash) VALUES($1,'x') RETURNING id", [email]);
  return u.rows[0].id;
}

// closed period helper: last month, accruing, with a chosen fee
async function insertClosedPeriod(userId: number, feeUsd: number): Promise<string> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const startStr = start.toISOString().slice(0, 10);
  await pool.query(
    `INSERT INTO billing_periods(user_id, period_start, period_end, gross_saved_usd,
       keepalive_cost_usd, net_saved_usd, fee_usd, fee_rate, status)
     VALUES($1,$2,$3,$4,0,$4,$5,0.2,'accruing')`,
    [userId, startStr, end.toISOString().slice(0, 10), feeUsd * 5, feeUsd]
  );
  return startStr;
}

before(async () => {
  pool = new pg.Pool({ connectionString: DB_URL });
  setPool(pool);
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(join(here, "../../../packages/shared/migrations"), DB_URL);

  const openai = await startMockOpenAI(45891);
  openaiState = openai.state;
  servers.push(openai.server);
  servers.push(await startMockStripe(45892));
  servers.push(await startMockToss(45893));
  stripeUrl = "http://127.0.0.1:45892";
  tossUrl = "http://127.0.0.1:45893";

  const app = buildApp({
    pool,
    upstreamUrl: "http://127.0.0.1:1", // anthropic unused here
    openaiUpstreamUrl: openai.url,
    encryptionKey: ENC_KEY,
  });
  await new Promise<void>((resolve) => {
    servers.push(serve({ fetch: app.fetch, port: 45894 }, () => resolve()));
  });
  proxyUrl = "http://127.0.0.1:45894";
});

after(async () => {
  servers.forEach((s) => s.close());
  await pool?.end();
});

test("account-level provider key: ck key with no per-key override uses the user default", async () => {
  const userId = await newUser("acct-fallback@t.co");
  const ck = generateApiKey();
  await pool.query(
    "INSERT INTO api_keys(user_id, key_hash, key_prefix_display) VALUES($1,$2,'ck_…')",
    [userId, sha256Hex(ck)]
  );
  await pool.query(
    "INSERT INTO user_provider_keys(user_id, provider, key_encrypted) VALUES($1,'openai',$2)",
    [userId, encrypt("sk-account-default", ENC_KEY)]
  );

  const res = await fetch(`${proxyUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ck}` },
    body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
  });
  assert.equal(res.status, 200);
  assert.equal(openaiState.authHeaders.at(-1), "Bearer sk-account-default");
});

test("per-key override beats the account default", async () => {
  const userId = await newUser("acct-override@t.co");
  const ck = generateApiKey();
  await pool.query(
    "INSERT INTO api_keys(user_id, key_hash, key_prefix_display, openai_key_encrypted) VALUES($1,$2,'ck_…',$3)",
    [userId, sha256Hex(ck), encrypt("sk-per-key-override", ENC_KEY)]
  );
  await pool.query(
    "INSERT INTO user_provider_keys(user_id, provider, key_encrypted) VALUES($1,'openai',$2)",
    [userId, encrypt("sk-account-default", ENC_KEY)]
  );

  const res = await fetch(`${proxyUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ck}` },
    body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
  });
  assert.equal(res.status, 200);
  assert.equal(openaiState.authHeaders.at(-1), "Bearer sk-per-key-override");
});

test("missing everywhere still 403s with humanized error", async () => {
  const userId = await newUser("acct-none@t.co");
  const ck = generateApiKey();
  await pool.query(
    "INSERT INTO api_keys(user_id, key_hash, key_prefix_display) VALUES($1,$2,'ck_…')",
    [userId, sha256Hex(ck)]
  );
  const res = await fetch(`${proxyUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ck}` },
    body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
  });
  assert.equal(res.status, 403);
  const j = await res.json();
  assert.match(j.error.message, /No OpenAI API key is registered/);
});

test("billingSweep live flag: accruing when live, beta_waived otherwise", async () => {
  const userId = await newUser("sweep-live@t.co");
  const ck = generateApiKey();
  const k = await pool.query(
    "INSERT INTO api_keys(user_id, key_hash, key_prefix_display) VALUES($1,$2,'ck_…') RETURNING id",
    [userId, sha256Hex(ck)]
  );
  await pool.query(
    `INSERT INTO request_logs(api_key_id, provider, model, status, saved_usd, cost_usd)
     VALUES($1,'openai','gpt-4o',200, 42, 1)`,
    [k.rows[0].id]
  );
  await billingSweep(pool, new Date(), true);
  const { rows } = await pool.query(
    "SELECT status, fee_usd FROM billing_periods WHERE user_id=$1", [userId]
  );
  assert.equal(rows[0].status, "accruing");
  assert.ok(Math.abs(Number(rows[0].fee_usd) - 42 * 0.2) < 1e-9);
});

test("billingSweep: going live flips an existing beta_waived period to accruing, but never a terminal status", async () => {
  const userId = await newUser("sweep-flip@t.co");
  const ck = generateApiKey();
  const k = await pool.query(
    "INSERT INTO api_keys(user_id, key_hash, key_prefix_display) VALUES($1,$2,'ck_…') RETURNING id",
    [userId, sha256Hex(ck)]
  );
  await pool.query(
    `INSERT INTO request_logs(api_key_id, provider, model, status, saved_usd, cost_usd)
     VALUES($1,'openai','gpt-4o',200, 10, 1)`,
    [k.rows[0].id]
  );
  // period created while beta (live=false)…
  await billingSweep(pool, new Date(), false);
  let { rows } = await pool.query("SELECT status FROM billing_periods WHERE user_id=$1", [userId]);
  assert.equal(rows[0].status, "beta_waived");
  // …then BILLING_LIVE=1 is set: the open period must start accruing
  await billingSweep(pool, new Date(), true);
  ({ rows } = await pool.query("SELECT status FROM billing_periods WHERE user_id=$1", [userId]));
  assert.equal(rows[0].status, "accruing");
  // terminal statuses set by the charge sweep are never clobbered
  await pool.query("UPDATE billing_periods SET status='paid' WHERE user_id=$1", [userId]);
  await billingSweep(pool, new Date(), true);
  ({ rows } = await pool.query("SELECT status FROM billing_periods WHERE user_id=$1", [userId]));
  assert.equal(rows[0].status, "paid");
});

test("chargeSweep: stripe card charged once, idempotent, period marked paid", async () => {
  const userId = await newUser("charge-stripe@t.co");
  await pool.query(
    `INSERT INTO payment_methods(user_id, psp, stripe_customer_id, stripe_payment_method_id, card_label)
     VALUES($1,'stripe','cus_1','pm_1','visa ····4242')`,
    [userId]
  );
  const periodStart = await insertClosedPeriod(userId, 12.34);

  const deps = {
    pool, encryptionKey: ENC_KEY, stripeSecretKey: "sk_test_x", tossSecretKey: "toss_x",
    stripeUrl, tossUrl, minChargeUsd: 5,
  };
  const n1 = await chargeSweep(deps);
  assert.equal(n1, 1);
  const call = psp.stripeCalls.at(-1)!;
  assert.equal(call.body.get("amount"), "1234"); // cents
  assert.equal(call.body.get("customer"), "cus_1");
  assert.equal(call.body.get("off_session"), "true");
  assert.equal(call.idempotency, `cai-fee-${userId}-${periodStart}`);

  const { rows: periods } = await pool.query(
    "SELECT status FROM billing_periods WHERE user_id=$1", [userId]);
  assert.equal(periods[0].status, "paid");
  const { rows: charges } = await pool.query(
    "SELECT status, psp_ref, charged_amount, currency FROM billing_charges WHERE user_id=$1", [userId]);
  assert.equal(charges[0].status, "paid");
  assert.equal(charges[0].psp_ref, "pi_mock_1");
  assert.equal(charges[0].currency, "USD");

  // second sweep: nothing left in accruing → no new PSP call
  const callsBefore = psp.stripeCalls.length;
  const n2 = await chargeSweep(deps);
  assert.equal(n2, 0);
  assert.equal(psp.stripeCalls.length, callsBefore);
});

test("chargeSweep: toss billing key charged in KRW at the configured rate", async () => {
  const userId = await newUser("charge-toss@t.co");
  await pool.query(
    `INSERT INTO payment_methods(user_id, psp, toss_billing_key_encrypted, toss_customer_key, card_label)
     VALUES($1,'toss',$2,$3,'현대 ····1234')`,
    [userId, encrypt("billing-key-xyz", ENC_KEY), `cai-${userId}`]
  );
  await insertClosedPeriod(userId, 10);

  const n = await chargeSweep({
    pool, encryptionKey: ENC_KEY, tossSecretKey: "toss_sk_x",
    stripeUrl, tossUrl, minChargeUsd: 5, fxKrwPerUsd: 1400,
  });
  assert.equal(n, 1);
  const call = psp.tossCalls.at(-1)!;
  assert.equal(call.path, "/v1/billing/billing-key-xyz");
  assert.equal(call.body.amount, 14000);
  assert.equal(call.body.customerKey, `cai-${userId}`);
  assert.equal(call.auth, "Basic " + Buffer.from("toss_sk_x:").toString("base64"));

  const { rows } = await pool.query(
    "SELECT charged_amount, currency, status FROM billing_charges WHERE user_id=$1", [userId]);
  assert.equal(Number(rows[0].charged_amount), 14000);
  assert.equal(rows[0].currency, "KRW");
  assert.equal(rows[0].status, "paid");
});

test("chargeSweep: fee under minimum is waived, no PSP call", async () => {
  const userId = await newUser("charge-min@t.co");
  await pool.query(
    `INSERT INTO payment_methods(user_id, psp, stripe_customer_id, stripe_payment_method_id)
     VALUES($1,'stripe','cus_2','pm_2')`,
    [userId]
  );
  await insertClosedPeriod(userId, 3.99);
  const callsBefore = psp.stripeCalls.length;
  await chargeSweep({ pool, encryptionKey: ENC_KEY, stripeSecretKey: "sk", stripeUrl, tossUrl, minChargeUsd: 5 });
  assert.equal(psp.stripeCalls.length, callsBefore);
  const { rows } = await pool.query("SELECT status FROM billing_periods WHERE user_id=$1", [userId]);
  assert.equal(rows[0].status, "waived_min");
});

test("chargeSweep: no card on file → no_payment_method, retried when card appears", async () => {
  const userId = await newUser("charge-nopm@t.co");
  await insertClosedPeriod(userId, 20);
  const deps = { pool, encryptionKey: ENC_KEY, stripeSecretKey: "sk", stripeUrl, tossUrl, minChargeUsd: 5 };
  await chargeSweep(deps);
  let { rows } = await pool.query("SELECT status FROM billing_periods WHERE user_id=$1", [userId]);
  assert.equal(rows[0].status, "no_payment_method");

  await pool.query(
    `INSERT INTO payment_methods(user_id, psp, stripe_customer_id, stripe_payment_method_id)
     VALUES($1,'stripe','cus_3','pm_3')`,
    [userId]
  );
  const n = await chargeSweep(deps);
  assert.equal(n, 1);
  ({ rows } = await pool.query("SELECT status FROM billing_periods WHERE user_id=$1", [userId]));
  assert.equal(rows[0].status, "paid");
});

test("chargeSweep: declined card → charge_failed; the charge sweep itself never re-attempts (the 72h retry sweep does)", async () => {
  const userId = await newUser("charge-fail@t.co");
  await pool.query(
    `INSERT INTO payment_methods(user_id, psp, stripe_customer_id, stripe_payment_method_id)
     VALUES($1,'stripe','cus_4','pm_4')`,
    [userId]
  );
  await insertClosedPeriod(userId, 30);
  psp.stripeFail = true;
  const deps = { pool, encryptionKey: ENC_KEY, stripeSecretKey: "sk", stripeUrl, tossUrl, minChargeUsd: 5 };
  const n = await chargeSweep(deps);
  psp.stripeFail = false;
  assert.equal(n, 0);
  const { rows } = await pool.query("SELECT status FROM billing_periods WHERE user_id=$1", [userId]);
  assert.equal(rows[0].status, "charge_failed");
  const { rows: charges } = await pool.query(
    "SELECT status, error FROM billing_charges WHERE user_id=$1", [userId]);
  assert.equal(charges[0].status, "failed");
  assert.match(charges[0].error, /card declined/);

  // the claim row blocks automatic retries
  const callsBefore = psp.stripeCalls.length;
  await chargeSweep(deps);
  assert.equal(psp.stripeCalls.length, callsBefore);
});

test("weekly report: opted-out users are excluded", async () => {
  const userId = await newUser("optout@t.co");
  const ck = generateApiKey();
  const k = await pool.query(
    "INSERT INTO api_keys(user_id, key_hash, key_prefix_display) VALUES($1,$2,'ck_…') RETURNING id",
    [userId, sha256Hex(ck)]
  );
  await pool.query(
    `INSERT INTO request_logs(api_key_id, provider, model, status, saved_usd) VALUES($1,'openai','gpt-4o',200,1)`,
    [k.rows[0].id]
  );
  let stats = await weeklyStatsFor(pool);
  assert.ok(stats.some((s) => s.userId === userId));

  await pool.query("UPDATE users SET report_opt_out=true WHERE id=$1", [userId]);
  stats = await weeklyStatsFor(pool);
  assert.ok(!stats.some((s) => s.userId === userId));
});


// ---------- dunning: retry → pause → auto-restore ----------

test("retryFailedCharges: declined card recovers on the 72h retry", async () => {
  const userId = await newUser("dunning-retry@t.co");
  await pool.query(
    `INSERT INTO payment_methods(user_id, psp, stripe_customer_id, stripe_payment_method_id)
     VALUES($1,'stripe','cus_r1','pm_r1')`,
    [userId]
  );
  await insertClosedPeriod(userId, 25);
  psp.stripeFail = true;
  const deps = { pool, encryptionKey: ENC_KEY, stripeSecretKey: "sk", stripeUrl, tossUrl, minChargeUsd: 5 };
  await chargeSweep(deps);
  psp.stripeFail = false;

  // too early: nothing happens
  assert.equal(await retryFailedCharges(deps), 0);

  // 73h later the retry fires and succeeds
  const later = new Date(Date.now() + 73 * 3600_000);
  const n = await retryFailedCharges({ ...deps, now: () => later });
  assert.ok(n >= 1, "this user's charge must be among the recovered");
  const { rows } = await pool.query(
    "SELECT status FROM billing_periods WHERE user_id=$1", [userId]);
  assert.equal(rows[0].status, "paid");
  const { rows: ch } = await pool.query(
    "SELECT status, attempts FROM billing_charges WHERE user_id=$1", [userId]);
  assert.equal(ch[0].status, "paid");
  assert.equal(ch[0].attempts, 2);
});

test("retryFailedCharges: stops after max attempts", async () => {
  const userId = await newUser("dunning-max@t.co");
  await pool.query(
    `INSERT INTO payment_methods(user_id, psp, stripe_customer_id, stripe_payment_method_id)
     VALUES($1,'stripe','cus_r2','pm_r2')`,
    [userId]
  );
  const periodStart = await insertClosedPeriod(userId, 25);
  await pool.query(
    `INSERT INTO billing_charges(user_id, period_start, amount_usd, charged_amount, currency, psp, status, attempts, last_attempt_at)
     VALUES($1,$2::date,25,25,'USD','stripe','failed',4, now() - interval '10 days')`,
    [userId, periodStart]
  );
  const callsBefore = psp.stripeCalls.length;
  const deps = { pool, encryptionKey: ENC_KEY, stripeSecretKey: "sk", stripeUrl, tossUrl };
  assert.equal(await retryFailedCharges({ ...deps, now: () => new Date(Date.now() + 30 * 86400_000) }), 0);
  assert.equal(psp.stripeCalls.length, callsBefore, "exhausted charges are left to dunning");
});

test("dunning: past-grace delinquency pauses optimization, payment auto-restores it", async () => {
  process.env.KEY_CACHE_TTL_MS = "0";
  const userId = await newUser("dunning-lock@t.co");
  const ck = generateApiKey();
  await pool.query(
    `INSERT INTO api_keys(user_id, key_hash, key_prefix_display, auto_cache_control, openai_key_encrypted)
     VALUES($1,$2,'ck_…',true,$3)`,
    [userId, sha256Hex(ck), encrypt("sk-openai-x", ENC_KEY)]
  );
  // delinquent: charge_failed, closed ~19 days ago (insertClosedPeriod = last month), fee $30 ≥ $10
  const periodStart = await insertClosedPeriod(userId, 30);
  await pool.query(
    "UPDATE billing_periods SET status='charge_failed' WHERE user_id=$1", [userId]);

  const deps = { pool, encryptionKey: ENC_KEY, stripeUrl, tossUrl };
  const d1 = await dunningSweep(deps);
  assert.ok(d1.locked >= 1);
  let { rows } = await pool.query("SELECT billing_locked FROM users WHERE id=$1", [userId]);
  assert.equal(rows[0].billing_locked, true);

  // locked → gpt-5.6 request passes through with NO injection
  const BIG = "You are a precise assistant. ".repeat(200);
  await fetch(`${proxyUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ck}` },
    body: JSON.stringify({ model: "gpt-5.6-sol", messages: [{ role: "system", content: BIG }, { role: "user", content: "q" }] }),
  });
  assert.equal(openaiState.bodies.at(-1).prompt_cache_key, undefined, "locked account: no injection");

  // payment clears → unlocked on the next sweep, injection resumes
  await pool.query("UPDATE billing_periods SET status='paid' WHERE user_id=$1 AND period_start=$2::date",
    [userId, periodStart]);
  const d2 = await dunningSweep(deps);
  assert.ok(d2.unlocked >= 1);
  ({ rows } = await pool.query("SELECT billing_locked FROM users WHERE id=$1", [userId]));
  assert.equal(rows[0].billing_locked, false);
  await fetch(`${proxyUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ck}` },
    body: JSON.stringify({ model: "gpt-5.6-sol", messages: [{ role: "system", content: BIG }, { role: "user", content: "q2" }] }),
  });
  assert.match(openaiState.bodies.at(-1).prompt_cache_key ?? "", /^cai-/, "restored account: injection back on");
});

test("dunning: within the grace window nothing is paused", async () => {
  const userId = await newUser("dunning-grace@t.co");
  const start = new Date(Date.now() - 20 * 86400_000).toISOString().slice(0, 10);
  const end = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10); // closed 2 days ago
  await pool.query(
    `INSERT INTO billing_periods(user_id, period_start, period_end, gross_saved_usd,
       keepalive_cost_usd, net_saved_usd, fee_usd, fee_rate, status)
     VALUES($1,$2,$3,150,0,150,30,0.2,'charge_failed')`,
    [userId, start, end]
  );
  await dunningSweep({ pool, encryptionKey: ENC_KEY, stripeUrl, tossUrl });
  const { rows } = await pool.query("SELECT billing_locked FROM users WHERE id=$1", [userId]);
  assert.equal(rows[0].billing_locked, false, "grace window must protect the account");
});
