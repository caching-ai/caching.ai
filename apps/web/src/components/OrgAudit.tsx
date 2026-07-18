"use client";
import { useEffect, useState } from "react";
import { useI18n } from "./I18nProvider";

interface Entry {
  id: number; created_at: string; actor_email: string;
  action: string; target: string; detail: any;
}

export default function OrgAudit() {
  const { dict } = useI18n();
  const t = dict.console.org.audit;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load(before = 0) {
    const r = await fetch(`/api/org/audit${before ? `?before=${before}` : ""}`);
    if (r.ok) {
      const j = await r.json();
      setEntries((prev) => (before ? [...prev, ...j.entries] : j.entries));
      setNextBefore(j.nextBefore);
    }
    setLoaded(true);
  }
  useEffect(() => { void load(); }, []);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display-md text-ink">{t.title}</h1>
          <p className="mt-1 text-[16px] text-mute">{t.sub}</p>
        </div>
        <a href="/api/org/audit?format=csv" className="btn-secondary !min-h-[36px] !px-4 !py-1.5 !text-[14px]">
          {t.exportCsv}
        </a>
      </header>

      <section className="card !p-0 overflow-x-auto" data-testid="org-audit">
        <table className="w-full text-[15px]">
          <thead>
            <tr className="border-b border-hairline text-left text-badge text-mute">
              {[t.colWhen, t.colActor, t.colAction, t.colTarget].map((h) => (
                <th key={h} className="px-6 py-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-hairline align-top last:border-0">
                <td className="px-6 py-3 whitespace-nowrap text-mute">{new Date(e.created_at).toLocaleString()}</td>
                <td className="px-6 py-3">{e.actor_email}</td>
                <td className="px-6 py-3 font-mono text-[14px]">{e.action}</td>
                <td className="px-6 py-3 break-all text-body-mid">
                  {e.target}
                  {e.detail && (
                    <span className="ml-2 text-[13px] text-mute">{JSON.stringify(e.detail)}</span>
                  )}
                </td>
              </tr>
            ))}
            {loaded && !entries.length && (
              <tr><td className="px-6 py-6 text-mute" colSpan={4}>{t.empty}</td></tr>
            )}
          </tbody>
        </table>
        {nextBefore && (
          <div className="border-t border-hairline p-4">
            <button className="btn-secondary !min-h-[36px] !px-4 !py-1.5 text-[14px]" onClick={() => load(nextBefore)}>
              {t.more}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
