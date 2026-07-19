// JSON-LD builders (schema.org) — rendered via <JsonLd /> on marketing pages.
// All content mirrors what is actually visible on the page; keep the two in
// sync when copy changes.
import type { Dict } from "@/lib/i18n/en";
import { BLOG_POSTS, type BlogPost } from "@/lib/blog";

const BASE = "https://caching.ai";

export const ORG_JSONLD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${BASE}/#organization`,
  name: "Caching.ai",
  legalName: "AI3 Inc.",
  url: BASE,
  logo: `${BASE}/logo.png`,
  email: "support@caching.ai",
  sameAs: ["https://github.com/caching-ai/caching.ai"],
} as const;

export const WEBSITE_JSONLD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${BASE}/#website`,
  name: "Caching.ai",
  url: BASE,
  publisher: { "@id": `${BASE}/#organization` },
} as const;

export const SOFTWARE_JSONLD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": `${BASE}/#software`,
  name: "Caching.ai",
  url: BASE,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Any",
  description:
    "Drop-in proxy for Anthropic, OpenAI, Gemini and Grok APIs that protects, warms, and measures your prompt cache — cache analytics, automatic cache_control injection, cache-breaker detection, and cache warming, so the provider's up-to-90% caching discount actually lands on your bill.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    description:
      "Performance-based pricing: 20% of verified net savings, charged monthly. Fees under $5 are waived. Save nothing, pay nothing. Open-source core (Apache-2.0) is free to self-host.",
  },
  softwareHelp: { "@type": "CreativeWork", url: `${BASE}/docs` },
  publisher: { "@id": `${BASE}/#organization` },
} as const;

/** FAQPage built from the landing FAQ dict — same items the visitor sees. */
export function faqJsonLd(dict: Dict) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: dict.faq.items.map((it) => ({
      "@type": "Question",
      name: it.q,
      acceptedAnswer: { "@type": "Answer", text: it.a },
    })),
  };
}

export function articleJsonLd(post: BlogPost) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.datePublished,
    dateModified: post.dateModified,
    inLanguage: "en",
    author: { "@id": `${BASE}/#organization` },
    publisher: { "@id": `${BASE}/#organization` },
    image: `${BASE}/og/blog/${post.slug}.png`,
    mainEntityOfPage: `${BASE}/blog/${post.slug}`,
  };
}

/** Static metadata for a blog post page (all posts are English). */
export function postMetadata(slug: string): import("next").Metadata {
  const post = BLOG_POSTS.find((p) => p.slug === slug);
  if (!post) throw new Error(`unknown blog post: ${slug}`);
  const og = `/og/blog/${post.slug}.png`;
  return {
    title: post.title,
    description: post.description,
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      url: `./`,
      siteName: "Caching.ai",
      publishedTime: post.datePublished,
      modifiedTime: post.dateModified,
      images: [{ url: og, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title: post.title, description: post.description, images: [og] },
  };
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: `${BASE}${it.path}`,
    })),
  };
}
