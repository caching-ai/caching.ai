// Generates the synthetic fixtures the scenarios use, deterministically
// (seeded PRNG — running this again produces byte-identical files, and the
// generated files are also checked in so third parties don't need to run it).
// All content is synthetic: invented products, invented modules, no quoted
// third-party text.
//
//   node bench/gen-fixtures.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rng, estimateTokens } from "./lib/util.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
fs.mkdirSync(OUT, { recursive: true });

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

const NOUNS = ["queue", "scheduler", "ledger", "cache", "router", "parser", "indexer", "worker", "gateway", "planner", "resolver", "emitter", "batcher", "throttler", "compactor", "replicator", "auditor", "notifier", "sampler", "migrator"];
const ADJS = ["idempotent", "bounded", "durable", "sharded", "lazy", "eager", "append-only", "lock-free", "rate-limited", "checkpointed", "versioned", "content-addressed", "backpressured", "quorum-based", "leased"];
const VERBS = ["drains", "coalesces", "retries", "reconciles", "amortizes", "deduplicates", "rebalances", "snapshots", "validates", "propagates", "quarantines", "rehydrates", "fans out", "pins", "evicts"];
const DOMAINS = ["billing events", "webhook deliveries", "search documents", "session tokens", "audit records", "invoice lines", "metric points", "email digests", "feature flags", "export jobs", "import batches", "notification fanouts"];

function sentence(r) {
  const s = [
    `The ${pick(r, NOUNS)} ${pick(r, VERBS)} ${pick(r, DOMAINS)} through a ${pick(r, ADJS)} pipeline before the ${pick(r, NOUNS)} acknowledges the batch.`,
    `When the ${pick(r, NOUNS)} falls behind, the ${pick(r, NOUNS)} ${pick(r, VERBS)} pending ${pick(r, DOMAINS)} and records the watermark in the ${pick(r, ADJS)} ${pick(r, NOUNS)}.`,
    `Operators should treat the ${pick(r, ADJS)} ${pick(r, NOUNS)} as the source of truth for ${pick(r, DOMAINS)}; the ${pick(r, NOUNS)} only ${pick(r, VERBS)} a derived view.`,
    `A ${pick(r, ADJS)} retry window protects the ${pick(r, NOUNS)} from duplicate ${pick(r, DOMAINS)} while the ${pick(r, NOUNS)} ${pick(r, VERBS)} the backlog.`,
    `Configuration for the ${pick(r, NOUNS)} lives beside the ${pick(r, NOUNS)}; changing either without a rollout plan risks stale ${pick(r, DOMAINS)}.`,
    `Alert thresholds assume the ${pick(r, NOUNS)} ${pick(r, VERBS)} at least once per interval; silence usually means the ${pick(r, ADJS)} lease expired.`,
  ];
  return pick(r, s);
}

function paragraph(r, n) {
  return Array.from({ length: n }, () => sentence(r)).join(" ");
}

/** Build a sectioned document of ~targetTokens with a stable header. */
function document(seed, title, preamble, sectionPrefix, targetTokens) {
  const r = rng(seed);
  let out = `# ${title}\n\n${preamble}\n\n`;
  let i = 1;
  while (estimateTokens(out) < targetTokens) {
    out += `## ${sectionPrefix} ${i}\n\n${paragraph(r, 5)}\n\n`;
    i++;
  }
  return out;
}

// ---------- S1: agent coding ----------
const systemCoding = document(
  101,
  "Larkspur Engineering Handbook (synthetic)",
  "You are the coding agent for the Larkspur monorepo. Follow the module notes below, keep changes minimal, and always state which module a change touches. This handbook is fictional and generated for benchmarking.",
  "Module",
  8500
);
fs.writeFileSync(path.join(OUT, "system-coding.txt"), systemCoding);

const toolDefs = [
  ["read_file", "Read a file from the Larkspur repository. Returns the full text with line numbers. Use before any edit so the change matches surrounding style. Path must be repository-relative; globbing is not supported and directories are rejected with a typed error."],
  ["write_file", "Create or overwrite a file in the Larkspur repository. The content replaces the file atomically. Prefer edit_file for partial changes; write_file is for new files or full rewrites where the previous content was already read this session."],
  ["edit_file", "Apply an exact string replacement to one file. The old string must match exactly once, including whitespace. Returns a unified diff of the applied change. Fails without modifying anything when the match is absent or ambiguous."],
  ["run_tests", "Run the Larkspur test suite, optionally filtered to one package. Returns pass/fail counts and the first twenty failing assertions with stack traces. Test processes are sandboxed and cannot reach the network."],
  ["search_repo", "Search the repository with a regular expression. Returns up to two hundred matches as path, line number and line text. Case-insensitive by default; anchor patterns to reduce noise in large result sets."],
];
const toolsCoding = toolDefs.map(([name, description]) => ({
  name,
  description: description + " " + paragraph(rng(name.length * 7 + 11), 4),
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Repository-relative file path this operation targets." },
      content: { type: "string", description: "Payload text for write or edit operations; ignored by read-only tools." },
      pattern: { type: "string", description: "Exact string or regular expression used to locate the target lines." },
    },
    required: ["path"],
  },
}));
fs.writeFileSync(path.join(OUT, "tools-coding.json"), JSON.stringify(toolsCoding, null, 2));

const rTurns = rng(202);
const codingTurns = Array.from({ length: 40 }, (_, i) => ({
  user: `Step ${i + 1}: In the ${pick(rTurns, NOUNS)} module, ${pick(rTurns, ["add a guard so it", "refactor the loop that", "fix the off-by-one where it", "add a unit test proving it", "document the invariant that it"])} ${pick(rTurns, VERBS)} ${pick(rTurns, DOMAINS)} correctly. ${sentence(rTurns)}`,
  assistant: `Done. I updated the ${pick(rTurns, NOUNS)} so it ${pick(rTurns, VERBS)} ${pick(rTurns, DOMAINS)} as requested, and the focused tests pass. ${sentence(rTurns)} Ready for the next step.`,
}));
fs.writeFileSync(path.join(OUT, "coding-turns.json"), JSON.stringify(codingTurns, null, 2));

// ---------- S2: customer support ----------
const systemSupport = document(
  303,
  "Brightmail Support Playbook (synthetic)",
  "You are the support assistant for Brightmail, a fictional email delivery product invented for this benchmark. Answer using only the policies below, stay concise, and never promise refunds beyond policy.",
  "Policy",
  8000
);
fs.writeFileSync(path.join(OUT, "system-support.txt"), systemSupport);

const rSupp = rng(404);
const supportQuestions = Array.from({ length: 12 }, (_, i) =>
  `Customer ${i + 1}: My ${pick(rSupp, DOMAINS)} ${pick(rSupp, ["stopped syncing", "were charged twice", "show a stale status", "never arrive", "fail with a timeout"])} since yesterday — what does policy say I should do first, and do I qualify for a credit?`
);
fs.writeFileSync(path.join(OUT, "support-questions.txt"), supportQuestions.join("\n"));

// ---------- S3: RAG with timestamp breaker ----------
const ragDocs = document(
  505,
  "Fernbase Knowledge Base (synthetic)",
  "You answer questions about Fernbase, a fictional analytics product invented for this benchmark, using only the articles below.",
  "Article",
  7000
);
fs.writeFileSync(path.join(OUT, "rag-docs.txt"), ragDocs);

const rRag = rng(606);
const ragQuestions = Array.from({ length: 30 }, (_, i) =>
  `Question ${i + 1}: According to the knowledge base, how should the ${pick(rRag, NOUNS)} handle ${pick(rRag, DOMAINS)} when the ${pick(rRag, ADJS)} ${pick(rRag, NOUNS)} is degraded?`
);
fs.writeFileSync(path.join(OUT, "rag-questions.txt"), ragQuestions.join("\n"));

// ---------- S4: batch classification ----------
let classify = `# Ticket Classification Instructions (synthetic)\n\nClassify each support ticket into exactly one label. Respond with the label only. The taxonomy below is fictional and generated for benchmarking.\n\n`;
const rCls = rng(707);
let li = 1;
while (estimateTokens(classify) < 7000) {
  classify += `LABEL_${String(li).padStart(3, "0")} (${pick(rCls, ADJS)}-${pick(rCls, NOUNS)}): use when the ticket concerns ${pick(rCls, DOMAINS)} that ${pick(rCls, VERBS)} unexpectedly. ${sentence(rCls)}\n`;
  li++;
}
fs.writeFileSync(path.join(OUT, "system-classify.txt"), classify);

const rItems = rng(808);
const items = Array.from({ length: 300 }, (_, i) =>
  `Ticket ${i + 1}: our ${pick(rItems, DOMAINS)} ${pick(rItems, ["started failing", "doubled overnight", "vanished from the dashboard", "arrive out of order", "time out after retries"])} and the ${pick(rItems, NOUNS)} log shows a ${pick(rItems, ADJS)} error.`
);
fs.writeFileSync(path.join(OUT, "classify-items.txt"), items.join("\n"));

// ---------- S5: lunch hold ----------
const systemHold = document(
  909,
  "Orchard Codebase Briefing (synthetic)",
  "You are the reviewer for the Orchard monorepo, a fictional codebase generated for this benchmark. Use the briefing below when answering.",
  "Component",
  11500
);
fs.writeFileSync(path.join(OUT, "system-hold.txt"), systemHold);
fs.writeFileSync(
  path.join(OUT, "hold-questions.txt"),
  [
    "Before lunch: summarize the riskiest component in one paragraph and name the invariant most likely to break under load.",
    "Back from lunch: same briefing — which component should we refactor first this quarter, and why in two sentences?",
  ].join("\n")
);

// ---------- S6: steady traffic ----------
const systemSteady = document(
  1111,
  "Copperline Assistant Guide (synthetic)",
  "You are the in-app assistant for Copperline, a fictional project tracker invented for this benchmark. Answer from the guide below.",
  "Topic",
  7000
);
fs.writeFileSync(path.join(OUT, "system-steady.txt"), systemSteady);

const rSteady = rng(1212);
const steadyQuestions = Array.from({ length: 60 }, (_, i) =>
  `Query ${i + 1}: Where in Copperline do I configure the ${pick(rSteady, ADJS)} ${pick(rSteady, NOUNS)} for ${pick(rSteady, DOMAINS)}?`
);
fs.writeFileSync(path.join(OUT, "steady-questions.txt"), steadyQuestions.join("\n"));

// report sizes
for (const f of fs.readdirSync(OUT).sort()) {
  const text = fs.readFileSync(path.join(OUT, f), "utf8");
  console.log(`${f}\t~${estimateTokens(text)} tok\t${text.length} chars`);
}
