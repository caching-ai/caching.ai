import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { serve, type ServerType } from "@hono/node-server";
import { migrate, setPool, sha256Hex, encrypt, generateApiKey } from "@caching/shared";
import { buildApp } from "../src/app.js";
import { keepaliveSweep, PING_AFTER_MS } from "../src/keepalive.js";
import { clearOrgBudgetCache } from "../src/logic/orgBudget.js";
import { clearApiKeyCache } from "../src/store.js";
import { billingSweep } from "../src/billing.js";
import { startMock, type MockState } from "./mock-anthropic.js";

// org workspaces: shared provider key, policy tiers, budgets, warming dedupe,
// billing separation — the enterprise slice, end to end against a mock upstream

process.env.KEY_CACHE_TTL_MS = "0";

const DB_URL = process.env.TEST_DATABASE_URL_ORG ?? "postgres://localhost:5432/caching_ai_test7";
const ENC_KEY = "a".repeat(64);
const here = dirname(fileURLToPath(import.meta.url));
const BIG = "y".repeat(20_000);

let pool: pg.Pool;
let mock: { server: ServerType; state: MockState; url: string };
let proxyServer: ServerType;
let proxyUrl: string;

let orgId: number;
let ownerId: number;
let memberId: number;
let ownerCk: string;
let memberCk: string;
let ownerKeyId: number;
let memberKeyId: number;
let personalCk: string;

async function callMessages(ck: string, body?: any): Promise<Response> {
  return fetch(`${proxyUrl}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": ck, "content-type": "application/json" },
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

before(async () => {
  pool = new pg.Pool({ connectionString: DB_URL });
  setPool(pool);
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(join(here, "../../../packages/shared/migrations"), DB_URL);

  const owner = await pool.query(
    "INSERT INTO users(email, password_hash) VALUES('owner@org.co','x') RETURNING id");
  ownerId = owner.rows[0].id;
  const member = await pool.query(
    "INSERT INTO users(email, password_hash) VALUES('member@org.co','x') RETURNING id");
  memberId = member.rows[0].id;

  const org = await pool.query(
    "INSERT INTO organizations(name, owner_user_id) VALUES('Acme', $1) RETURNING id", [ownerId]);
  orgId = org.rows[0].id;
  await pool.query(
    "UPDATE users SET org_id=$1, org_role='owner', org_joined_at=now() WHERE id=$2", [orgId, ownerId]);
  await pool.query(
    "UPDATE users SET org_id=$1, org_role='member', org_joined_at=now() WHERE id=$2", [orgId, memberId]);

  await pool.query(
    `INSERT INTO org_provider_keys(org_id, provider, key_encrypted) VALUES($1,'anthropic',$2)`,
    [orgId, encrypt("sk-ant-ORG-KEY", ENC_KEY)]
  );

  ownerCk = generateApiKey();
  memberCk = generateApiKey();
  const ok = await pool.query(
    `INSERT INTO api_keys(user_id, org_id, key_hash, key_prefix_display) VALUES($1,$2,$3,'o…') RETURNING id`,
    [ownerId, orgId, sha256Hex(ownerCk)]
  );
  ownerKeyId = ok.rows[0].id;
  const mk = await pool.query(
    `INSERT INTO api_keys(user_id, org_id, key_hash, key_prefix_display) VALUES($1,$2,$3,'m…') RETURNING id`,
    [memberId, orgId, sha256Hex(memberCk)]
  );
  memberKeyId = mk.rows[0].id;

  // a personal key for the same member: must stay on the PERSONAL provider key
  personalCk = generateApiKey();
  await pool.query(
    `INSERT INTO user_provider_keys(user_id, provider, key_encrypted) VALUES($1,'anthropic',$2)`,
    [memberId, encrypt("sk-ant-PERSONAL-KEY", ENC_KEY)]
  );
  await pool.query(
    `INSERT INTO api_keys(user_id, key_hash, key_prefix_display) VALUES($1,$2,'p…')`,
    [memberId, sha256Hex(personalCk)]
  );

  mock = await startMock(45971);
  const app = buildApp({ pool, upstreamUrl: mock.url, encryptionKey: ENC_KEY });
  await new Promise<void>((resolve) => {
    proxyServer = serve({ fetch: app.fetch, port: 45972 }, () => resolve());
  });
  proxyUrl = "http://127.0.0.1:45972";
});

after(async () => {
  proxyServer?.close();
  mock?.server?.close();
  await pool?.end();
});

test("org keys use the ORG provider key; personal keys the personal one", async () => {
  const r1 = await callMessages(memberCk);
  assert.equal(r1.status, 200);
  assert.equal(mock.state.keys.at(-1), "sk-ant-ORG-KEY");

  const r2 = await callMessages(personalCk);
  assert.equal(r2.status, 200);
  assert.equal(mock.state.keys.at(-1), "sk-ant-PERSONAL-KEY");
});

test("org keys are autopilot by default: cache_control injected", async () => {
  await callMessages(memberCk);
  const body = mock.state.bodies.at(-1);
  assert.ok(JSON.stringify(body).includes("cache_control"), "expected injected breakpoints");
});

test("ENFORCED org policy overrides the key's own injection setting", async () => {
  await pool.query(
    `INSERT INTO org_cache_policies(org_id, scope, auto_cache_control, enforce)
     VALUES($1,'org',false,true)`,
    [orgId]
  );
  clearApiKeyCache();
  await callMessages(memberCk);
  assert.ok(!JSON.stringify(mock.state.bodies.at(-1)).includes("cache_control"),
    "enforced org policy should disable injection");

  // member-tier policy wins over the org tier
  await pool.query(
    `INSERT INTO org_cache_policies(org_id, scope, member_user_id, auto_cache_control, enforce)
     VALUES($1,'member',$2,true,true)`,
    [orgId, memberId]
  );
  clearApiKeyCache();
  await callMessages(memberCk);
  assert.ok(JSON.stringify(mock.state.bodies.at(-1)).includes("cache_control"),
    "member-tier enforced policy should re-enable injection");

  // non-enforced policies must NOT override at request time
  await pool.query("UPDATE org_cache_policies SET enforce=false WHERE org_id=$1", [orgId]);
  clearApiKeyCache();
  await callMessages(memberCk);
  assert.ok(JSON.stringify(mock.state.bodies.at(-1)).includes("cache_control"),
    "non-enforced policy leaves the key's own setting (default on)");
  await pool.query("DELETE FROM org_cache_policies WHERE org_id=$1", [orgId]);
  clearApiKeyCache();
});

test("org billing lock pauses injection but never traffic", async () => {
  await pool.query("UPDATE organizations SET billing_locked=true WHERE id=$1", [orgId]);
  clearApiKeyCache();
  const r = await callMessages(memberCk);
  assert.equal(r.status, 200, "pass-through must survive a billing lock");
  assert.ok(!JSON.stringify(mock.state.bodies.at(-1)).includes("cache_control"));
  await pool.query("UPDATE organizations SET billing_locked=false WHERE id=$1", [orgId]);
  clearApiKeyCache();
});

test("block budgets decline requests once the month's spend crosses the limit", async () => {
  // spend $10 this month on the member's key
  await pool.query(
    `INSERT INTO request_logs(api_key_id, provider, model, cost_usd) VALUES($1,'anthropic','m',10)`,
    [memberKeyId]
  );
  await pool.query(
    `INSERT INTO org_budgets(org_id, scope, monthly_limit_usd, action) VALUES($1,'org',5,'warn')`,
    [orgId]
  );
  clearOrgBudgetCache();
  assert.equal((await callMessages(memberCk)).status, 200, "warn budgets never block");

  await pool.query("UPDATE org_budgets SET action='block' WHERE org_id=$1", [orgId]);
  clearOrgBudgetCache();
  const blocked = await callMessages(memberCk);
  assert.equal(blocked.status, 429);
  const j: any = await blocked.json();
  assert.match(j.error.message, /monthly spend limit/);

  // member-scope block only hits that member
  await pool.query("DELETE FROM org_budgets WHERE org_id=$1", [orgId]);
  await pool.query(
    `INSERT INTO org_budgets(org_id, scope, member_user_id, monthly_limit_usd, action)
     VALUES($1,'member',$2,5,'block')`,
    [orgId, memberId]
  );
  clearOrgBudgetCache();
  assert.equal((await callMessages(memberCk)).status, 429);
  assert.equal((await callMessages(ownerCk)).status, 200, "other members keep flowing");

  await pool.query("DELETE FROM org_budgets WHERE org_id=$1", [orgId]);
  clearOrgBudgetCache();
});

test("shared warming: identical org prefixes get ONE ping per sweep", async () => {
  await pool.query("UPDATE api_keys SET keepalive_enabled=true WHERE id = ANY($1)", [
    [ownerKeyId, memberKeyId],
  ]);
  const prefix = { model: "claude-sonnet-4-5", system: BIG, messages: [] };
  const plain = JSON.stringify(prefix);
  for (const keyId of [ownerKeyId, memberKeyId]) {
    await pool.query(
      `INSERT INTO keepalive_state(api_key_id, provider, encrypted_prefix, model, prefix_token_estimate, prefix_sha, last_request_at)
       VALUES($1,'anthropic',$2,'claude-sonnet-4-5',5000,$3, now() - interval '5 minutes')`,
      [keyId, encrypt(plain, ENC_KEY), sha256Hex(plain)]
    );
  }
  const before5 = mock.state.bodies.length;
  const pinged = await keepaliveSweep({ pool, upstreamUrl: mock.url, encryptionKey: ENC_KEY });
  assert.equal(pinged, 1, "one warm ping covers every member on the same prefix");
  assert.equal(mock.state.bodies.length, before5 + 1);

  // different prefixes ping separately
  const prefix2 = { model: "claude-sonnet-4-5", system: BIG + "z", messages: [] };
  await pool.query(
    `UPDATE keepalive_state SET encrypted_prefix=$2, prefix_sha=$3, last_ping_at=NULL,
            last_request_at = now() - interval '5 minutes'
      WHERE api_key_id=$1`,
    [memberKeyId, encrypt(JSON.stringify(prefix2), ENC_KEY), sha256Hex(JSON.stringify(prefix2))]
  );
  await pool.query(
    `UPDATE keepalive_state SET last_ping_at = now() - interval '5 minutes' WHERE api_key_id=$1`,
    [ownerKeyId]
  );
  const pinged2 = await keepaliveSweep({ pool, upstreamUrl: mock.url, encryptionKey: ENC_KEY });
  assert.equal(pinged2, 2, "distinct prefixes warm independently");
  await pool.query("DELETE FROM keepalive_state");
  await pool.query("UPDATE api_keys SET keepalive_enabled=false WHERE org_id=$1", [orgId]);
});

test("billing separation: org savings meter into org periods, not personal ones", async () => {
  await pool.query("DELETE FROM request_logs");
  await pool.query(
    `INSERT INTO request_logs(api_key_id, provider, model, saved_usd) VALUES($1,'anthropic','m',7)`,
    [memberKeyId]
  );
  const personalKey = await pool.query(
    "SELECT id FROM api_keys WHERE user_id=$1 AND org_id IS NULL", [memberId]);
  await pool.query(
    `INSERT INTO request_logs(api_key_id, provider, model, saved_usd) VALUES($1,'anthropic','m',3)`,
    [personalKey.rows[0].id]
  );

  await billingSweep(pool, new Date(), false);

  const orgP = await pool.query("SELECT * FROM org_billing_periods WHERE org_id=$1", [orgId]);
  assert.equal(orgP.rows.length, 1);
  assert.equal(Number(orgP.rows[0].gross_saved_usd), 7);

  const userP = await pool.query("SELECT * FROM billing_periods WHERE user_id=$1", [memberId]);
  assert.equal(userP.rows.length, 1);
  assert.equal(Number(userP.rows[0].gross_saved_usd), 3, "personal periods must exclude org keys");
});
