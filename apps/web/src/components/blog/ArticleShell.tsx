import Link from "next/link";
import Footer from "@/components/Footer";
import JsonLd from "@/components/JsonLd";
import { getLocale } from "@/lib/i18n/server";
import { getDict } from "@/lib/i18n/shared";
import { getPost } from "@/lib/blog";
import { articleJsonLd, breadcrumbJsonLd } from "@/lib/seo";

export type ArticleFaq = { q: string; a: string }[];

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

/**
 * Shared chrome for blog articles (English-only SEO surface). Renders nav,
 * header, Article + Breadcrumb (+ optional FAQPage) JSON-LD, the prose body,
 * a product CTA and the site footer.
 */
export default async function ArticleShell({
  slug,
  faq,
  children,
}: {
  slug: string;
  faq?: ArticleFaq;
  children: React.ReactNode;
}) {
  const post = getPost(slug);
  if (!post) throw new Error(`unknown blog post: ${slug}`);
  const locale = await getLocale();
  const d = getDict(locale);

  const jsonLd: object[] = [
    articleJsonLd(post),
    breadcrumbJsonLd([
      { name: "Home", path: "/" },
      { name: "Blog", path: "/blog" },
      { name: post.title, path: `/blog/${post.slug}` },
    ]),
  ];
  if (faq?.length) {
    jsonLd.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map((it) => ({
        "@type": "Question",
        name: it.q,
        acceptedAnswer: { "@type": "Answer", text: it.a },
      })),
    });
  }

  return (
    <main>
      <JsonLd data={jsonLd} />
      <nav className="border-b border-hairline">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-6">
          <Link href="/" aria-label="caching.ai">
            <img src="/logo.png" alt="caching.ai" className="h-8 w-auto" />
          </Link>
          <div className="flex items-center gap-5 text-[15px]">
            <Link href="/blog" className="text-body-mid hover:text-ink">Blog</Link>
            <Link href="/docs" className="text-body-mid hover:text-ink">{d.nav.docs}</Link>
            <Link href="/console" className="text-body-mid hover:text-ink">{d.footer.console}</Link>
          </div>
        </div>
      </nav>

      <article className="mx-auto max-w-3xl px-6 py-16">
        <header>
          <div className="flex items-center gap-3 text-[14px] text-mute">
            <span className={`rounded px-2 py-0.5 font-medium ${TAG_STYLE[post.tag]}`}>{post.tag}</span>
            <time dateTime={post.datePublished}>{fmtDate(post.datePublished)}</time>
            <span>·</span>
            <span>{post.minutes} min read</span>
          </div>
          <h1 className="mt-4 text-display-lg text-ink">{post.title}</h1>
          <p className="mt-4 text-[19px] leading-relaxed text-body-mid">{post.description}</p>
        </header>

        <div className="article-prose mt-4">{children}</div>

        {faq?.length ? (
          <section className="article-prose">
            <h2>Frequently asked questions</h2>
            {faq.map((it) => (
              <div key={it.q}>
                <h3>{it.q}</h3>
                <p>{it.a}</p>
              </div>
            ))}
          </section>
        ) : null}

        <aside className="card mt-14 bg-[#fafafa]">
          <p className="text-[18px] font-semibold text-ink">See what your cache is really costing you</p>
          <p className="mt-2 text-body-mid">
            Caching.ai is a drop-in proxy for Anthropic, OpenAI, Gemini and Grok. One base-URL swap shows your real
            hit rate — and keeps the cache warm so the discount lands on your bill. Pay 20% of verified savings;
            under $5/month it&apos;s free.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/signup" className="btn-primary">Start free</Link>
            <Link href="/docs" className="btn-secondary">Read the quickstart</Link>
          </div>
        </aside>
      </article>

      <Footer d={d} locale={locale} />
    </main>
  );
}
