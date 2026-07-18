import Link from "next/link";
import SavingsCalculator from "@/components/SavingsCalculator";
import Footer from "@/components/Footer";
import ProviderLogos from "@/components/ProviderLogos";
import {
  AnalyticsThumb,
  GuardThumb,
  KeepAliveThumb,
  AdaptiveThumb,
  PersonaProductThumb,
  PersonaFleetThumb,
  PersonaLeaderThumb,
} from "@/components/FeatureThumbs";
import ProviderCodeTabs from "@/components/ProviderCodeTabs";
import { getLocale } from "@/lib/i18n/server";
import { getDict } from "@/lib/i18n/shared";
import { getSession } from "@/lib/auth";
import { IconBolt, IconFlame, IconSnowflake, IconClock, IconLock, IconKey } from "@/components/icons";

export default async function Landing() {
  const locale = await getLocale();
  const d = getDict(locale);
  const sess = await getSession();

  const personaThumbs = [<PersonaProductThumb key="p" />, <PersonaFleetThumb key="f" />, <PersonaLeaderThumb key="l" />];
  const personaAccents = ["border-t-accent-blue", "border-t-accent-purple", "border-t-accent-orange"];

  const featureRows = [
    { data: d.featureDetail.analytics, tint: "bg-accent-blue/[0.07]", chip: "bg-accent-blue text-white", badge: null as string | null, thumb: <AnalyticsThumb t={d.features.thumb} /> },
    { data: d.featureDetail.guard, tint: "bg-accent-purple/[0.07]", chip: "bg-accent-purple text-white", badge: null as string | null, thumb: <GuardThumb t={d.features.thumb} /> },
    { data: d.featureDetail.keepalive, tint: "bg-accent-green/[0.07]", chip: "bg-accent-green text-ink", badge: null as string | null, thumb: <KeepAliveThumb t={d.features.thumb} /> },
    { data: d.featureDetail.adaptive, tint: "bg-accent-orange/[0.07]", chip: "bg-accent-orange text-ink", badge: d.featureDetail.adaptive.badge, thumb: <AdaptiveThumb t={d.features.thumb} /> },
  ];

  // yes/partial/no matrix for the comparison table — labels come from the dict.
  const comparisonCells: ("yes" | "part" | "no")[][] = [
    ["no", "part", "yes"],
    ["no", "no", "yes"],
    ["no", "no", "yes"],
    ["no", "part", "yes"],
    ["no", "no", "yes"],
    ["no", "no", "yes"],
  ];
  const cellMark = {
    yes: <span className="font-semibold text-[#008a16]">✓</span>,
    part: <span className="text-[#8a6100]">△</span>,
    no: <span className="text-mute-soft">—</span>,
  };

  // Trust section mini-visuals — index-matched to d.trust.items (same order in
  // every locale). Decorative only (aria-hidden on the container); any text is
  // a universal token (A/B, cipher name, numbers), so no i18n needed.
  const keyChip = (label: string) => (
    <span className="rounded bg-ink px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">{label}</span>
  );
  const trustVisuals: React.ReactNode[] = [
    // 1 — per-account cache isolation: two lanes that never touch
    <div key="iso" className="flex w-full flex-col gap-2">
      {(["A", "B"] as const).map((u) => (
        <div key={u} className="flex items-center gap-2">
          {keyChip(`key ${u}`)}
          <div className={`h-1.5 flex-1 rounded-full ${u === "A" ? "bg-accent-green/60" : "bg-accent-blue/50"}`} />
          <span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${u === "A" ? "border-accent-green/50 text-[#046a12]" : "border-accent-blue/50 text-blue-info"}`}>
            cache {u}
          </span>
        </div>
      ))}
    </div>,
    // 2 — keys encrypted at rest
    <div key="keys" className="flex w-full items-center justify-center gap-2.5">
      <IconKey size={20} className="text-ink" />
      <span className="text-mute">→</span>
      <span className="flex items-center gap-1.5 rounded-btn border-2 border-ink px-2.5 py-1.5 font-mono text-[11px] font-semibold text-ink">
        <IconLock size={13} className="shrink-0" /> AES-256-GCM
      </span>
    </div>,
    // 3 — prompt bodies vanish; only numbers remain
    <div key="body" className="flex w-full flex-col gap-1.5">
      <div className="flex flex-col gap-1 opacity-40">
        <div className="h-1.5 w-4/5 rounded-full bg-mute-soft line-through" style={{ textDecoration: "line-through" }} />
        <div className="h-1.5 w-3/5 rounded-full bg-mute-soft" />
      </div>
      <div className="flex flex-wrap gap-1.5 font-mono text-[10px]">
        <span className="rounded bg-ink/5 px-1.5 py-0.5 text-body-mid">1,204 tok</span>
        <span className="rounded bg-ink/5 px-1.5 py-0.5 text-body-mid">87 ms</span>
        <span className="rounded bg-ink/5 px-1.5 py-0.5 text-body-mid">#a3f2…</span>
        <span className="rounded bg-accent-green/15 px-1.5 py-0.5 font-semibold text-[#046a12]">✓ 200</span>
      </div>
    </div>,
    // 4 — byte-identical passthrough
    <div key="bytes" className="flex w-full items-center justify-center gap-2 font-mono text-[11px] text-body-mid">
      <span className="rounded bg-ink/5 px-2 py-1">0110 1011…</span>
      <span className="text-mute">→</span>
      <span className="rounded bg-ink/5 px-2 py-1">0110 1011…</span>
      <span className="font-semibold text-[#008a16]">=</span>
    </div>,
    // 5 — one-click wipe
    <div key="wipe" className="flex w-full flex-col justify-center gap-1.5">
      {[80, 60, 70].map((w, idx) => (
        <div key={idx} className="flex items-center gap-2" style={{ opacity: 1 - idx * 0.3 }}>
          <div className="h-1.5 rounded-full bg-mute-soft" style={{ width: `${w}%` }} />
          <span className="font-mono text-[10px] text-error">✕</span>
        </div>
      ))}
    </div>,
    // 6 — everything is a switch
    <div key="switch" className="flex w-full items-center justify-center gap-3">
      {[true, true, false].map((on, idx) => (
        <span key={idx} className={`flex h-5 w-9 items-center rounded-full p-0.5 transition-none ${on ? "justify-end bg-accent-green" : "justify-start bg-mute-soft"}`}>
          <span className="h-4 w-4 rounded-full bg-white shadow" />
        </span>
      ))}
    </div>,
  ];

  return (
    <main>
      {/* Nav */}
      <nav className="sticky top-0 z-20 border-b border-hairline bg-canvas/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" aria-label="caching.ai">
            <img src="/logo.png" alt="caching.ai" className="h-9 w-auto" />
          </Link>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/caching-ai/caching.ai"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
              className="text-body-mid transition-colors hover:text-ink"
            >
              <svg viewBox="0 0 16 16" width="22" height="22" fill="currentColor" aria-hidden>
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
            </a>
            <Link href="/docs" className="hidden text-[16px] text-body-mid hover:text-ink sm:block">
              {d.nav.docs}
            </Link>
            {sess ? (
              <Link href="/console" className="btn-primary !min-h-[40px] !py-2">
                {d.nav.dashboard}
              </Link>
            ) : (
              <Link href="/signup" className="btn-primary !min-h-[40px] !py-2">
                {d.nav.startFree}
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-12 pt-20 text-center">
        {/* timely hook: GPT-5.6 moved to opt-in (breakpoint) caching */}
        <a
          href="#benchmark"
          className="mx-auto mb-6 inline-flex max-w-full items-center gap-2 rounded-full border border-hairline bg-canvas px-4 py-1.5 text-[13px] text-body-mid transition-colors hover:border-ink/30 hover:text-ink"
        >
          <IconBolt size={14} className="shrink-0" />
          <span className="truncate">{d.hero.banner}</span>
          <span aria-hidden className="text-mute">→</span>
        </a>
        <p className="eyebrow">{d.hero.eyebrow}</p>
        <h1 className="mx-auto mt-4 max-w-4xl text-[42px] font-semibold leading-[1.1] tracking-[-0.8px] text-ink md:text-[72px]">
          {d.hero.titleA}
          <br />
          {d.hero.titleB}
        </h1>
        <p className="mx-auto mt-6 max-w-3xl text-[18px] text-body-mid [text-wrap:balance] md:text-[21px]">{d.hero.sub}</p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href={sess ? "/console" : "/signup"} className="btn-primary">
            {sess ? d.nav.dashboard : d.hero.ctaPrimary}
          </Link>
          <Link href="/docs" className="btn-secondary">{d.hero.ctaSecondary}</Link>
        </div>
        <p className="mt-4 text-sm text-mute">{d.hero.note}</p>
        {/* hero key visual: the keep-the-cache-warm robot (Nano Banana Pro) */}
        <img
          src="/hero-cache-warm.png"
          alt={`${d.hero.titleA} ${d.hero.titleB}`}
          className="mx-auto mt-14 w-full max-w-4xl"
          width={1376}
          height={510}
        />
        {/* provider strip */}
        <div className="mx-auto mt-12 flex max-w-3xl flex-col items-center gap-4">
          <span className="text-[13px] font-medium tracking-[1.5px] text-mute-soft">{d.providers.label}</span>
          <ProviderLogos />
        </div>
      </section>

      {/* Problem: stat cards */}
      <section className="border-y border-hairline bg-[#fafafa]">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="mx-auto max-w-4xl text-center">
            <p className="eyebrow">{d.problem.eyebrow}</p>
            <h2 className="mt-3 whitespace-pre-line text-display-lg text-ink [text-wrap:balance]">{d.problem.title}</h2>
            <p className="mx-auto mt-5 max-w-3xl text-[17px] leading-relaxed text-body-mid [text-wrap:balance]">{d.problem.lead}</p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {d.problem.stats.map((s2) => (
              <div key={s2.value} className="card !p-7 text-center">
                <div className="font-mono text-[44px] font-semibold leading-none text-ink">{s2.value}</div>
                <div className="mt-2 text-badge uppercase tracking-[1px] text-mute">{s2.label}</div>
                <p className="mt-4 text-[15px] leading-relaxed text-body-mid">{s2.desc}</p>
              </div>
            ))}
          </div>
          {/* cache lifecycle, as one visual line */}
          <div className="mx-auto mt-12 max-w-4xl rounded-card border border-hairline bg-white p-6">
            <div className="text-[14px] font-medium text-ink">{d.visuals.lifeTitle}</div>
            <div className="mt-4 flex items-center gap-2">
              <div className="flex h-9 flex-[3] items-center justify-center rounded-btn bg-accent-green/15 px-2 text-[12.5px] font-medium text-[#046a12]">
                <IconFlame size={14} className="shrink-0" /> <span className="ml-1.5 hidden truncate sm:inline">{d.visuals.lifeWarm}</span>
              </div>
              <div className="flex flex-col items-center px-1 text-center">
                <IconClock size={14} className="text-mute" />
                <span className="whitespace-nowrap text-[11.5px] text-mute">{d.visuals.lifeIdle}</span>
              </div>
              <div className="flex h-9 flex-[3] items-center justify-center rounded-btn bg-error/10 px-2 text-[12.5px] font-medium text-error">
                <IconSnowflake size={14} className="shrink-0" /> <span className="ml-1.5 hidden truncate sm:inline">{d.visuals.lifeCold}</span>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 text-[13px] text-[#046a12]">
              <div className="h-1.5 flex-1 rounded-full bg-accent-green" />
              <span className="shrink-0 font-medium">{d.visuals.lifeKeep}</span>
              <div className="h-1.5 flex-1 rounded-full bg-accent-green" />
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-mute sm:hidden">{d.visuals.lifeWarm} → {d.visuals.lifeCold}</p>
          </div>
          <p className="mt-10 text-center text-[17px] font-medium text-ink">{d.problem.closing}</p>
        </div>
      </section>

      {/* Benchmark: measured results (BENCHMARK.md is the long-form source) */}
      <section id="benchmark" className="mx-auto max-w-6xl px-6 py-20">
        <p className="eyebrow text-center">{d.bench.eyebrow}</p>
        <h2 className="mx-auto mt-3 max-w-4xl whitespace-pre-line text-center text-display-lg text-ink [text-wrap:balance]">{d.bench.title}</h2>
        <p className="mx-auto mt-5 max-w-3xl whitespace-pre-line text-center text-[17px] leading-relaxed text-body-mid [text-wrap:balance]">{d.bench.lead}</p>

        <div className="mt-12 grid gap-6 lg:grid-cols-[3fr_2fr]">
          {/* three-arm cost bars — S2 sparse support, claude-haiku-4.5 */}
          <div className="card !p-8">
            <h3 className="text-[15px] font-medium text-ink">{d.bench.chartTitle}</h3>
            <div className="mt-7 flex flex-col gap-6">
              {[
                { label: d.bench.arms.direct, pct: 100, cls: "bg-ink/50", note: null as string | null, big: false },
                { label: d.bench.arms.tuned, pct: 125, cls: "bg-accent-orange", note: d.bench.tunedFlag, big: false },
                { label: d.bench.arms.us, pct: 33, cls: "bg-accent-green", note: d.bench.usFlag, big: true },
              ].map((b) => (
                <div key={b.label}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={`text-[14.5px] ${b.big ? "font-semibold text-ink" : "text-body-mid"}`}>{b.label}</span>
                    <span className={`font-mono leading-none ${b.big ? "text-[24px] font-semibold text-ink" : "text-[15px] text-body-mid"}`}>
                      {b.pct}%
                    </span>
                  </div>
                  <div className="mt-2 h-4 w-full overflow-hidden rounded-full bg-[#efefec]">
                    <div className={`h-full rounded-full ${b.cls}`} style={{ width: `${(b.pct / 125) * 100}%` }} />
                  </div>
                  {b.note && <p className="mt-1.5 text-[13px] leading-snug text-mute">{b.note}</p>}
                </div>
              ))}
            </div>
            <p className="mt-6 text-[13px] text-mute">{d.bench.chartNote}</p>
          </div>
          {/* headline stats */}
          <div className="flex flex-col gap-6">
            {d.bench.stats.map((s3) => (
              <div key={s3.value} className="card flex flex-1 items-center gap-6 !p-6">
                <div className="font-mono text-[42px] font-semibold leading-none text-ink">{s3.value}</div>
                <div>
                  <div className="text-[15.5px] font-medium text-ink">{s3.label}</div>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-body-mid">{s3.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* latency: cache hits skip prefill — measured TTFT, gpt-4o S2 */}
        <div className="mx-auto mt-8 max-w-4xl rounded-card border border-hairline bg-white p-7">
          <h3 className="flex items-center gap-2 text-[17px] font-semibold text-ink"><IconBolt size={16} className="shrink-0" /> {d.bench.latencyTitle}</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-body-mid">{d.bench.latencyLead}</p>
          <div className="mt-6 flex flex-col gap-5">
            {[
              { label: d.bench.latencyP50, a: 865, c: 597 },
              { label: d.bench.latencyP95, a: 2067, c: 755 },
            ].map((row) => (
              <div key={row.label}>
                <div className="text-[13.5px] font-medium text-body-mid">{row.label}</div>
                {[
                  { who: d.bench.latencyDirect, ms: row.a, cls: "bg-ink/50", strong: false },
                  { who: d.bench.latencyProxy, ms: row.c, cls: "bg-accent-green", strong: true },
                ].map((b) => (
                  <div key={b.who} className="mt-1.5 flex items-center gap-3">
                    <span className="w-24 shrink-0 text-[13px] text-mute">{b.who}</span>
                    <div className="relative h-4 flex-1 rounded-full bg-[#f1f1f1]">
                      <div className={`h-4 rounded-full ${b.cls}`} style={{ width: `${Math.round((b.ms / 2067) * 100)}%` }} />
                    </div>
                    <span className={`w-20 shrink-0 text-right font-mono text-[13.5px] ${b.strong ? "font-semibold text-[#046a12]" : "text-body-mid"}`}>
                      {b.ms.toLocaleString()} ms
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="mt-4 text-[12.5px] text-mute">{d.bench.latencyNote}</p>
        </div>

        <p className="mx-auto mt-9 max-w-3xl text-center text-[15.5px] leading-relaxed text-body-mid [text-wrap:balance]">{d.bench.honesty}</p>
        {/* localized doc targets: BENCHMARK.ko.md etc. exist for every product locale */}
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href={`https://github.com/caching-ai/caching.ai/blob/main/BENCHMARK${locale === "en" ? "" : `.${locale}`}.md`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
          >
            {d.bench.ctaFull}
          </a>
          <a
            href={locale === "en"
              ? "https://github.com/caching-ai/caching.ai/tree/main/bench"
              : `https://github.com/caching-ai/caching.ai/blob/main/bench/README.${locale}.md`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary"
          >
            {d.bench.ctaRaw}
          </a>
        </div>
        <p className="mt-4 text-center text-[13px] text-mute">{d.bench.date}</p>
      </section>

      {/* Who it's for */}
      <section className="border-t border-hairline mx-auto max-w-6xl px-6 py-20">
        <p className="eyebrow text-center">{d.personas.eyebrow}</p>
        <h2 className="mx-auto mt-3 max-w-3xl whitespace-pre-line text-center text-display-lg text-ink">{d.personas.title}</h2>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {d.personas.items.map((p, i) => (
            <div key={p.title} className={`card border-t-4 ${personaAccents[i]}`}>
              {personaThumbs[i]}
              <h3 className="mt-5 text-[22px] font-medium text-ink">{p.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-body-mid">{p.desc}</p>
              <ul className="mt-4 flex flex-col gap-2">
                {p.points.map((pt) => (
                  <li key={pt} className="flex items-start gap-2 text-[14px] text-body">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    {pt}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Feature detail: zigzag rows */}
      <section className="border-y border-hairline">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="eyebrow text-center">{d.featureDetail.eyebrow}</p>
          <h2 className="mx-auto mt-3 max-w-3xl text-center text-display-lg text-ink">{d.featureDetail.title}</h2>
          <div className="mt-14 flex flex-col gap-14">
            {featureRows.map((f, i) => (
              <div
                key={f.data.name}
                className={`grid items-center gap-8 md:grid-cols-2 ${i % 2 === 1 ? "md:[direction:rtl]" : ""}`}
              >
                <div className={`rounded-card p-8 md:p-12 [direction:ltr] ${f.tint}`}>{f.thumb}</div>
                <div className="[direction:ltr]">
                  <span className={`inline-block rounded-btn px-2.5 py-1 text-badge font-semibold ${f.chip}`}>
                    {f.data.name}
                  </span>
                  {f.badge && (
                    <span className="ml-2 inline-block rounded-btn border border-hairline px-2.5 py-1 text-badge font-semibold text-mute">
                      {f.badge}
                    </span>
                  )}
                  <h3 className="mt-4 text-[26px] font-medium leading-snug text-ink">{f.data.headline}</h3>
                  <p className="mt-3 text-[16px] leading-relaxed text-body-mid">{f.data.tagline}</p>
                  <ul className="mt-5 flex flex-col gap-3">
                    {f.data.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-3 text-[15.5px] leading-relaxed text-body">
                        <svg className="mt-1 shrink-0" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                          <circle cx="8" cy="8" r="8" fill="#080808" />
                          <path d="M4.5 8.2l2.3 2.3 4.7-4.9" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <p className="eyebrow text-center">{d.how.eyebrow}</p>
        <h2 className="mt-3 text-center text-display-lg text-ink">{d.how.title}</h2>
        {/* where the proxy sits, at a glance */}
        <div className="mx-auto mt-10 max-w-4xl rounded-card border border-hairline bg-white p-6">
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <div className="flex min-h-[56px] flex-1 items-center justify-center rounded-btn border border-hairline bg-canvas px-4 text-[14.5px] font-medium text-ink">
              {d.visuals.flowApp}
            </div>
            <div className="self-center text-[18px] text-mute" aria-hidden>→</div>
            <div className="flex-[2] rounded-btn border-2 border-ink bg-[#fafafa] px-4 py-3 text-center">
              <div className="flex items-center justify-center gap-1.5 text-[14.5px] font-semibold text-ink"><IconFlame size={15} className="shrink-0" /> {d.visuals.flowProxy}</div>
              <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                {d.visuals.flowChips.map((c) => (
                  <span key={c} className="rounded-full bg-accent-green/15 px-2.5 py-0.5 text-[12px] font-medium text-[#046a12]">{c}</span>
                ))}
              </div>
            </div>
            <div className="self-center text-[18px] text-mute" aria-hidden>→</div>
            <div className="flex min-h-[56px] flex-1 items-center justify-center rounded-btn border border-hairline bg-canvas px-4 text-center text-[13.5px] font-medium text-body-mid">
              {d.visuals.flowProvider}
            </div>
          </div>
          <p className="mt-4 text-center text-[13px] text-mute">{d.visuals.flowNote}</p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {[
            ["1", d.how.s1t, d.how.s1b],
            ["2", d.how.s2t, d.how.s2b],
            ["3", d.how.s3t, d.how.s3b],
          ].map(([n, title, body]) => (
            <div key={n} className="card">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-[18px] font-medium text-white">
                {n}
              </div>
              <h3 className="mt-5 text-[22px] font-medium text-ink">{title}</h3>
              <p className="mt-2 text-[16px] text-body-mid">{body}</p>
            </div>
          ))}
        </div>
        <ProviderCodeTabs codeBefore={d.how.codeBefore} codeAfter={d.how.codeAfter} />
      </section>

      {/* Comparison */}
      <section className="border-t border-hairline bg-[#fafafa]">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <p className="eyebrow text-center">{d.comparison.eyebrow}</p>
          <h2 className="mx-auto mt-3 max-w-3xl text-center text-display-lg text-ink">{d.comparison.title}</h2>
          <p className="mx-auto mt-5 max-w-2xl text-center text-[17px] leading-relaxed text-body-mid [text-wrap:balance]">{d.comparison.lead}</p>
          <div className="mt-12 overflow-x-auto rounded-card border border-hairline bg-canvas">
            <table className="w-full min-w-[640px] text-[15px]">
              <thead>
                <tr className="border-b border-hairline text-badge text-mute">
                  <th className="px-6 py-4 text-left font-medium" />
                  <th className="px-4 py-4 text-center font-medium">{d.comparison.colDirect}</th>
                  <th className="px-4 py-4 text-center font-medium">{d.comparison.colGateway}</th>
                  <th className="bg-accent-green/[0.08] px-4 py-4 text-center font-semibold text-ink">{d.comparison.colUs}</th>
                </tr>
              </thead>
              <tbody>
                {d.comparison.rows.map((label, i) => (
                  <tr key={label} className="border-b border-hairline last:border-0">
                    <td className="px-6 py-4 text-body">{label}</td>
                    {comparisonCells[i].map((v, j) => (
                      <td key={j} className={`px-4 py-4 text-center text-[17px] ${j === 2 ? "bg-accent-green/[0.08]" : ""}`}>
                        {cellMark[v]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-center text-[13px] text-mute">{d.comparison.legend}</p>
        </div>
      </section>

      {/* Open source vs cloud */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <p className="eyebrow text-center">{d.oss.eyebrow}</p>
        <h2 className="mx-auto mt-3 max-w-4xl whitespace-pre-line text-center text-display-lg text-ink [text-wrap:balance]">{d.oss.title}</h2>
        <p className="mx-auto mt-5 max-w-2xl text-center text-[17px] leading-relaxed text-body-mid [text-wrap:balance]">{d.oss.sub}</p>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {[
            { title: d.oss.commonT, items: d.oss.common, featured: false },
            { title: d.oss.cloudT, items: d.oss.cloud, featured: true },
            { title: d.oss.selfT, items: d.oss.self, featured: false },
          ].map((col) => (
            <div
              key={col.title}
              className={`card ${col.featured ? "border-2 border-ink shadow-featured" : ""}`}
            >
              <h3 className="text-badge tracking-[1.5px] text-mute">{col.title}</h3>
              <ul className="mt-4 flex flex-col gap-3">
                {col.items.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-[15.5px] leading-relaxed text-body">
                    <svg className="mt-1 shrink-0" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <circle cx="8" cy="8" r="8" fill={col.featured ? "#080808" : "#d8d8d8"} />
                      <path d="M4.5 8.2l2.3 2.3 4.7-4.9" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href={sess ? "/console" : "/signup"} className="btn-primary">{d.oss.ctaCloud}</Link>
          <a href="https://github.com/caching-ai/caching.ai" target="_blank" rel="noopener noreferrer" className="btn-secondary">
            {d.oss.ctaGit}
          </a>
        </div>
        <p className="mt-4 text-center text-sm text-mute">{d.oss.note}</p>
      </section>

      {/* Calculator */}
      <section className="border-y border-hairline bg-[#fafafa]">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="eyebrow text-center">{d.calc.eyebrow}</p>
          <h2 className="mt-3 text-center text-display-lg text-ink">{d.calc.title}</h2>
          <div className="mx-auto mt-12 max-w-4xl">
            <SavingsCalculator />
          </div>
        </div>
      </section>

      {/* Trust & security */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <p className="eyebrow text-center">{d.trust.eyebrow}</p>
        <h2 className="mx-auto mt-3 max-w-3xl text-center text-display-lg text-ink">{d.trust.title}</h2>
        <p className="mx-auto mt-5 max-w-3xl text-center text-[17px] leading-relaxed text-body-mid [text-wrap:balance]">{d.trust.lead}</p>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {d.trust.items.map((it, i) => (
            <div key={it.title} className="card flex flex-col !p-7">
              {/* one mini visual per claim — order mirrors the items array in every locale */}
              <div className="flex h-20 items-center rounded-card bg-[#fafafa] px-4" aria-hidden>
                {trustVisuals[i]}
              </div>
              <h3 className="mt-4 text-[19px] font-medium text-ink">{it.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-body-mid">{it.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-hairline">
        <div className="mx-auto max-w-6xl px-6 py-20 text-center">
        <p className="eyebrow">{d.pricing.eyebrow}</p>
        <h2 className="mt-3 text-display-lg text-ink">{d.pricing.title}</h2>
        <div className="mx-auto mt-12 grid max-w-4xl gap-6 md:grid-cols-2">
          <div className="card text-left">
            <div className="text-badge text-blue-info">{d.pricing.todayBadge}</div>
            <h3 className="mt-2 text-display-md text-ink">{d.pricing.todayTitle}</h3>
            <p className="mt-3 text-body-mid">{d.pricing.todayBody}</p>
          </div>
          <div className="card text-left">
            <div className="text-badge text-mute">{d.pricing.plannedBadge}</div>
            <h3 className="mt-2 text-display-md text-ink">{d.pricing.plannedTitle}</h3>
            <p className="mt-3 text-body-mid">{d.pricing.plannedBody}</p>
          </div>
        </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-hairline">
        <div className="mx-auto max-w-3xl px-6 py-20">
          <p className="eyebrow text-center">{d.faq.eyebrow}</p>
          <h2 className="mt-3 text-center text-display-lg text-ink">{d.faq.title}</h2>
          <div className="mt-10 flex flex-col gap-4">
            {d.faq.items.map((f) => (
              <details key={f.q} className="card group !p-6">
                <summary className="cursor-pointer list-none text-[18px] font-medium text-ink">{f.q}</summary>
                <p className="mt-3 text-[16px] leading-relaxed text-body-mid">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <Footer d={d} locale={locale} />
    </main>
  );
}
