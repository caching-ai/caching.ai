// Pulls keep-alive ping counts/costs per bench key from the proxy's
// request_logs (per-key attribution) for one run's time window, and writes
// results/{runId}/pings.json. C-arm net cost = request cost + these pings.
//
// This is the operator path (direct DB read). Third parties reproducing the
// benchmark see the same numbers on the console dashboard (/api/stats
// keepalivePings / keepaliveCost), or in their own request_logs when
// self-hosting the proxy — both read the identical table.
//
//   node bench/fetch-pings.mjs --run-id run-XXXX

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadBenchEnv, readJsonl } from "./lib/util.mjs";

const require = createRequire(import.meta.url);
// pg is already in the workspace's pnpm store; bench/ itself stays dependency-free
const pg = require("../node_modules/.pnpm/pg@8.22.0/node_modules/pg");

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const runId = args["run-id"];
if (!runId) { console.error("usage: node bench/fetch-pings.mjs --run-id X"); process.exit(2); }

const resultsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "results", runId);
let minTs = Infinity, maxTs = -Infinity;
for (const f of fs.readdirSync(resultsDir).filter((f) => /^S\d_.*\.jsonl$/.test(f))) {
  for (const row of readJsonl(path.join(resultsDir, f))) {
    if (!row.ts) continue;
    const t = Date.parse(row.ts);
    if (t < minTs) minTs = t;
    if (t > maxTs) maxTs = t;
  }
}
if (!Number.isFinite(minTs)) { console.error("no result rows found"); process.exit(1); }

const env = loadBenchEnv();
const pool = new pg.Pool({
  connectionString: env.DATABASE_URL.replace("sslmode=require", "sslmode=no-verify"),
  connectionTimeoutMillis: 15000,
});
const { rows } = await pool.query(
  `SELECT k.name, count(*)::int AS pings, coalesce(sum(rl.cost_usd),0)::float AS usd,
          coalesce(sum(rl.cache_read_tokens),0)::bigint AS cache_read,
          coalesce(sum(rl.input_tokens),0)::bigint AS input
     FROM request_logs rl JOIN api_keys k ON k.id = rl.api_key_id
    WHERE rl.is_keepalive AND k.name LIKE 'bench-%'
      AND rl.ts BETWEEN to_timestamp($1/1000.0) AND to_timestamp($2/1000.0)
    GROUP BY 1 ORDER BY 1`,
  [minTs - 60_000, maxTs + 5 * 60_000]
);
await pool.end();

const out = Object.fromEntries(rows.map((r) => [r.name, { pings: r.pings, usd: r.usd, cacheRead: Number(r.cache_read), input: Number(r.input) }]));
fs.writeFileSync(path.join(resultsDir, "pings.json"), JSON.stringify({ windowMs: [minTs, maxTs], keys: out }, null, 2) + "\n");
console.log(`pings.json written — ${rows.length} keys, ${rows.reduce((a, r) => a + r.pings, 0)} pings, $${rows.reduce((a, r) => a + r.usd, 0).toFixed(4)}`);
