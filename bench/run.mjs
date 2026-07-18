// Runs ONE cell (scenario × model) of the benchmark: all arms interleaved
// step-by-step (A → B → C within each step, so no arm gets a friendlier time
// of day), reps in parallel (each rep is its own cache namespace via salt and
// its own ck_ key).
//
//   node bench/run.mjs --run-id run-20260718 --scenario S2 --model haiku \
//        [--reps 3] [--limit-steps N] [--gap-scale 1] [--budget 150]
//
// Fairness rules implemented here (see bench/README.md):
//   * salt token `[bench <run> <arm> r<rep>]` leads every system prompt —
//     separate provider-side cache namespaces per arm AND per rep
//   * fixed conversation scripts from fixtures/ — model output never feeds
//     the next turn, so response length can't contaminate input-side cost
//   * usage tokens come from the provider's stream events, cost = tokens ×
//     public list price (bench/lib/pricing.mjs)
//   * every call appends to the shared ledger; the run hard-aborts at the cap

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODELS, armsFor, ckKeyName, REPS } from "./lib/matrix.mjs";
import { costOf } from "./lib/pricing.mjs";
import { callAnthropic, callOpenAI, callGemini, sendHoldCommand, baseUrlFor } from "./lib/providers.mjs";
import { appendJsonl, sleep, loadBenchEnv, loadBenchKeys, budgetGuard, ledgerAdd } from "./lib/util.mjs";
import { patchKey, listKeys } from "./lib/console.mjs";

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));

// ---------- args ----------
const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const runId = args["run-id"];
const scenarioId = args["scenario"];
const modelAlias = args["model"];
if (!runId || !scenarioId || !modelAlias) {
  console.error("usage: node bench/run.mjs --run-id X --scenario S2 --model haiku [--reps 3] [--limit-steps N] [--gap-scale 1] [--budget 150]");
  process.exit(2);
}
const reps = Number(args.reps ?? REPS);
const gapScale = Number(args["gap-scale"] ?? 1);
const limitSteps = args["limit-steps"] ? Number(args["limit-steps"]) : null;
const budgetCap = Number(args.budget ?? process.env.BENCH_BUDGET_USD ?? 150);

const model = MODELS[modelAlias];
if (!model) { console.error(`unknown model alias ${modelAlias}`); process.exit(2); }
const arms = (args.arms ? args.arms.split(",") : armsFor(model.provider));

// ---------- load scenario + fixtures ----------
const scenFile = fs.readdirSync(path.join(BENCH_DIR, "scenarios")).find((f) => f.startsWith(scenarioId + "_"));
if (!scenFile) { console.error(`unknown scenario ${scenarioId}`); process.exit(2); }
const scen = JSON.parse(fs.readFileSync(path.join(BENCH_DIR, "scenarios", scenFile), "utf8"));

const fixture = (name) => fs.readFileSync(path.join(BENCH_DIR, "fixtures", name), "utf8");
const systemText = fixture(scen.system);
const tools = scen.tools ? JSON.parse(fixture(scen.tools)) : null;
const conversation = scen.conversation ? JSON.parse(fixture(scen.conversation)) : null;
const userPool = scen.userPool ? fixture(scen.userPool).split("\n").filter(Boolean) : null;

let steps = scen.steps ?? [];
if (scen.generate) {
  steps = Array.from({ length: scen.generate.count }, (_, i) => ({
    gapSec: i === 0 ? 0 : scen.generate.gapSec,
    kind: scen.generate.kind,
    userLine: i,
  }));
}
if (limitSteps) steps = steps.slice(0, limitSteps);

const resultsDir = path.join(BENCH_DIR, "results", runId);
fs.mkdirSync(resultsDir, { recursive: true });

const env = loadBenchEnv();
const ckKeys = loadBenchKeys();
const providerKey = {
  anthropic: env.ANTHROPIC_API_KEY,
  openai: env.OPENAI_API_KEY,
  gemini: env.GEMINI_API_KEY,
  grok: env.XAI_API_KEY,
}[model.provider];
if (!providerKey && arms.some((a) => a !== "C")) {
  console.error(`no ${model.provider} key in bench env`); process.exit(2);
}

// ---------- request builders ----------
const salt = (arm, rep) => `[bench ${runId} ${arm} r${rep}]`;

function stepSystem(arm, rep, timestamp) {
  // the salt namespaces provider caches per arm+rep; the (deliberate) S3
  // breaker puts a live timestamp inside the prefix
  let text = `${salt(arm, rep)}\n${systemText}`;
  if (scen.timestampInSystem) text = `${salt(arm, rep)}\nCurrent time: ${timestamp}\n${systemText}`;
  return text;
}

function buildMessages(step) {
  const msgs = [];
  if (conversation && step.history != null) {
    for (let i = 0; i < step.history; i++) {
      msgs.push({ role: "user", content: conversation[i].user });
      msgs.push({ role: "assistant", content: conversation[i].assistant });
    }
  }
  const userText = step.userTurn != null ? conversation[step.userTurn].user : userPool[step.userLine % userPool.length];
  msgs.push({ role: "user", content: userText });
  return msgs;
}

async function callArm(arm, rep, step, timestamp) {
  const cellKey = ckKeyName(scenarioId, modelAlias, rep);
  const apiKey = arm === "C" ? ckKeys[cellKey] : providerKey;
  if (!apiKey) throw new Error(`missing key for arm ${arm} (${cellKey}) — run bench/setup-keys.mjs`);
  const baseUrl = baseUrlFor(model.provider, arm);
  const system = stepSystem(arm, rep, timestamp);
  const messages = buildMessages(step);

  if (model.provider === "anthropic") {
    const sysBlocks = [{ type: "text", text: system }];
    let toolsArm = tools;
    if (arm === "B") {
      // hand-tuned: cache_control exactly where the proxy would inject it
      sysBlocks[sysBlocks.length - 1].cache_control = { type: "ephemeral" };
      if (tools) {
        toolsArm = structuredClone(tools);
        toolsArm[toolsArm.length - 1].cache_control = { type: "ephemeral" };
      }
    }
    return callAnthropic({ baseUrl, apiKey, model: model.id, system: sysBlocks, messages, tools: toolsArm, maxTokens: scen.maxOutputTokens });
  }
  if (model.provider === "openai" || model.provider === "grok") {
    return callOpenAI({ baseUrl, apiKey, model: model.id, system, messages, maxTokens: scen.maxOutputTokens, reasoningSeparate: model.provider === "grok" });
  }
  return callGemini({ baseUrl, apiKey, model: model.id, system, messages, maxTokens: scen.maxOutputTokens });
}

// ---------- one rep ----------
async function runRep(rep) {
  const outFile = path.join(resultsDir, `${scenarioId}_${modelAlias}_r${rep}.jsonl`);
  const cell = `${scenarioId}/${modelAlias}/r${rep}`;
  appendJsonl(outFile, {
    kind: "meta", runId, scenario: scenarioId, model: model.id, provider: model.provider,
    rep, arms, steps: steps.length, gapScale, keepalive: !!scen.keepalive, ts: new Date().toISOString(),
  });

  for (let si = 0; si < steps.length; si++) {
    const step = steps[si];
    if (step.gapSec) await sleep(step.gapSec * 1000 * gapScale);
    budgetGuard(resultsDir, budgetCap, cell);
    const timestamp = new Date().toISOString(); // S3: same within the step for every arm

    if (step.kind === "hold") {
      // proxy-only feature — C arm only; direct arms have nothing equivalent
      if (arms.includes("C")) {
        const r = await sendHoldCommand({ apiKey: ckKeys[ckKeyName(scenarioId, modelAlias, rep)], model: model.id, holdText: step.holdText });
        appendJsonl(outFile, { kind: "hold", runId, scenario: scenarioId, model: model.id, rep, step: si, arm: "C", status: r.status, reply: r.reply, ts: new Date().toISOString() });
      }
      continue;
    }

    for (const arm of arms) {
      const r = await callArm(arm, rep, step, timestamp);
      const cost = r.usage ? costOf(model.provider, model.id, r.usage) : { inputSideUsd: 0, outputUsd: 0 };
      ledgerAdd(resultsDir, cell, cost.inputSideUsd + cost.outputUsd);
      appendJsonl(outFile, {
        kind: "call", runId, scenario: scenarioId, model: model.id, provider: model.provider,
        arm, rep, step: si, status: r.status, retries: r.retries,
        ttftMs: r.ttftMs, totalMs: r.totalMs, usage: r.usage, cost,
        error: r.error, ts: new Date().toISOString(),
      });
      if (r.error) console.error(`[${cell}] step ${si} arm ${arm}: ${r.error}`);
    }
    if (si % 10 === 0) console.log(`[${cell}] step ${si + 1}/${steps.length} done`);
  }

  // stop trailing keep-alive pings the moment the workload ends — pings sent
  // DURING the scenario are counted into C's net cost at analysis time
  if (scen.keepalive && arms.includes("C")) {
    try {
      const { keys } = await listKeys();
      const row = keys.find((k) => k.name === ckKeyName(scenarioId, modelAlias, rep) && !k.revoked_at);
      if (row) await patchKey(row.id, { keepalive_enabled: false });
      appendJsonl(outFile, { kind: "keepalive-off", rep, ts: new Date().toISOString() });
    } catch (e) {
      console.error(`[${cell}] failed to disable keepalive: ${e.message}`);
    }
  }
  console.log(`[${cell}] complete`);
}

const t0 = Date.now();
console.log(`cell ${scenarioId}/${modelAlias}: ${steps.length} steps × arms ${arms.join(",")} × reps ${reps} (gapScale ${gapScale}, cap $${budgetCap})`);
const results = await Promise.allSettled(Array.from({ length: reps }, (_, i) => runRep(i + 1)));
const failed = results.filter((r) => r.status === "rejected");
for (const f of failed) console.error("rep failed:", f.reason?.message ?? f.reason);
console.log(`cell ${scenarioId}/${modelAlias} finished in ${((Date.now() - t0) / 60000).toFixed(1)} min, ${failed.length} failed reps`);
process.exit(failed.length ? 1 : 0);
