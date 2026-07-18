// Renders the BENCHMARK.md charts from a run's summary.json as static SVG,
// one light and one dark variant each (GitHub <picture> handles the switch).
//
//   node bench/chart.mjs --run-id run-XXXX
//
// Encoding notes (dataviz method): arms are categorical identity — fixed slot
// order A=blue, B=green, C=magenta (validated adjacent order); values are
// direct-labeled since the magenta step is sub-3:1 on the light surface; text
// wears ink tokens, never series color; one axis (% of arm A's cost).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const runId = args["run-id"];
if (!runId) { console.error("usage: node bench/chart.mjs --run-id X"); process.exit(2); }
const resultsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "results", runId);
const summary = JSON.parse(fs.readFileSync(path.join(resultsDir, "summary.json"), "utf8"));
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".github", "assets");
fs.mkdirSync(outDir, { recursive: true });

const THEME = {
  light: {
    surface: "#fcfcfb", ink: "#0b0b0b", ink2: "#52514e", muted: "#898781",
    grid: "#e1e0d9", baseline: "#c3c2b7",
    A: "#2a78d6", B: "#008300", C: "#e87ba4", Cping: "#c4577f",
  },
  dark: {
    surface: "#1a1a19", ink: "#ffffff", ink2: "#c3c2b7", muted: "#898781",
    grid: "#2c2c2a", baseline: "#383835",
    A: "#3987e5", B: "#008300", C: "#d55181", Cping: "#e87ba4",
  },
};
const FONT = `system-ui, -apple-system, 'Segoe UI', sans-serif`;

const cellOf = (scenario, alias) => summary.find((r) => r.scenario === scenario && r.alias === alias);
const pctOfA = (row, arm) => {
  const a = row.arms.A?.inputSideUsd?.mean;
  if (!a) return null;
  const v = arm === "C" ? (row.arms.C?.netUsd?.mean ?? row.arms.C?.inputSideUsd?.mean) : row.arms[arm]?.inputSideUsd?.mean;
  return v == null ? null : (v / a) * 100;
};

/**
 * Grouped horizontal bars: groups = rows of {label, sub, bars:[{arm, pct, note}]}.
 * X axis = % of arm A input-side cost (A always 100).
 */
function grouped(t, { title, subtitle, groups, footnote }) {
  const W = 880, PADL = 200, PADR = 170, barH = 16, barGap = 4, groupGap = 18;
  const maxPct = Math.max(120, ...groups.flatMap((g) => g.bars.map((b) => b.pct ?? 0))) * 1.02;
  const plotW = W - PADL - PADR;
  const x = (v) => PADL + (v / maxPct) * plotW;
  let y = 86;
  const rows = [];
  for (const g of groups) {
    const gh = g.bars.length * (barH + barGap) - barGap;
    rows.push({ ...g, y, gh });
    y += gh + groupGap;
  }
  const H = y + 46;
  const ticks = [0, 25, 50, 75, 100].filter((v) => v <= maxPct);
  if (maxPct > 120) ticks.push(Math.round(maxPct / 25) * 25);

  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}">
<rect width="${W}" height="${H}" fill="${t.surface}"/>
<text x="24" y="34" font-family="${FONT}" font-size="17" font-weight="650" fill="${t.ink}">${title}</text>
<text x="24" y="56" font-family="${FONT}" font-size="12.5" fill="${t.ink2}">${subtitle}</text>`;
  for (const v of ticks) {
    s += `<line x1="${x(v)}" y1="76" x2="${x(v)}" y2="${H - 40}" stroke="${v === 100 ? t.baseline : t.grid}" stroke-width="1"${v === 100 ? ` stroke-dasharray="3 3"` : ""}/>
<text x="${x(v)}" y="${H - 24}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${t.muted}">${v}%</text>`;
  }
  for (const g of rows) {
    s += `<text x="24" y="${g.y + g.gh / 2 - 2}" font-family="${FONT}" font-size="13" font-weight="600" fill="${t.ink}">${g.label}</text>`;
    if (g.sub) s += `<text x="24" y="${g.y + g.gh / 2 + 13}" font-family="${FONT}" font-size="11" fill="${t.muted}">${g.sub}</text>`;
    let by = g.y;
    for (const b of g.bars) {
      if (b.pct == null) { by += barH + barGap; continue; }
      const w = Math.max(2, x(b.pct) - x(0));
      const color = t[b.colorKey ?? b.arm];
      s += `<rect x="${x(0)}" y="${by}" width="${w}" height="${barH}" rx="0" fill="${color}"/>
<rect x="${x(0) + w - Math.min(4, w)}" y="${by}" width="${Math.min(4, w)}" height="${barH}" rx="2" fill="${color}"/>
<text x="${x(0) - 8}" y="${by + barH - 4}" text-anchor="end" font-family="${FONT}" font-size="11" fill="${t.ink2}">${b.arm}</text>
<text x="${x(b.pct) + 8}" y="${by + barH - 4}" font-family="${FONT}" font-size="11.5" font-weight="600" fill="${t.ink}">${b.pct.toFixed(0)}%${b.note ? `<tspan dx="6" font-size="11" font-weight="400" fill="${t.muted}">${b.note}</tspan>` : ""}</text>`;
      by += barH + barGap;
    }
  }
  if (footnote) s += `<text x="24" y="${H - 8}" font-family="${FONT}" font-size="11" fill="${t.muted}">${footnote}</text>`;
  s += `</svg>\n`;
  return s;
}

const write = (name, make) => {
  for (const mode of ["light", "dark"]) {
    fs.writeFileSync(path.join(outDir, `${name}-${mode}.svg`), make(THEME[mode]));
  }
  console.log(`${name}-{light,dark}.svg written`);
};

// ---------- chart 1: all six scenarios on claude-haiku-4-5 ----------
const SCEN_LABELS = {
  S1: ["S1 agent loop", "40 calls, 0–90s gaps"],
  S2: ["S2 sparse support", "12 calls, 6–9 min idle"],
  S3: ["S3 timestamp breaker", "prefix changes every call"],
  S4: ["S4 classify batch", "300 back-to-back calls"],
  S5: ["S5 lunch break", "45 min idle"],
  S6: ["S6 steady traffic", "60 calls, 30s apart"],
};
write("bench-scenarios", (t) => grouped(t, {
  title: "Input-side cost vs calling Anthropic directly — claude-haiku-4.5",
  subtitle: "A = direct (no cache hints) · B = direct, hand-tuned cache_control · C = caching.ai, net of keep-alive pings. 100% = A. Lower is better.",
  footnote: "Provider-reported usage × list prices · Anthropic cells: mean of 3 runs",
  groups: Object.keys(SCEN_LABELS).map((sid) => {
    const row = cellOf(sid, "haiku");
    if (!row) return null;
    return {
      label: SCEN_LABELS[sid][0], sub: SCEN_LABELS[sid][1],
      bars: ["A", "B", "C"].map((arm) => row.arms[arm] && ({
        arm, pct: pctOfA(row, arm),
        note: arm === "C" && row.arms.C.pings ? `+${Math.round(row.arms.C.pings / 3)} pings` : undefined,
      })).filter(Boolean),
    };
  }).filter(Boolean),
}));

// ---------- chart 2: S2 flagship across models ----------
const MODEL_LABELS = {
  haiku: ["claude-haiku-4.5", "5m cache TTL"],
  sonnet: ["claude-sonnet-5", "5m cache TTL"],
  gpt4o: ["gpt-4o", "in-memory ~5–10m cache"],
  gpt56: ["gpt-5.6", "breakpoint caching (5.6+)"],
  gpt55: ["gpt-5.5", "24h retention upstream"],
  gemini25: ["gemini-2.5-flash", "implicit cache, no knobs"],
};
write("bench-s2-models", (t) => grouped(t, {
  title: "S2 sparse support (6–9 min idle) — cost vs direct, by model",
  subtitle: "100% = arm A (direct). C = caching.ai net of keep-alive ping cost. Lower is better.",
  footnote: "A ≡ B on OpenAI/Gemini (caching is automatic there — no knob to hand-tune) · provider-reported usage × list prices",
  groups: Object.keys(MODEL_LABELS).map((alias) => {
    const row = cellOf("S2", alias);
    if (!row) return null;
    return {
      label: MODEL_LABELS[alias][0], sub: MODEL_LABELS[alias][1],
      bars: ["A", "B", "C"].map((arm) => row.arms[arm] && ({
        arm, pct: pctOfA(row, arm),
        note: arm === "C" && row.arms.C.pings ? `+${Math.round(row.arms.C.pings / 3)} pings` : undefined,
      })).filter(Boolean),
    };
  }).filter(Boolean),
}));
console.log("done");
