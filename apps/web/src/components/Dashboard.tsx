"use client";
import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "./I18nProvider";
import { fmt } from "@/lib/i18n/shared";
import Tip from "./Tooltip";
import {
  ResponsiveContainer, ComposedChart, Area, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";

interface Stats {
  windowDays: number;
  totals: {
    requests: number; inputTokens: number; cacheRead: number; cacheCreation: number;
    savedUsd: number; wastedUsd: number; costUsd: number; hitRate: number;
    keepaliveCost: number; keepalivePings: number;
  };
  days: { day: string; saved: number; wasted: number; hitRate: number; requests: number; keepalivePings: number; keepaliveCost: number }[];
  models: { model: string; requests: number; saved: number; wasted: number; cacheRead: number; cacheCreation: number; input: number; output: number; cost: number; latencyP50: number | null }[];
  recent: any[];
  latency: { p50: number; p95: number; sample: number } | null;
  heatmap: { dow: number; hour: number; requests: number }[];
  breakerWarning: { rate: number; sample: number } | null;
}

const WINDOWS = [7, 30, 90] as const;

const usd = (v: number) =>
  "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: v < 10 ? 4 : 2 });
const pct = (v: number) => (v * 100).toFixed(1) + "%";
const num = (v: number) => v.toLocaleString();
const ms = (v: number) => (v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`);

/**
 * One school-style grade for cache health: hit rate carries 70 points
 * (70%+ hit rate = full marks — that's a well-kept cache), the
 * saved-vs-wasted balance carries 30. Needs 20+ requests to be meaningful.
 */
function cacheGrade(s: Stats["totals"]): { letter: string; color: string } | null {
  if (s.requests < 20) return null;
  const hitScore = Math.min(s.hitRate / 0.7, 1) * 70;
  const cacheable = s.savedUsd + s.wastedUsd;
  const saveScore = (cacheable > 0 ? s.savedUsd / cacheable : 0) * 30;
  const score = hitScore + saveScore;
  if (score >= 85) return { letter: "A", color: "text-accent-green" };
  if (score >= 70) return { letter: "B", color: "text-accent-green" };
  if (score >= 50) return { letter: "C", color: "text-[#8a6100]" };
  if (score >= 30) return { letter: "D", color: "text-error" };
  return { letter: "F", color: "text-error" };
}

interface OptimizerBlock {
  provider: string;
  model: string;
  block: string;
  samples: number;
  changeRate: number;
}

function PrefixOptimizer() {
  const { dict } = useI18n();
  const t = dict.console.optimizer;
  const tips = dict.console.tips;
  const [blocks, setBlocks] = useState<OptimizerBlock[] | null>(null);

  useEffect(() => {
    fetch("/api/optimizer")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((j) => setBlocks(j.blocks))
      .catch(() => setBlocks([]));
  }, []);

  const unstable = (blocks ?? []).filter((b) => b.changeRate >= 0.5);
  const pctFmt = (v: number) => (v * 100).toFixed(0) + "%";

  return (
    <section className="card" data-testid="prefix-optimizer">
      <h2 className="flex items-center text-[19px] font-medium text-ink">
        {t.title}
        <Tip text={tips.optimizer} />
      </h2>
      <p className="mt-1 text-[15px] text-mute">{t.sub}</p>
      {blocks === null ? null : blocks.length === 0 ? (
        <p className="mt-4 text-[15px] text-mute">{t.empty}</p>
      ) : unstable.length === 0 ? (
        <p className="mt-4 text-[15px] text-accent-green">{t.allStable}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead>
              <tr className="border-b border-hairline text-left text-badge text-mute">
                {[t.colModel, t.colBlock, t.colChange, t.colAdvice].map((h) => (
                  <th key={h} className="py-3 pr-6 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {unstable.map((b) => (
                <tr key={`${b.provider}-${b.model}-${b.block}`} className="border-b border-hairline align-top last:border-0">
                  <td className="py-3 pr-6 font-mono whitespace-nowrap">{b.model}</td>
                  <td className="py-3 pr-6 whitespace-nowrap">
                    {(t.blockNames as any)[b.block] ?? b.block}
                  </td>
                  <td className="py-3 pr-6 text-error whitespace-nowrap">{pctFmt(b.changeRate)}</td>
                  <td className="py-3 leading-relaxed text-body-mid">
                    {(t.advice as any)[b.block] ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Requests by local weekday×hour. API buckets are UTC; shift client-side. */
function TrafficHeatmap({ cells }: { cells: Stats["heatmap"] }) {
  const { dict } = useI18n();
  const t = dict.console.dash;

  const grid: number[] = Array(168).fill(0);
  const offset = Math.round(-new Date().getTimezoneOffset() / 60);
  for (const c of cells) {
    const idx = (((c.dow * 24 + c.hour + offset) % 168) + 168) % 168;
    grid[idx] += c.requests;
  }
  const max = Math.max(...grid);
  if (max === 0) return null;

  const dayOrder = [1, 2, 3, 4, 5, 6, 0]; // Monday-first
  return (
    <section className="card" data-testid="traffic-heatmap">
      <h2 className="text-[19px] font-medium text-ink">{t.heatmapTitle}</h2>
      <p className="mt-1 text-[15px] text-mute">{t.heatmapSub}</p>
      <div className="mt-6 overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-[44px_repeat(24,minmax(0,1fr))] gap-[3px]">
            <span />
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="text-center font-mono text-[10px] text-mute">
                {h % 6 === 0 ? h : ""}
              </span>
            ))}
            {dayOrder.map((dow) => (
              <Fragment key={dow}>
                <span className="pr-2 text-right text-[12px] leading-4 text-mute">
                  {t.weekdays[dow]}
                </span>
                {Array.from({ length: 24 }, (_, h) => {
                  const v = grid[dow * 24 + h];
                  return (
                    <span
                      key={`${dow}-${h}`}
                      className="h-4 rounded-[3px]"
                      style={{ backgroundColor: v === 0 ? "#f2f2f2" : `rgba(0, 165, 27, ${0.15 + 0.75 * (v / max)})` }}
                      aria-label={`${t.weekdays[dow]} ${h}:00 — ${num(v)}`}
                    />
                  );
                })}
              </Fragment>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-end gap-1.5 text-[12px] text-mute">
            {t.legendLess}
            {[0, 0.25, 0.5, 0.75, 1].map((a) => (
              <span key={a} className="h-3 w-3 rounded-[3px]"
                style={{ backgroundColor: a === 0 ? "#f2f2f2" : `rgba(0, 165, 27, ${0.15 + 0.75 * a})` }} />
            ))}
            {t.legendMore}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Dashboard() {
  const { dict } = useI18n();
  const t = dict.console.dash;
  const tips = dict.console.tips;
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/stats?days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then(setStats)
      .catch(() => setError(t.loadError));
  }, [days]);

  if (error) return <p className="text-error">{error}</p>;
  if (!stats) return <p className="text-mute">{t.loading}</p>;

  const s2 = stats.totals;
  const empty = s2.requests === 0;
  const grade = cacheGrade(s2);
  const cacheable = s2.savedUsd + s2.wastedUsd;
  const activeDays = stats.days.length;
  const projected = activeDays >= 3 ? (s2.savedUsd / activeDays) * 30 : null;
  const windowLabels = { 7: t.p7, 30: t.p30, 90: t.p90 } as const;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display-md text-ink">{t.title}</h1>
          <p className="mt-1 text-[16px] text-mute">{fmt(t.sub, { n: days })}</p>
        </div>
        <div className="flex rounded-btn border border-hairline p-0.5" role="group" data-testid="window-select">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setDays(w)}
              className={`rounded-[6px] px-3.5 py-1.5 text-[14px] font-medium transition-colors ${
                days === w ? "bg-ink text-white" : "text-body-mid hover:text-ink"
              }`}
            >
              {windowLabels[w]}
            </button>
          ))}
        </div>
      </header>

      {empty && (
        <div className="card border-blue-info">
          <h2 className="text-[20px] font-medium text-ink">{t.emptyTitle}</h2>
          <p className="mt-2 text-body-mid">
            {t.emptyBody}{" "}
            <Link className="text-blue-deep" href="/console/keys">{t.emptyCta}</Link>
          </p>
        </div>
      )}

      {stats.breakerWarning && (
        <div className="rounded-card border border-warn bg-[#fff8e8] p-6" data-testid="breaker-warning">
          <div className="inline-flex items-center text-badge text-[#8a6100]">
            {t.breakerBadge}
            <Tip text={tips.breaker} />
          </div>
          <p className="mt-2 text-[16px] text-ink">
            {fmt(t.breakerBody, { rate: pct(stats.breakerWarning.rate), sample: stats.breakerWarning.sample })}
          </p>
        </div>
      )}

      {/* Hero metric: wasted spend */}
      <section className="grid gap-6 md:grid-cols-3">
        <div className="card md:col-span-1">
          <div className="inline-flex items-center text-badge text-mute">{t.wasted}<Tip text={tips.wasted} /></div>
          <div className="mt-2 font-mono text-[40px] font-medium leading-none text-error" data-testid="wasted">
            {usd(s2.wastedUsd)}
          </div>
          <p className="mt-3 text-[15px] text-mute">{t.wastedNote}</p>
        </div>
        <div className="card">
          <div className="inline-flex items-center text-badge text-mute">{t.saved}<Tip text={tips.saved} /></div>
          <div className="mt-2 font-mono text-[40px] font-medium leading-none text-accent-green" data-testid="saved">
            {usd(s2.savedUsd)}
          </div>
          <p className="mt-3 text-[15px] text-mute">{t.savedNote}</p>
        </div>
        <div className="card">
          <div className="inline-flex items-center text-badge text-mute">{t.hitRate}<Tip text={tips.hitRate} /></div>
          <div className="mt-2 font-mono text-[40px] font-medium leading-none text-ink">{pct(s2.hitRate)}</div>
          <p className="mt-3 text-[15px] text-mute">
            {fmt(t.hitRateNote, { read: num(s2.cacheRead), total: num(s2.inputTokens + s2.cacheRead + s2.cacheCreation) })}
          </p>
        </div>
      </section>

      {/* Grade · latency · projection */}
      <section className="grid gap-6 md:grid-cols-3">
        <div className="card !p-6" data-testid="cache-grade">
          <div className="inline-flex items-center text-badge text-mute">{t.grade}<Tip text={tips.grade} /></div>
          {grade ? (
            <>
              <div className={`mt-1 font-mono text-[40px] font-semibold leading-none ${grade.color}`}>{grade.letter}</div>
              <p className="mt-2 text-[14px] text-mute">
                {fmt(t.gradeNote, { hit: pct(s2.hitRate), ratio: cacheable > 0 ? pct(s2.savedUsd / cacheable) : "—" })}
              </p>
            </>
          ) : (
            <p className="mt-2 text-[15px] text-mute">{t.gradeLearning}</p>
          )}
        </div>
        <div className="card !p-6" data-testid="latency-card">
          <div className="inline-flex items-center text-badge text-mute">{t.latency}<Tip text={tips.latency} /></div>
          {stats.latency ? (
            <>
              <div className="mt-1 font-mono text-[40px] font-medium leading-none text-ink">{ms(stats.latency.p50)}</div>
              <p className="mt-2 text-[14px] text-mute">
                {fmt(t.latencyMeta, { p95: ms(stats.latency.p95), n: num(stats.latency.sample) })}
              </p>
            </>
          ) : (
            <p className="mt-2 text-[15px] text-mute">{t.latencyNone}</p>
          )}
        </div>
        <div className="card !p-6" data-testid="projection-card">
          <div className="inline-flex items-center text-badge text-mute">{t.projection}<Tip text={tips.projection} /></div>
          {projected !== null ? (
            <>
              <div className="mt-1 font-mono text-[40px] font-medium leading-none text-accent-green">{usd(projected)}</div>
              <p className="mt-2 text-[14px] text-mute">{fmt(t.projectionNote, { n: activeDays })}</p>
            </>
          ) : (
            <p className="mt-2 text-[15px] text-mute">{t.projectionLearning}</p>
          )}
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        {[
          [t.requests, num(s2.requests), null],
          [t.totalSpend, usd(s2.costUsd), null],
          [t.keepalive, s2.keepalivePings > 0 ? fmt(t.keepalivePings, { n: num(s2.keepalivePings), cost: usd(s2.keepaliveCost) }) : t.keepaliveNone, tips.keepaliveStat],
        ].map(([label, value, tip]) => (
          <div key={label as string} className="card !p-6">
            <div className="inline-flex items-center text-badge text-mute">
              {label}
              {tip && <Tip text={tip as string} />}
            </div>
            <div className="mt-1 font-mono text-[26px] text-ink">{value}</div>
          </div>
        ))}
      </section>

      {/* Daily chart */}
      <section className="card">
        <h2 className="text-[19px] font-medium text-ink">{t.chartTitle}</h2>
        <div className="mt-6 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={stats.days} margin={{ left: 8, right: 8 }}>
              <CartesianGrid stroke="#eeeeee" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 13, fill: "#898989" }} tickLine={false} axisLine={{ stroke: "#d8d8d8" }} />
              <YAxis tick={{ fontSize: 13, fill: "#898989" }} tickLine={false} axisLine={false}
                tickFormatter={(v: number) => "$" + v.toFixed(2)} />
              <YAxis yAxisId="pings" orientation="right" allowDecimals={false}
                tick={{ fontSize: 13, fill: "#3b89ff" }} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v: any, n: any) =>
                n === t.chartKeepalive ? [num(Number(v)), n] : [usd(Number(v)), n]} />
              <Legend />
              <Bar yAxisId="pings" dataKey="keepalivePings" name={t.chartKeepalive} fill="#3b89ff" fillOpacity={0.35} barSize={10} radius={[3, 3, 0, 0]} />
              <Area type="monotone" dataKey="saved" name={t.chartSaved} fill="#00d72226" stroke="#00d722" strokeWidth={2} />
              <Line type="monotone" dataKey="wasted" name={t.chartWasted} stroke="#ee1d36" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      <TrafficHeatmap cells={stats.heatmap} />

      {/* Model breakdown */}
      <section className="card !p-0 overflow-x-auto">
        <h2 className="px-8 pt-8 text-[19px] font-medium text-ink">{t.byModel}</h2>
        <table className="mt-4 w-full text-[15px]">
          <thead>
            <tr className="border-b border-hairline text-left text-badge text-mute">
              {[t.colModel, t.colRequests, t.colHitRate, t.colLatency, t.colInput, t.colCacheRead, t.colCacheWrite, t.colOutput, t.colSaved, t.colWasted].map((h) => (
                <th key={h} className="px-8 py-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stats.models.map((m) => {
              const denom = m.input + m.cacheRead;
              return (
                <tr key={m.model} className="border-b border-hairline last:border-0">
                  <td className="px-8 py-3 font-mono text-ink">{m.model || "(unknown)"}</td>
                  <td className="px-8 py-3">{num(m.requests)}</td>
                  <td className="px-8 py-3">{denom > 0 ? pct(m.cacheRead / denom) : "—"}</td>
                  <td className="px-8 py-3">{m.latencyP50 != null ? ms(m.latencyP50) : "—"}</td>
                  <td className="px-8 py-3">{num(m.input)}</td>
                  <td className="px-8 py-3">{num(m.cacheRead)}</td>
                  <td className="px-8 py-3">{num(m.cacheCreation)}</td>
                  <td className="px-8 py-3">{num(m.output)}</td>
                  <td className="px-8 py-3 text-accent-green">{usd(m.saved)}</td>
                  <td className="px-8 py-3 text-error">{usd(m.wasted)}</td>
                </tr>
              );
            })}
            {!stats.models.length && (
              <tr><td className="px-8 py-6 text-mute" colSpan={10}>{t.noRequests}</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <PrefixOptimizer />

      {/* Recent requests */}
      <section className="card !p-0 overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 px-8 pt-8">
          <div>
            <h2 className="text-[19px] font-medium text-ink">{t.recent}</h2>
            <p className="pt-1 text-[14px] text-mute">{t.recentNote}</p>
          </div>
          {!empty && (
            <a href={`/api/stats/export?days=${days}`} className="btn-secondary !min-h-[36px] !px-4 !py-1.5 !text-[14px]" data-testid="export-csv">
              {t.exportCsv}
            </a>
          )}
        </div>
        <table className="mt-4 w-full text-[15px]">
          <thead>
            <tr className="border-b border-hairline text-left text-badge text-mute">
              {[t.colTime, t.colModel, t.colStatus, t.colInput, t.colCacheRead, t.colOutput, t.colSaved, ""].map((h, i) => (
                <th key={i} className="px-8 py-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stats.recent.map((r, i) => (
              <tr key={i} className="border-b border-hairline last:border-0">
                <td className="px-8 py-3 whitespace-nowrap text-mute">{new Date(r.ts).toLocaleString()}</td>
                <td className="px-8 py-3 font-mono">{r.model}</td>
                <td className={`px-6 py-3 ${r.status >= 400 ? "text-error" : "text-accent-green"}`}>{r.status}</td>
                <td className="px-8 py-3">{num(Number(r.input_tokens))}</td>
                <td className="px-8 py-3">{num(Number(r.cache_read_tokens))}</td>
                <td className="px-8 py-3">{num(Number(r.output_tokens))}</td>
                <td className="px-8 py-3">{usd(Number(r.saved_usd))}</td>
                <td className="px-8 py-3">
                  {r.is_keepalive && <span className="rounded bg-accent-blue/10 px-2 py-0.5 text-badge text-blue-info">{t.tagKeepalive}</span>}
                  {r.cache_breaker_detected && <span className="rounded bg-warn/10 px-2 py-0.5 text-badge text-[#8a6100]">{t.tagBreaker}</span>}
                </td>
              </tr>
            ))}
            {!stats.recent.length && (
              <tr><td className="px-8 py-6 text-mute" colSpan={8}>{t.noRequests}</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
