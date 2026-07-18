// Shared helpers for the benchmark harness. Plain Node (>=20), no deps.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Deterministic PRNG (mulberry32) — fixtures and gap schedules are reproducible. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** rough token estimate (chars / 3.5) — mirrors packages/shared estimateTokens */
export const estimateTokens = (text) => Math.ceil(text.length / 3.5);

// ---------- secret redaction ----------
// Raw result JSONL is committed to a public repo. Nothing that looks like a
// key, an email, or an internal account identifier may reach disk.
const SECRET_RE = /(ck_[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{20,}|AIzaSy[A-Za-z0-9_-]{10,}|xai-[A-Za-z0-9_-]{8,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

export function redact(s) {
  return s.replace(SECRET_RE, "[REDACTED]");
}

export function appendJsonl(file, obj) {
  const line = redact(JSON.stringify(obj));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, line + "\n");
}

export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// ---------- budget ledger ----------
// Every runner appends each call's cost to one ledger file; the sum is the
// run's cumulative spend. Appends of one small line are atomic enough on a
// local FS for this purpose (worst case: a torn read undercounts one line).
export function ledgerPath(resultsDir) {
  return path.join(resultsDir, "ledger.jsonl");
}

export function ledgerAdd(resultsDir, cell, usd) {
  appendJsonl(ledgerPath(resultsDir), { t: Date.now(), cell, usd });
}

export function ledgerTotal(resultsDir) {
  let sum = 0;
  for (const row of readJsonl(ledgerPath(resultsDir))) sum += row.usd || 0;
  return sum;
}

export function abortMarker(resultsDir) {
  return path.join(resultsDir, "ABORTED");
}

export function budgetGuard(resultsDir, capUsd, cell) {
  if (fs.existsSync(abortMarker(resultsDir))) {
    throw new Error(`run aborted (marker present) — cell ${cell}`);
  }
  const total = ledgerTotal(resultsDir);
  if (total >= capUsd) {
    fs.writeFileSync(abortMarker(resultsDir), `budget cap $${capUsd} reached: $${total.toFixed(2)}\n`);
    throw new Error(`budget cap $${capUsd} reached ($${total.toFixed(2)}) — aborting cell ${cell}`);
  }
  return total;
}

// ---------- bench config (kept OUTSIDE the repo: keys + account creds) ----------
export function loadBenchEnv() {
  const file = process.env.BENCH_ENV ?? path.join(os.homedir(), ".config", "caching-bench", "env");
  const out = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) out[m[1]] = m[2];
    }
  }
  return out;
}

export function benchKeysPath() {
  return path.join(os.homedir(), ".config", "caching-bench", "keys.json");
}

export function loadBenchKeys() {
  const p = benchKeysPath();
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
}

export function saveBenchKeys(obj) {
  fs.writeFileSync(benchKeysPath(), JSON.stringify(obj, null, 2), { mode: 0o600 });
}

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
