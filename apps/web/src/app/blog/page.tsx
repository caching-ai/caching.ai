import type { Metadata } from "next";
import Link from "next/link";
import Footer from "@/components/Footer";
import JsonLd from "@/components/JsonLd";
import { getLocale } from "@/lib/i18n/server";
import { getDict } from "@/lib/i18n/shared";
import { BLOG_POSTS } from "@/lib/blog";
import { breadcrumbJsonLd } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Blog — Caching.ai",
  description:
    "Guides and honest comparisons on LLM caching: prompt caching on Anthropic, OpenAI, Gemini and Grok, cutting AI API costs, and how the major caching tools stack up.",
};

const TAG_STYLE: Record<string, string> = {
  Comparison: "bg-accent-blue/10 text-blue-info",
  Guide: "bg-accent-green/15 text-[#046a12]",
  "Best of": "bg-accent-purple/10 text-accent-purple",
};

function fmtDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function BlogIndex() {
  const locale = await getLocale();
  const d = getDict(locale);
  return (
    <main>
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Blog", path: "/blog" },
          ]),
          {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: "Caching.ai Blog",
            url: "https://caching.ai/blog",
            inLanguage: "en",
          },
        ]}
      />
      <nav className="border-b border-hairline">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-6">
          <Link href="/" aria-label="caching.ai">
            <img src="/logo.png" alt="caching.ai" className="h-8 w-auto" />
          </Link>
          <div className="flex items-center gap-5 text-[15px]">
            <Link href="/docs" className="text-body-mid hover:text-ink">{d.nav.docs}</Link>
            <Link href="/console" className="text-body-mid hover:text-ink">{d.footer.console}</Link>
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-3xl px-6 py-16">
        <p className="eyebrow">BLOG</p>
        <h1 className="mt-3 text-display-lg text-ink">The prompt-caching field guide</h1>
        <p className="mt-4 text-[19px] leading-relaxed text-body-mid">
          Guides and honest comparisons on LLM caching — how prompt caching really works on Anthropic, OpenAI,
          Gemini and Grok, and how the tools stack up. English only, numbers first.
        </p>

        <ul className="mt-12 flex flex-col gap-6">
          {BLOG_POSTS.map((p) => (
            <li key={p.slug} className="card p-6 transition-colors hover:border-ink">
              <Link href={`/blog/${p.slug}`} className="block">
                <div className="flex items-center gap-3 text-[13px] text-mute">
                  <span className={`rounded px-2 py-0.5 font-medium ${TAG_STYLE[p.tag]}`}>{p.tag}</span>
                  <time dateTime={p.datePublished}>{fmtDate(p.datePublished)}</time>
                  <span>·</span>
                  <span>{p.minutes} min read</span>
                </div>
                <h2 className="mt-3 text-[22px] font-semibold leading-snug text-ink">{p.title}</h2>
                <p className="mt-2 text-[15px] leading-relaxed text-body-mid">{p.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <Footer d={d} locale={locale} />
    </main>
  );
}
