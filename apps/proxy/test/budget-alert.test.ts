import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { Hono } from "hono";
import { serve, type ServerType } from "@hono/node-server";
import { migrate, sha256Hex, generateApiKey } from "@caching/shared";
import { budgetAlertSweep, renderBudgetAlertHtml } from "../src/budgetAlert.js";

const DB_URL = process.env.TEST_DATABASE_URL_ALERTS ?? "postgres://localhost:5432/caching_ai_test4";
const here = dirname(fileURLToPath(import.meta.url));

let pool: pg.Pool;
let resendServer: ServerType;
let resendUrl = "";
const resend = { calls: [] as { to: string[]; subject: string; html: string }[], fail: false };

async function ensureDb() {
  const admin = new pg.Pool({ connectionString: DB_URL.replace(/\/[^/]+$/, "/postgres") });
  const dbName = DB_URL.split("/").pop()!;
  await admin.query(`CREATE DATABASE ${dbName}`).catch(() => {}); // 42P04 = already exists
  await admin.end();
}

async function seedUserWithKey(email: string, opts: {
  optOut?: boolean; budget?: number; spent?: number; pings?: number;
  spendDay?: string; keepalive?: boolean; locale?: string;
}): Promise<{ userId: number; keyId: number }> {
  const u = await pool.query(
    "INSERT INTO users(email, password_hash, locale, report_opt_out) VALUES($1,'x',$2,$3) RETURNING id",
    [email, opts.locale ?? "en", opts.optOut ?? false]
  );
  const k = await pool.query(
    `INSERT INTO api_keys(user_id, name, key_hash, key_prefix_display, keepalive_enabled, keepalive_budget_usd_daily)
     VALUES($1,$2,$3,'ck_…test',$4,$5) RETURNING id`,
    [u.rows[0].id, `key-${email.split("@")[0]}`, sha256Hex(generateApiKey()), opts.keepalive ?? true, opts.budget ?? 1]
  );
  await pool.query(
    `INSERT INTO keepalive_state(api_key_id, provider, encrypted_prefix, last_request_at, pings_today, spend_today_usd, spend_day)
     VALUES($1,'anthropic','enc',now(),$2,$3,$4::date)`,
    [k.rows[0].id, opts.pings ?? 5, opts.spent ?? 0, opts.spendDay ?? new Date().toISOString().slice(0, 10)]
  );
  return { userId: u.rows[0].id, keyId: k.rows[0].id };
}

before(async () => {
  await ensureDb();
  pool = new pg.Pool({ connectionString: DB_URL });
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(join(here, "../../../packages/shared/migrations"), DB_URL);

  const app = new Hono();
  app.post("/emails", async (c) => {
    const body = await c.req.json();
    if (resend.fail) return c.json({ error: "boom" }, 500);
    resend.calls.push({ to: body.to, subject: body.subject, html: body.html });
    return c.json({ id: "mock" });
  });
  resendServer = await new Promise((resolve) => {
    const s = serve({ fetch: app.fetch, port: 45897 }, () => resolve(s));
  });
  resendUrl = "http://127.0.0.1:45897/emails";
});

after(async () => {
  resendServer?.close();
  await pool?.end();
});

const deps = () => ({ pool, resendApiKey: "re_test", resendUrl, unsubscribeSecret: "s".repeat(32) });

test("budget reached → one alert, deduped on the next sweep", async () => {
  await seedUserWithKey("hit@t.dev", { budget: 1, spent: 1.2 });
  assert.equal(await budgetAlertSweep(deps()), 1);
  assert.equal(resend.calls.length, 1);
  assert.deepEqual(resend.calls[0].to, ["hit@t.dev"]);
  assert.match(resend.calls[0].subject, /keep-alive budget/i);
  assert.match(resend.calls[0].html, /console\/keys/);
  assert.match(resend.calls[0].html, /List-Unsubscribe|unsubscribe/i);

  // same day, second sweep: email_log claim blocks a duplicate
  assert.equal(await budgetAlertSweep(deps()), 0);
  assert.equal(resend.calls.length, 1);
});

test("under budget / keepalive off / stale spend day → no alert", async () => {
  const start = resend.calls.length;
  await seedUserWithKey("under@t.dev", { budget: 2, spent: 1.9 });
  await seedUserWithKey("off@t.dev", { budget: 1, spent: 5, keepalive: false });
  await seedUserWithKey("stale@t.dev", { budget: 1, spent: 5, spendDay: "2020-01-01" });
  assert.equal(await budgetAlertSweep(deps()), 0);
  assert.equal(resend.calls.length, start);
});

test("report opt-out users are excluded", async () => {
  const start = resend.calls.length;
  await seedUserWithKey("optout@t.dev", { budget: 1, spent: 3, optOut: true });
  assert.equal(await budgetAlertSweep(deps()), 0);
  assert.equal(resend.calls.length, start);
});

test("send failure releases the claim so a later sweep retries", async () => {
  await seedUserWithKey("retry@t.dev", { budget: 1, spent: 2 });
  resend.fail = true;
  assert.equal(await budgetAlertSweep(deps()), 0);
  resend.fail = false;
  const start = resend.calls.length;
  assert.equal(await budgetAlertSweep(deps()), 1);
  assert.equal(resend.calls.length, start + 1);
});

test("budget is key-level: providers each under budget but summed over → one alert", async () => {
  const { keyId } = await seedUserWithKey("sum@t.dev", { budget: 1, spent: 0.6, pings: 4 });
  await pool.query(
    `INSERT INTO keepalive_state(api_key_id, provider, encrypted_prefix, last_request_at, pings_today, spend_today_usd, spend_day)
     VALUES($1,'openai','enc',now(),3,0.6,$2::date)`,
    [keyId, new Date().toISOString().slice(0, 10)]
  );
  const start = resend.calls.length;
  assert.equal(await budgetAlertSweep(deps()), 1);
  const call = resend.calls[start];
  assert.deepEqual(call.to, ["sum@t.dev"]);
  assert.match(call.html, /\$1\.20/, "spent must be the sum across providers");
  assert.match(call.html, /7 pings/, "pings must be the sum across providers");
});

test("korean locale gets the localized copy, key name is escaped", () => {
  const { subject, html } = renderBudgetAlertHtml({
    userId: 1, email: "k@t.dev", locale: "ko",
    keyId: 9, keyName: '<img src=x onerror=alert(1)>',
    budgetUsd: 1, spentUsd: 1.5, pingsToday: 12,
  });
  assert.match(subject, /워밍 예산에 도달했어요/);
  assert.match(html, /예산 조정하기/);
  assert.ok(!html.includes("<img src=x"), "key name must be escaped in html");
});
