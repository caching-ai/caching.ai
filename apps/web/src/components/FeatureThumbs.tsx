// Pure HTML/CSS product-style illustrations for the landing feature cards.
// They sit inside colored accent cards as small "screenshot" panels.
import type { Dict } from "@/lib/i18n/shared";

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-black/10 bg-white p-4 shadow-[0_8px_20px_rgba(0,0,0,0.12)]">
      {children}
    </div>
  );
}

/** Analytics: mini bar chart climbing toward a hit-rate chip */
export function AnalyticsThumb({ t }: { t: Dict["features"]["thumb"] }) {
  const bars = [22, 30, 26, 44, 52, 68, 84];
  return (
    <Panel>
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[20px] font-semibold text-[#00a51b]">$412</span>
          <span className="text-[11px] text-mute">{t.saved}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[14px] font-medium text-error">$88</span>
          <span className="text-[11px] text-mute">{t.wasted}</span>
        </div>
      </div>
      <div className="mt-3 flex h-16 items-end gap-1.5" aria-hidden>
        {bars.map((h, i) => (
          <div
            key={i}
            className="animate-bar flex-1 rounded-t-sm"
            style={{
              height: `${h}%`,
              backgroundColor: i >= 4 ? "#00d722" : "#c8cdd4",
              animationDelay: `${i * 90}ms`,
            }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-hairline pt-2">
        <span className="font-mono text-[11px] text-mute">7d</span>
        <span className="rounded bg-[#00d722]/15 px-1.5 py-0.5 font-mono text-[11px] font-medium text-[#008a16]">
          hit 72% ↑
        </span>
      </div>
    </Panel>
  );
}

/** Guard: prompt diff with the timestamp line flagged */
export function GuardThumb({ t }: { t: Dict["features"]["thumb"] }) {
  return (
    <Panel>
      <div className="flex flex-col gap-1.5 font-mono text-[11px] leading-relaxed" aria-hidden>
        <div className="text-body-mid">
          <span className="text-mute">1</span>&nbsp;&nbsp;&quot;system&quot;: &quot;You are a support agent…
        </div>
        <div className="rounded bg-[#ee1d36]/10 px-1 text-[#b3122a]">
          <span className="text-[#ee1d36]/60">2</span>&nbsp;&nbsp;Current time: 12:04:07 ⚠
        </div>
        <div className="text-body-mid">
          <span className="text-mute">3</span>&nbsp;&nbsp;&quot;tools&quot;: [ … ]
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-2.5">
        <span className="rounded bg-warn/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-[#8a6100]">
          {t.detected}
        </span>
        <span className="text-[11px] text-mute">{t.breakerLine}</span>
      </div>
    </Panel>
  );
}

/** Keep-Alive: two TTL timelines — expiring vs kept warm by pings */
export function KeepAliveThumb({ t }: { t: Dict["features"]["thumb"] }) {
  return (
    <Panel>
      <div className="flex flex-col gap-3" aria-hidden>
        <div>
          <div className="mb-1 flex justify-between text-[10px] text-mute">
            <span>{t.withoutUs}</span>
            <span className="text-error">✕ {t.expires} 5:00</span>
          </div>
          <div className="relative h-2 rounded-full bg-[#eeeeee]">
            <div className="h-2 w-[38%] rounded-full bg-[#c8cdd4]" />
            <span className="absolute left-[38%] top-1/2 -translate-y-1/2 font-mono text-[10px] text-error">✕</span>
          </div>
        </div>
        <div>
          <div className="mb-1 flex justify-between text-[10px] text-mute">
            <span>{t.withUs}</span>
            <span className="text-[#008a16]">✓ {t.alive} 62:30</span>
          </div>
          <div className="relative h-2 rounded-full bg-[#eeeeee]">
            <div className="h-2 w-[94%] rounded-full bg-[#00d722]/70" />
            {[30, 52, 74].map((left, i) => (
              <span
                key={left}
                className="animate-ping-dot absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 border-white bg-[#00a51b]"
                style={{ left: `${left}%`, animationDelay: `${i * 0.8}s` }}
                title={t.ping}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-hairline pt-2 font-mono text-[10px] text-mute">
          <span>0:00</span>
          <span className="text-[#008a16]">● {t.ping} ×3 = $0.002</span>
          <span>62:30</span>
        </div>
      </div>
    </Panel>
  );
}

/** Auto-Tune: learned call gap → the cheaper TTL wins and is applied */
export function AdaptiveThumb({ t }: { t: Dict["features"]["thumb"] }) {
  return (
    <Panel>
      <div className="flex flex-col gap-3" aria-hidden>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-mute">{t.gapLabel}</span>
          <span className="rounded bg-[#3b89ff]/12 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#1d6ae5]">22 min</span>
        </div>
        <div className="relative h-2 rounded-full bg-[#eeeeee]">
          {[4, 18, 40, 66, 92].map((left, i) => (
            <span
              key={left}
              className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 border-white bg-[#3b89ff]"
              style={{ left: `${left}%`, animationDelay: `${i * 0.3}s` }}
            />
          ))}
        </div>
        <div className="flex flex-col gap-1.5 font-mono text-[11px]">
          <div className="flex items-center justify-between rounded-md border border-hairline px-2 py-1.5 text-mute">
            <span>{t.opt5m}</span>
            <span>$31.40</span>
          </div>
          <div className="flex items-center justify-between rounded-md border border-[#00a51b]/40 bg-[#00d722]/10 px-2 py-1.5 text-[#007012]">
            <span className="font-semibold">{t.opt1h}</span>
            <span className="font-semibold">$20.72 · −34%</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 border-t border-hairline pt-2 text-[11px] text-[#008a16]">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="8" fill="#00a51b" />
            <path d="M4.5 8.2l2.3 2.3 4.7-4.9" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t.autoApplied}
        </div>
      </div>
    </Panel>
  );
}

/** Hero: a small fake console window with live-ish numbers */
export function HeroMock({ t }: { t: Dict["hero"]["mock"] }) {
  const bars = [18, 26, 24, 38, 46, 62, 58, 78, 90];
  return (
    <div className="mx-auto mt-14 max-w-3xl rounded-card border border-hairline bg-canvas shadow-featured">
      <div className="flex items-center gap-1.5 border-b border-hairline px-4 py-2.5" aria-hidden>
        <span className="h-2.5 w-2.5 rounded-full bg-[#ee1d36]/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-warn/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#00d722]/70" />
        <span className="ml-3 font-mono text-[11px] text-mute">caching.ai/console</span>
      </div>
      <div className="grid gap-4 p-5 sm:grid-cols-[1fr_1fr_1.4fr]">
        <div className="rounded-lg border border-hairline p-3 text-left">
          <div className="text-[10px] font-medium tracking-wide text-mute">{t.wasted}</div>
          <div className="font-mono text-[22px] font-semibold text-error">$88.20</div>
        </div>
        <div className="rounded-lg border border-hairline p-3 text-left">
          <div className="text-[10px] font-medium tracking-wide text-mute">{t.saved}</div>
          <div className="font-mono text-[22px] font-semibold text-[#00a51b]">$412.55</div>
        </div>
        <div className="rounded-lg border border-hairline p-3 text-left">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium tracking-wide text-mute">{t.hitRate}</span>
            <span className="font-mono text-[13px] font-semibold text-ink">72.4%</span>
          </div>
          <div className="mt-1.5 flex h-9 items-end gap-1" aria-hidden>
            {bars.map((h, i) => (
              <div
                key={i}
                className="animate-bar flex-1 rounded-t-[2px]"
                style={{
                  height: `${h}%`,
                  backgroundColor: i >= 6 ? "#00d722" : "#dfe3e8",
                  animationDelay: `${i * 70}ms`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Personas: small CSS vignettes for the who-is-it-for cards */
export function PersonaProductThumb() {
  return (
    <div className="flex h-24 flex-col justify-center gap-1.5" aria-hidden>
      <div className="h-6 w-[88%] rounded-md bg-[#3b89ff]/15 px-2 py-1">
        <div className="h-1.5 w-3/4 rounded bg-[#3b89ff]/50" />
      </div>
      <div className="h-6 w-[88%] rounded-md bg-[#3b89ff]/15 px-2 py-1">
        <div className="h-1.5 w-2/3 rounded bg-[#3b89ff]/50" />
      </div>
      <div className="ml-auto h-6 w-[45%] rounded-md bg-[#eeeeee] px-2 py-1">
        <div className="h-1.5 w-1/2 rounded bg-[#c8cdd4]" />
      </div>
      <div className="mt-0.5 flex items-center gap-1.5">
        <span className="rounded bg-[#00d722]/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-[#008a16]">prefix cached ×1,204</span>
      </div>
    </div>
  );
}

export function PersonaFleetThumb() {
  return (
    <div className="grid h-24 grid-cols-3 gap-1.5" aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="rounded-md border border-hairline bg-[#0d0d0d] p-1.5">
          <div className="flex gap-0.5">
            <span className="h-1 w-1 rounded-full bg-[#ee1d36]/70" />
            <span className="h-1 w-1 rounded-full bg-warn/70" />
            <span className="h-1 w-1 rounded-full bg-[#00d722]/70" />
          </div>
          <div className="mt-1.5 h-1 w-3/4 rounded bg-white/25" />
          <div className="mt-1 h-1 w-1/2 rounded bg-white/15" />
          <span
            className={`mt-1.5 block h-1.5 w-1.5 rounded-full ${i === 4 ? "bg-warn" : "bg-[#00d722]"} ${i !== 4 ? "animate-ping-dot" : ""}`}
            style={{ animationDelay: `${i * 0.4}s` }}
          />
        </div>
      ))}
    </div>
  );
}

export function PersonaLeaderThumb() {
  const pts = "0,14 18,20 36,16 54,30 72,34 90,46 108,50 126,58";
  return (
    <div className="relative h-24" aria-hidden>
      <div className="absolute right-0 top-0 rounded bg-[#00d722]/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#008a16]">
        −38% MoM
      </div>
      <svg viewBox="0 0 126 64" className="h-full w-full" preserveAspectRatio="none">
        <polyline points={pts} fill="none" stroke="#00a51b" strokeWidth="2.5" strokeLinecap="round" />
        <polyline points="0,10 18,12 36,10 54,12 72,11 90,12 108,10 126,12" fill="none" stroke="#d8d8d8" strokeWidth="2" strokeDasharray="3 4" />
      </svg>
      <div className="absolute bottom-0 left-0 font-mono text-[10px] text-mute">AI spend</div>
    </div>
  );
}
