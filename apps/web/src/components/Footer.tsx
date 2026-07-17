import Link from "next/link";
import LangSelector from "./LangSelector";
import type { Dict } from "@/lib/i18n/en";

/**
 * Marketing footer. Korean locale gets the domestic-SaaS treatment (multi-
 * column links + corporate registration lines); every other locale gets the
 * lean US-SaaS layout with "AI3 Inc." only.
 */
export default function Footer({ d, locale }: { d: Dict; locale: string }) {
  const f = d.footer;
  const cols: { title: string; links: { href: string; label: string }[] }[] = [
    {
      title: f.colStart,
      links: [
        { href: "/signup", label: d.nav.startFree },
        { href: "/login", label: d.nav.signIn },
        { href: "/console", label: f.console },
      ],
    },
    {
      title: f.colProduct,
      links: [
        { href: "/docs", label: d.nav.docs },
        { href: "/#pricing", label: f.pricing },
      ],
    },
    {
      title: f.colCompany,
      links: [
        { href: "/terms", label: f.terms },
        { href: "/privacy", label: f.privacy },
        { href: "mailto:support@caching.ai", label: f.contact },
      ],
    },
  ];

  return (
    <footer className="border-t border-hairline bg-[#0d0d0d] text-[#c9c9c9]">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Link href="/" aria-label="caching.ai">
            <img src="/logo-dark.png" alt="caching.ai" className="h-9 w-auto" />
          </Link>
          <p className="mt-3 text-[15px] text-[#9a9a9a]">{f.tagline}</p>
          <div className="mt-6">
            <LangSelector dark />
          </div>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <h3 className="text-[15px] font-semibold text-white">{c.title}</h3>
            <ul className="mt-4 flex flex-col gap-3">
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-[15px] text-[#9a9a9a] transition-colors hover:text-white">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-[#2a2a2a]">
        <div className="mx-auto max-w-6xl px-6 py-8 text-[14px] text-[#8a8a8a]">
          {locale === "ko" && (
            <div className="mb-5 flex flex-col leading-snug">
              <span>주식회사 AI3 · 대표이사 표철민 · 서울시 강남구 봉은사로 524 웨스틴 서울 파르나스 B1</span>
              <span>사업자등록번호 604-81-42515 · 통신판매업 신고 제 2025-서울강남-03866호</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span>{f.copyright}</span>
            <div className="flex items-center gap-5">
              <Link href="/terms" className="transition-colors hover:text-white">{f.terms}</Link>
              <Link href="/privacy" className="transition-colors hover:text-white">{f.privacy}</Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
