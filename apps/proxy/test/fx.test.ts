import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { migrate } from "@caching/shared";
import { fxSweep } from "../src/fx.js";

const DB_URL = process.env.TEST_DATABASE_URL_FX ?? "postgres://localhost:5432/caching_ai_test6";
const here = dirname(fileURLToPath(import.meta.url));

let pool: pg.Pool;

before(async () => {
  const admin = new pg.Pool({ connectionString: DB_URL.replace(/\/[^/]+$/, "/postgres") });
  await admin.query(`CREATE DATABASE ${DB_URL.split("/").pop()!}`).catch(() => {}); // 42P04 = exists
  await admin.end();
  pool = new pg.Pool({ connectionString: DB_URL });
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(join(here, "../../../packages/shared/migrations"), DB_URL);
});

after(async () => {
  await pool?.end();
});

test("fx sweep upserts rates from the source and refreshes on re-run", async () => {
  const mockFetch = (async () =>
    new Response(JSON.stringify({ result: "success", rates: { KRW: 1500.5, JPY: 160, CNY: 7.1, EUR: 0.9, GBP: 0.8 } }), {
      status: 200, headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

  assert.equal(await fxSweep(pool, mockFetch), 4, "only the tracked codes are stored");
  const { rows } = await pool.query("SELECT code, per_usd::float AS r FROM fx_rates ORDER BY code");
  assert.deepEqual(rows.map((x: any) => x.code), ["CNY", "EUR", "JPY", "KRW"]);
  assert.equal(rows.find((x: any) => x.code === "KRW").r, 1500.5);

  const mock2 = (async () =>
    new Response(JSON.stringify({ result: "success", rates: { KRW: 1490, JPY: 161, CNY: 7.0, EUR: 0.88 } }), {
      status: 200,
    })) as unknown as typeof fetch;
  await fxSweep(pool, mock2);
  const { rows: r2 } = await pool.query("SELECT per_usd::float AS r FROM fx_rates WHERE code='KRW'");
  assert.equal(r2[0].r, 1490, "upsert refreshes existing rows");
});

test("fx sweep rejects bad sources and leaves the table untouched", async () => {
  const before = (await pool.query("SELECT per_usd::float AS r FROM fx_rates WHERE code='KRW'")).rows[0].r;
  const bad = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
  await assert.rejects(() => fxSweep(pool, bad), /fx source 500/);
  const weird = (async () => new Response(JSON.stringify({ result: "success", rates: { KRW: -5 } }), { status: 200 })) as unknown as typeof fetch;
  assert.equal(await fxSweep(pool, weird), 0, "non-positive rates are ignored");
  const after2 = (await pool.query("SELECT per_usd::float AS r FROM fx_rates WHERE code='KRW'")).rows[0].r;
  assert.equal(after2, before);
});
