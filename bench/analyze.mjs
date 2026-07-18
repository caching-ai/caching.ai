// Aggregates one run's raw JSONL into summary.json + summary.md.
//
//   node bench/analyze.mjs --run-id run-XXXX
//
// Metrics per (scenario × model × arm):
//   * input-side cost  = input + cache_write(×premium) + cache_read(×discount)
//                        priced at public list prices — the primary metric
//   * C net cost       = input-side cost + that cell's keep-alive ping cost
//                        (from pings.json; C only)
//   * hit rate         = cache_read / (input + cache_write + cache_read)
//   * TTFT p50/p95     — calls that needed no retry only
//   * output cost      — reference figure, reported separately
// Reps are aggregated as mean (min–max).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonl, percentile } from "./lib/util.mjs";
import { ckKeyName } from "./lib/matrix.mjs";

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const runId = args["run-id"];
if (!runId) { console.error("usage: node bench/analyze.mjs --run-id X"); process.exit(2); }

const resultsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "results", runId);
const pings = fs.existsSync(path.join(resultsDir, "pings.json"))
  ? JSON.parse(fs.readFileSync(path.join(resultsDir, "pings.json"), "utf8")).keys
  : {};

// modelAlias comes from the file name: {scenario}_{alias}_r{rep}.jsonl
const cells = new Map(); // "S2|haiku" -> { scenario, alias, model, provider, reps: Map(rep -> {arms}) }
for (const f of fs.readdirSync(resultsDir).filter((f) => /^S\d_.*_r\d+\.jsonl$/.test(f))) {
  const [, scenario, alias, repStr] = f.match(/^(S\d)_(.+)_r((\d+))\.jsonl$/);
  const rep = Number(repStr);
  const rows = readJsonl(path.join(resultsDir, f));
  const key = `${scenario}|${alias}`;
  if (!cells.has(key)) cells.set(key, { scenario, alias, reps: new Map() });
  const cell = cells.get(key);
  const perArm = {};
  for (const r of rows) {
    if (r.kind === "meta") { cell.model = r.model; cell.provider = r.provider; }
    if (r.kind !== "call") continue;
    const a = (perArm[r.arm] ??= { calls: 0, errors: 0, retries: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, inputSideUsd: 0, outputUsd: 0, ttft: [] });
    a.calls++;
    if (r.error || r.status >= 400) { a.errors++; continue; }
    a.retries += r.retries || 0;
    a.input += r.usage.input; a.cacheWrite += r.usage.cacheWrite; a.cacheRead += r.usage.cacheRead; a.output += r.usage.output;
    a.inputSideUsd += r.cost.inputSideUsd; a.outputUsd += r.cost.outputUsd;
    if (!r.retries && r.ttftMs != null) a.ttft.push(r.ttftMs);
  }
  // C net: add this rep's keep-alive pings
  if (perArm.C) {
    const ping = pings[ckKeyName(scenario, alias, rep)] ?? { pings: 0, usd: 0 };
    perArm.C.pings = ping.pings;
    perArm.C.pingUsd = ping.usd;
    perArm.C.netUsd = perArm.C.inputSideUsd + ping.usd;
  }
  cell.reps.set(rep, perArm);
}

const agg = (vals) => vals.length ? { mean: vals.reduce((a, b) => a + b, 0) / vals.length, min: Math.min(...vals), max: Math.max(...vals) } : null;
const fmtUsd = (v) => v == null ? "—" : `$${v.toFixed(4)}`;
const fmtAgg = (a) => a ? `${fmtUsd(a.mean)} (${fmtUsd(a.min)}–${fmtUsd(a.max)})` : "—";
const pct = (v) => v == null ? "—" : `${(v * 100).toFixed(1)}%`;

const summary = [];
for (const [, cell] of [...cells.entries()].sort()) {
  const arms = {};
  for (const arm of ["A", "B", "C"]) {
    const reps = [...cell.reps.values()].map((r) => r[arm]).filter(Boolean);
    if (!reps.length) continue;
    const ttftAll = reps.flatMap((r) => r.ttft).sort((x, y) => x - y);
    arms[arm] = {
      calls: reps.reduce((a, r) => a + r.calls, 0),
      errors: reps.reduce((a, r) => a + r.errors, 0),
      retries: reps.reduce((a, r) => a + r.retries, 0),
      tokens: {
        input: reps.reduce((a, r) => a + r.input, 0),
        cacheWrite: reps.reduce((a, r) => a + r.cacheWrite, 0),
        cacheRead: reps.reduce((a, r) => a + r.cacheRead, 0),
        output: reps.reduce((a, r) => a + r.output, 0),
      },
      hitRate: (() => { const i = reps.reduce((a, r) => a + r.input + r.cacheWrite + r.cacheRead, 0); return i ? reps.reduce((a, r) => a + r.cacheRead, 0) / i : null; })(),
      inputSideUsd: agg(reps.map((r) => r.inputSideUsd)),
      outputUsd: agg(reps.map((r) => r.outputUsd)),
      ttftP50: percentile(ttftAll, 0.5),
      ttftP95: percentile(ttftAll, 0.95),
      ...(arm === "C" ? {
        pings: reps.reduce((a, r) => a + (r.pings || 0), 0),
        pingUsd: agg(reps.map((r) => r.pingUsd ?? 0)),
        netUsd: agg(reps.map((r) => r.netUsd ?? r.inputSideUsd)),
      } : {}),
    };
  }
  const a = arms.A?.inputSideUsd?.mean, b = arms.B?.inputSideUsd?.mean;
  const cNet = arms.C?.netUsd?.mean ?? arms.C?.inputSideUsd?.mean;
  summary.push({
    scenario: cell.scenario, model: cell.model, alias: cell.alias, provider: cell.provider,
    arms,
    savingsVsA: a && cNet != null ? (a - cNet) / a : null,
    savingsVsB: b && cNet != null ? (b - cNet) / b : null,
  });
}

fs.writeFileSync(path.join(resultsDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");

// ---------- markdown ----------
let md = `# Benchmark summary — ${runId}\n\nInput-side cost = input + cache-write (with provider premium) + cache-read (with provider discount), priced at public list prices from the provider usage blocks. C's net cost includes its keep-alive ping spend. Mean over reps (min–max).\n\n`;
const byScenario = {};
for (const row of summary) (byScenario[row.scenario] ??= []).push(row);
for (const [scenario, rows] of Object.entries(byScenario).sort()) {
  md += `## ${scenario}\n\n| model | arm | calls (err) | hit rate | input-side cost | pings | net cost | Δ vs A | TTFT p50/p95 ms | output cost |\n|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const row of rows) {
    for (const arm of ["A", "B", "C"]) {
      const d = row.arms[arm];
      if (!d) continue;
      const net = arm === "C" ? fmtAgg(d.netUsd) : "";
      const dvA = arm === "C" && row.savingsVsA != null ? pct(row.savingsVsA) : "";
      md += `| ${row.alias} | ${arm} | ${d.calls} (${d.errors}) | ${pct(d.hitRate)} | ${fmtAgg(d.inputSideUsd)} | ${arm === "C" ? d.pings : ""} | ${net} | ${dvA} | ${d.ttftP50?.toFixed(0) ?? "—"}/${d.ttftP95?.toFixed(0) ?? "—"} | ${fmtAgg(d.outputUsd)} |\n`;
    }
  }
  md += "\n";
}
fs.writeFileSync(path.join(resultsDir, "summary.md"), md);
console.log(md);
