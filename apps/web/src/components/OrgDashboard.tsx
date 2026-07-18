"use client";
import { useEffect, useState } from "react";
import { useI18n } from "./I18nProvider";
import { fmt } from "@/lib/i18n/shared";
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";

const WINDOWS = [7, 30, 90] as const;

const usd = (v: number) =>
  "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: v < 10 ? 4 : 2 });
const pct = (v: number) => (v * 100).toFixed(1) + "%";
const num = (v: number) => v.toLocaleString();

export default function OrgDashboard() {
  const { dict } = useI18n();
  const t = dict.console.org.dash;
  const td = dict.console.dash;
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);
  const [stats, setStats] = useState<any | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/org/stats?days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then(setStats)
      .catch(() => setError(t.loadError));
  }, [days]);

  if (error) return <p className="text-error">{error}</p>;
  if (!stats) return <p className="text-mute">{t.loading}</p>;

  const s = stats.totals;
  const empty = s.requests === 0;
  const windowLabels = { 7: td.p7, 30: td.p30, 90: td.p90 } as const;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display-md text-ink">{t.title}</h1>
          <p className="mt-1 text-[16px] text-mute">{stats.orgName} · {fmt(t.sub, { n: days })}</p>
        </div>
        <div className="flex items-center gap-3">
          {!empty && (
            <div className="flex gap-2">
              <a href={`/api/org/stats/export?days=${days}`} className="btn-secondary !min-h-[36px] !px-4 !py-1.5 !text-[14px]" data-testid="export-xlsx">
                {t.exportXlsx}
              </a>
              <a href={`/api/org/stats/pdf?days=${days}`} className="btn-secondary !min-h-[36px] !px-4 !py-1.5 !text-[14px]" data-testid="export-pdf">
                {t.exportPdf}
              </a>
            </div>
          )}
          <div className="flex rounded-btn border border-hairline p-0.5" role="group">
            {WINDOWS.map((w) => (
              <button key={w} onClick={() => setDays(w)}
                className={`rounded-[6px] px-3.5 py-1.5 text-[14px] font-medium transition-colors ${
                  days === w ? "bg-ink text-white" : "text-body-mid hover:text-ink"}`}>
                {windowLabels[w]}
              </button>
            ))}
          </div>
        </div>
      </header>

      {empty && (
        <div className="card border-blue-info">
          <h2 className="text-[20px] font-medium text-ink">{t.emptyTitle}</h2>
          <p className="mt-2 text-body-mid">{t.emptyBody}</p>
        </div>
      )}

      {/* org hero row */}
      <section className="grid gap-6 md:grid-cols-4">
        <div className="card !p-6">
          <div className="text-badge text-mute">{td.saved}</div>
          <div className="mt-2 font-mono text-[32px] font-medium leading-none text-accent-green" data-testid="org-saved">
            {usd(s.savedUsd)}
          </div>
        </div>
        <div className="card !p-6">
          <div className="text-badge text-mute">{td.wasted}</div>
          <div className="mt-2 font-mono text-[32px] font-medium leading-none text-error">{usd(s.wastedUsd)}</div>
        </div>
        <div className="card !p-6">
          <div className="text-badge text-mute">{td.hitRate}</div>
          <div className="mt-2 font-mono text-[32px] font-medium leading-none text-ink">{pct(s.hitRate)}</div>
        </div>
        <div className="card !p-6" data-testid="org-shared">
          <div className="text-badge text-mute">{t.shared}</div>
          <div className="mt-2 font-mono text-[32px] font-medium leading-none text-accent-green">
            {usd(s.sharedSavedUsd)}
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-mute">{fmt(t.sharedNote, { n: num(s.sharedHits) })}</p>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        {[
          [td.requests, num(s.requests)],
          [td.totalSpend, usd(s.costUsd)],
          [td.keepalive, s.keepalivePings > 0 ? fmt(td.keepalivePings, { n: num(s.keepalivePings), cost: usd(s.keepaliveCost) }) : td.keepaliveNone],
        ].map(([label, value]) => (
          <div key={label as string} className="card !p-6">
            <div className="text-badge text-mute">{label}</div>
            <div className="mt-1 font-mono text-[24px] text-ink">{value}</div>
          </div>
        ))}
      </section>

      {/* daily chart */}
      {!empty && (
        <section className="card">
          <h2 className="text-[19px] font-medium text-ink">{td.chartTitle}</h2>
          <div className="mt-6 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={stats.days} margin={{ left: 8, right: 8 }}>
                <CartesianGrid stroke="#eeeeee" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 13, fill: "#898989" }} tickLine={false} axisLine={{ stroke: "#d8d8d8" }} />
                <YAxis tick={{ fontSize: 13, fill: "#898989" }} tickLine={false} axisLine={false}
                  tickFormatter={(v: number) => "$" + v.toFixed(2)} />
                <Tooltip formatter={(v: any, n: any) => [usd(Number(v)), n]} />
                <Legend />
                <Area type="monotone" dataKey="saved" name={td.chartSaved} fill="#00d72226" stroke="#00d722" strokeWidth={2} />
                <Line type="monotone" dataKey="wasted" name={td.chartWasted} stroke="#ee1d36" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* opportunities */}
      <section className="card" data-testid="org-opportunities">
        <h2 className="text-[19px] font-medium text-ink">{t.opportunities}</h2>
        {stats.opportunities.length === 0 ? (
          <p className="mt-3 text-[15px] text-accent-green">{t.oppEmpty}</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {stats.opportunities.map((o: any, i: number) => (
              <li key={i} className="rounded-card border border-warn bg-[#fff8e8] px-4 py-3 text-[15px] leading-relaxed text-ink">
                {o.kind === "injection_off" && fmt(t.oppInjectionOff, { key: o.key, member: o.member, usd: usd(o.wastedUsd) })}
                {o.kind === "warming_off" && fmt(t.oppWarmingOff, { key: o.key, member: o.member, usd: usd(o.wastedUsd) })}
                {o.kind === "breaker" && fmt(t.oppBreaker, { key: o.key, member: o.member, rate: pct(o.rate) })}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* departments */}
      {stats.departments.length > 0 && (
        <BreakdownTable
          title={t.byDepartment}
          firstCol={t.colDepartment}
          rows={stats.departments}
          keyOf={(d: any) => d.department ?? t.unassigned}
          t={{ td, t }}
        />
      )}

      {/* members */}
      <section className="card !p-0 overflow-x-auto">
        <h2 className="px-8 pt-8 text-[19px] font-medium text-ink">{t.byMember}</h2>
        <table className="mt-4 w-full text-[15px]">
          <thead>
            <tr className="border-b border-hairline text-left text-badge text-mute">
              {[t.colMember, t.colDepartment, td.colRequests, td.colHitRate, t.colSpend, td.colSaved, td.colWasted, t.colShared].map((h) => (
                <th key={h} className="px-6 py-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stats.members.map((m: any) => (
              <tr key={m.userId} className="border-b border-hairline last:border-0">
                <td className="px-6 py-3">{m.email}</td>
                <td className="px-6 py-3 text-mute">{m.department ?? t.unassigned}</td>
                <td className="px-6 py-3">{num(m.requests)}</td>
                <td className="px-6 py-3">{pct(m.hitRate)}</td>
                <td className="px-6 py-3">{usd(m.cost)}</td>
                <td className="px-6 py-3 text-accent-green">{usd(m.saved)}</td>
                <td className="px-6 py-3 text-error">{usd(m.wasted)}</td>
                <td className="px-6 py-3 text-accent-green">{usd(m.sharedSavedUsd)}</td>
              </tr>
            ))}
            {!stats.members.length && (
              <tr><td className="px-8 py-6 text-mute" colSpan={8}>{td.noRequests}</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* models */}
      {stats.models.length > 0 && (
        <BreakdownTable
          title={td.byModel}
          firstCol={td.colModel}
          rows={stats.models}
          keyOf={(m: any) => m.model || "(unknown)"}
          mono
          t={{ td, t }}
        />
      )}

      {/* auto-tune activity */}
      <section className="card" data-testid="org-tuning">
        <h2 className="text-[19px] font-medium text-ink">{t.tuningTitle}</h2>
        {stats.tuning.length === 0 ? (
          <p className="mt-3 text-[15px] text-mute">{t.tuningEmpty}</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2 text-[15px] text-body-mid">
            {stats.tuning.map((d: any, i: number) => (
              <li key={i}>
                <span className="font-mono text-ink">{d.key_name}</span> · {d.setting}{" "}
                {d.old_value ? `${d.old_value} → ` : ""}{d.new_value}
                <span className="ml-2 text-[13px] text-mute">{new Date(d.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function BreakdownTable({
  title, firstCol, rows, keyOf, mono, t,
}: {
  title: string; firstCol: string; rows: any[]; keyOf: (x: any) => string; mono?: boolean;
  t: { td: any; t: any };
}) {
  const { td, t: to } = t;
  return (
    <section className="card !p-0 overflow-x-auto">
      <h2 className="px-8 pt-8 text-[19px] font-medium text-ink">{title}</h2>
      <table className="mt-4 w-full text-[15px]">
        <thead>
          <tr className="border-b border-hairline text-left text-badge text-mute">
            {[firstCol, td.colRequests, td.colHitRate, to.colSpend, td.colSaved, td.colWasted].map((h) => (
              <th key={h} className="px-6 py-3 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((x, i) => (
            <tr key={i} className="border-b border-hairline last:border-0">
              <td className={`px-6 py-3 ${mono ? "font-mono" : ""}`}>{keyOf(x)}</td>
              <td className="px-6 py-3">{num(x.requests)}</td>
              <td className="px-6 py-3">{pct(x.hitRate)}</td>
              <td className="px-6 py-3">{usd(x.cost)}</td>
              <td className="px-6 py-3 text-accent-green">{usd(x.saved)}</td>
              <td className="px-6 py-3 text-error">{usd(x.wasted)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
