// Mints (or re-configures) one ck_ key per C-arm cell:
//   bench-{scenario}-{model}-r{rep}
// Key plaintexts are stored OUTSIDE the repo in ~/.config/caching-bench/keys.json.
// Provider keys are registered account-level once (console → /api/provider-keys),
// so every minted key inherits them. Idempotent: safe to run repeatedly.
//
//   node bench/setup-keys.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MATRIX, MODELS, REPS, ckKeyName } from "./lib/matrix.mjs";
import { listKeys, createKey, patchKey } from "./lib/console.mjs";
import { loadBenchKeys, saveBenchKeys } from "./lib/util.mjs";

const SCEN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "scenarios");
const scenarioById = {};
for (const f of fs.readdirSync(SCEN_DIR)) {
  const s = JSON.parse(fs.readFileSync(path.join(SCEN_DIR, f), "utf8"));
  scenarioById[s.id] = s;
}

const existing = await listKeys();
const byName = new Map(existing.keys.filter((k) => !k.revoked_at).map((k) => [k.name, k]));
const stored = loadBenchKeys();

let minted = 0, configured = 0, skipped = 0;
for (const [scenario, models] of Object.entries(MATRIX)) {
  const scen = scenarioById[scenario];
  for (const alias of models) {
    const model = MODELS[alias];
    if (model.provider === "grok" && !process.env.XAI_API_KEY && !stored.__grok_enabled) {
      console.log(`skip ${scenario}/${alias}: no xAI key available`);
      skipped++;
      continue;
    }
    for (let rep = 1; rep <= REPS; rep++) {
      const name = ckKeyName(scenario, alias, rep);
      let row = byName.get(name);
      if (!row) {
        const res = await createKey(name);
        stored[name] = res.plaintext;
        row = res.key;
        minted++;
      } else if (!stored[name]) {
        throw new Error(`key ${name} exists on the account but its plaintext is not in keys.json — revoke it in the console and rerun`);
      }
      // desired settings: injection on (product default), keep-alive per scenario
      await patchKey(row.id, {
        auto_cache_control: true,
        keepalive_enabled: !!scen.keepalive,
        keepalive_budget_usd_daily: 5,
        anthropic_cache_ttl: "5m",
      });
      configured++;
    }
  }
}
saveBenchKeys(stored);
console.log(`minted=${minted} configured=${configured} skipped-cells=${skipped} (plaintexts in ~/.config/caching-bench/keys.json)`);
