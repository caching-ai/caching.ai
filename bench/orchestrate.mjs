// Runs the full benchmark matrix for one run id.
//
//   node bench/orchestrate.mjs --run-id run-20260718 [--budget 150] [--gap-scale 1]
//
// Cells (scenario × model) run in parallel — every scenario's arms are already
// interleaved inside run.mjs, and salts keep all cells in separate provider
// cache namespaces. S4 (300 back-to-back calls × 3 models) starts in a second
// phase so its sustained token rate doesn't 429-storm the sparse scenarios.
// The shared ledger + ABORTED marker enforce the budget cap across all cells.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MATRIX, MODELS } from "./lib/matrix.mjs";
import { loadBenchEnv, ledgerTotal, abortMarker } from "./lib/util.mjs";

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const runId = args["run-id"];
if (!runId) { console.error("usage: node bench/orchestrate.mjs --run-id X [--budget 150] [--gap-scale 1]"); process.exit(2); }
const budget = args.budget ?? "150";
const gapScale = args["gap-scale"] ?? "1";

const resultsDir = path.join(BENCH_DIR, "results", runId);
const logDir = path.join(resultsDir, "logs");
fs.mkdirSync(logDir, { recursive: true });
const env = loadBenchEnv();

const PHASES = [
  ["S1", "S2", "S3", "S5", "S6"],
  ["S4"],
];

function runCell(scenario, alias) {
  return new Promise((resolve) => {
    const log = fs.createWriteStream(path.join(logDir, `${scenario}_${alias}.log`), { flags: "a" });
    const child = spawn(process.execPath, [
      path.join(BENCH_DIR, "run.mjs"),
      "--run-id", runId, "--scenario", scenario, "--model", alias,
      "--budget", budget, "--gap-scale", gapScale,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(log); child.stderr.pipe(log);
    child.on("exit", (code) => resolve({ scenario, alias, code }));
  });
}

const started = Date.now();
const outcomes = [];
for (const phase of PHASES) {
  const cells = [];
  for (const scenario of phase) {
    for (const alias of MATRIX[scenario]) {
      if (MODELS[alias].provider === "grok" && !env.XAI_API_KEY) {
        console.log(`skip ${scenario}/${alias}: no xAI key`);
        continue;
      }
      cells.push([scenario, alias]);
    }
  }
  console.log(`phase [${phase.join(",")}]: ${cells.length} cells → ${cells.map((c) => c.join("/")).join(", ")}`);
  const res = await Promise.all(cells.map(([s, a]) => runCell(s, a)));
  outcomes.push(...res);
  if (fs.existsSync(abortMarker(resultsDir))) {
    console.error("ABORTED marker present — stopping before next phase");
    break;
  }
  console.log(`phase done — spend so far $${ledgerTotal(resultsDir).toFixed(2)}`);
}

console.log(`\nrun ${runId} finished in ${((Date.now() - started) / 60000).toFixed(1)} min`);
console.log(`total spend (ledger): $${ledgerTotal(resultsDir).toFixed(2)}`);
for (const o of outcomes) console.log(`  ${o.scenario}/${o.alias}: ${o.code === 0 ? "ok" : `EXIT ${o.code}`}`);
process.exit(outcomes.some((o) => o.code !== 0) ? 1 : 0);
