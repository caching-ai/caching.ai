"use client";
// One shared, collapsible visual explainer for the key-settings page.
// Rendered once above the key list (not per key card) — pure HTML/CSS
// panels in the same visual language as the landing FeatureThumbs.
import { useState } from "react";
import { useI18n } from "./I18nProvider";

function Panel({ title, caption, children }: {
  title: string; caption: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-hairline bg-white p-4">
      <div className="text-[14px] font-medium text-ink">{title}</div>
      <div className="mt-3">{children}</div>
      <p className="mt-3 text-[13.5px] leading-relaxed text-mute">{caption}</p>
    </div>
  );
}

function Track({ children }: { children?: React.ReactNode }) {
  return <div className="relative h-2 flex-1 rounded-full bg-[#eeeeee]">{children}</div>;
}

export default function CacheVisualGuide() {
  const { dict } = useI18n();
  const g = dict.console.guide;
  const [open, setOpen] = useState(false);

  return (
    <section className="card !py-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
        aria-expanded={open}
        data-testid="cache-visual-guide-toggle"
      >
        <span className="text-[16px] font-medium text-ink">{open ? g.hide : g.toggle}</span>
        <span className={`text-[13px] text-mute transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>▾</span>
      </button>

      {open && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2" data-testid="cache-visual-guide">
          {/* 1 — auto cache_control: stable prefix marked, tail free to change */}
          <Panel title={g.inject.title} caption={g.inject.caption}>
            <div className="flex flex-col gap-1.5 font-mono text-[11px] leading-relaxed" aria-hidden>
              <div className="rounded bg-[#00d722]/10 px-1.5 py-0.5 text-[#046a12]">
                <span className="text-[#00a51b]/60">1</span>&nbsp;&nbsp;{g.inject.line1}
              </div>
              <div className="flex items-center justify-between rounded bg-[#00d722]/10 px-1.5 py-0.5 text-[#046a12]">
                <span><span className="text-[#00a51b]/60">2</span>&nbsp;&nbsp;{g.inject.line2}</span>
                <span className="rounded bg-[#00d722]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#008a16]">
                  {g.inject.mark}
                </span>
              </div>
              <div className="flex items-center justify-between px-1.5 text-body-mid">
                <span><span className="text-mute">3</span>&nbsp;&nbsp;{g.inject.tail}</span>
                <span className="text-[10px] text-mute">{g.inject.tailNote}</span>
              </div>
            </div>
          </Panel>

          {/* 2 — TTL 5m vs 1h: same two late calls, miss vs hit */}
          <Panel title={g.ttl.title} caption={g.ttl.caption}>
            <div className="flex flex-col gap-3" aria-hidden>
              {([
                { label: g.ttl.row5m, warmPct: 9, ok: false, chip: g.ttl.full, chipCls: "bg-[#ee1d36]/10 text-[#b3122a]" },
                { label: g.ttl.row1h, warmPct: 100, ok: true, chip: g.ttl.cached, chipCls: "bg-[#00d722]/15 text-[#008a16]" },
              ] as const).map((row) => (
                <div key={row.label}>
                  <div className="mb-1 flex items-center justify-between text-[10px] text-mute">
                    <span>{row.label}</span>
                    <span className={`rounded px-1.5 py-0.5 font-mono font-semibold ${row.chipCls}`}>
                      {row.ok ? "✓" : "✕"} {row.chip} ×2
                    </span>
                  </div>
                  <Track>
                    <div
                      className={`h-2 rounded-full ${row.ok ? "bg-[#00d722]/60" : "bg-[#c8cdd4]"}`}
                      style={{ width: `${row.warmPct}%` }}
                    />
                    {[37, 78].map((left) => (
                      <span
                        key={left}
                        className={`absolute top-1/2 flex h-3.5 w-3.5 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white font-mono text-[8px] font-bold text-white ${
                          row.ok ? "bg-[#00a51b]" : "bg-[#ee1d36]"
                        }`}
                        style={{ left: `${left}%` }}
                      >
                        {row.ok ? "✓" : "✕"}
                      </span>
                    ))}
                  </Track>
                </div>
              ))}
              <div className="flex justify-between font-mono text-[10px] text-mute">
                <span>{g.ttl.axis0}</span><span>{g.ttl.axisMid}</span><span>{g.ttl.axisEnd}</span>
              </div>
            </div>
          </Panel>

          {/* 3 — cache warming: expiring vs kept warm by pings */}
          <Panel title={g.warming.title} caption={g.warming.caption}>
            <div className="flex flex-col gap-3" aria-hidden>
              <div>
                <div className="mb-1 flex justify-between text-[10px] text-mute">
                  <span>{g.warming.without}</span>
                  <span className="text-error">✕ {g.warming.expired} 5:00</span>
                </div>
                <Track>
                  <div className="h-2 w-[30%] rounded-full bg-[#c8cdd4]" />
                  <span className="absolute left-[30%] top-1/2 -translate-y-1/2 font-mono text-[10px] text-error">✕</span>
                </Track>
              </div>
              <div>
                <div className="mb-1 flex justify-between text-[10px] text-mute">
                  <span>{g.warming.with}</span>
                  <span className="text-[#008a16]">✓ {g.warming.warm}</span>
                </div>
                <Track>
                  <div className="h-2 w-[94%] rounded-full bg-[#00d722]/70" />
                  {[30, 52, 74].map((left) => (
                    <span
                      key={left}
                      className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 border-white bg-[#00a51b]"
                      style={{ left: `${left}%` }}
                    />
                  ))}
                </Track>
                <div className="mt-1 text-right font-mono text-[10px] text-[#008a16]">● {g.warming.ping} ×3</div>
              </div>
            </div>
          </Panel>

          {/* 4 — OpenAI 24h retention: provider holds the cache, zero pings */}
          <Panel title={g.retention.title} caption={g.retention.caption}>
            <div className="flex flex-col gap-3" aria-hidden>
              <div>
                <div className="mb-1 flex justify-between text-[10px] text-mute">
                  <span>{g.retention.held}</span>
                  <span className="rounded bg-[#00d722]/15 px-1.5 py-0.5 font-mono font-semibold text-[#008a16]">24h</span>
                </div>
                <Track>
                  <div className="h-2 w-full rounded-full bg-[#00d722]/60" />
                </Track>
              </div>
              <div className="flex items-center gap-2 border-t border-hairline pt-2.5">
                <span className="font-mono text-[11px] text-mute line-through">● ● ●</span>
                <span className="text-[11px] text-mute">{g.retention.noPing}</span>
              </div>
            </div>
          </Panel>
        </div>
      )}
    </section>
  );
}
