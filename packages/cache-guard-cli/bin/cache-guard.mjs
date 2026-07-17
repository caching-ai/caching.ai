#!/usr/bin/env node
// cache-guard — snapshot & verify LLM prompt-cache prefixes in CI.
//
//   cache-guard snapshot fixtures/*.json     write .cacheguard.json baseline
//   cache-guard check    fixtures/*.json     exit 1 if any prefix hash changed
//
// A fixture is an Anthropic Messages API request body (JSON). The guard
// hashes the cache-relevant prefix blocks (tools, system, first message);
// an unintended change here silently 10x-es your token bill in production.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const BASELINE = process.env.CACHE_GUARD_FILE ?? ".cacheguard.json";
const [cmd, ...files] = process.argv.slice(2);

const sha = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

function prefixHashes(body) {
  const out = {};
  if (body.tools !== undefined) out.tools = sha(body.tools);
  if (body.system !== undefined) out.system = sha(body.system);
  if (Array.isArray(body.messages) && body.messages.length) out.msg0 = sha(body.messages[0]);
  return out;
}

function load(file) {
  return prefixHashes(JSON.parse(readFileSync(file, "utf8")));
}

if (!cmd || !files.length || !["snapshot", "check"].includes(cmd)) {
  console.error("usage: cache-guard <snapshot|check> <fixture.json...>");
  process.exit(2);
}

if (cmd === "snapshot") {
  const snap = {};
  for (const f of files) snap[f] = load(f);
  writeFileSync(BASELINE, JSON.stringify(snap, null, 2) + "\n");
  console.log(`cache-guard: baseline written for ${files.length} fixture(s) -> ${BASELINE}`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(`cache-guard: no baseline (${BASELINE}). Run 'cache-guard snapshot' first.`);
  process.exit(2);
}
const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
let failed = false;
for (const f of files) {
  const prev = baseline[f];
  if (!prev) {
    console.warn(`cache-guard: ${f} not in baseline (new fixture?) — run snapshot to include it`);
    continue;
  }
  const cur = load(f);
  for (const block of new Set([...Object.keys(prev), ...Object.keys(cur)])) {
    if (prev[block] !== cur[block]) {
      console.error(`✗ ${f}: '${block}' prefix changed — this will invalidate the prompt cache`);
      failed = true;
    }
  }
}
if (failed) {
  console.error("\ncache-guard: cache-breaking change detected. If intentional, re-run 'cache-guard snapshot'.");
  process.exit(1);
}
console.log(`cache-guard: ${files.length} fixture(s) OK — prefixes unchanged`);
