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

  return (
    <main>
      {/* Nav */}
      <nav className="sticky top-0 z-20 border-b border-hairline bg-canvas/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" aria-label="caching.ai">
            <img src="/logo.png" alt="caching.ai" className="h-9 w-auto" />
          </Link>
          <div className="flex items-center gap-4">
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
          <div className="mx-auto max-w-3xl text-center">
            <p className="eyebrow">{d.problem.eyebrow}</p>
            <h2 className="mt-3 whitespace-pre-line text-display-lg text-ink">{d.problem.title}</h2>
            <p className="mt-5 text-[17px] leading-relaxed text-body-mid [text-wrap:balance]">{d.problem.lead}</p>
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
          <p className="mt-10 text-center text-[17px] font-medium text-ink">{d.problem.closing}</p>
        </div>
      </section>

      {/* Who it's for */}
      <section className="mx-auto max-w-6xl px-6 py-20">
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
        <h2 className="mx-auto mt-3 max-w-3xl text-center text-display-lg text-ink">{d.oss.title}</h2>
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
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {d.trust.items.map((it) => (
            <div key={it.title} className="card !p-7">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ink" aria-hidden>
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                  <path d="M8 1.5l5 2v4c0 3.2-2.1 5.7-5 7-2.9-1.3-5-3.8-5-7v-4l5-2z" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
                  <path d="M5.7 8l1.6 1.6 3-3.2" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
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
