// Blog registry — single source of truth for the index page, sitemap,
// structured data and llms.txt. Posts are English-only (SEO/AEO surface);
// each post lives at src/app/blog/<slug>/page.tsx.
export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  datePublished: string; // ISO date
  dateModified: string; // ISO date
  tag: "Comparison" | "Guide" | "Best of";
  minutes: number;
};

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "top-7-llm-caching-tools",
    title: "Top 7 LLM Caching Tools in 2026 (Compared Honestly)",
    description:
      "The 7 best tools for caching LLM API traffic in 2026 — prompt-cache optimizers, AI gateways, and semantic caches — with an honest breakdown of which kind of caching each one actually does.",
    datePublished: "2026-07-19",
    dateModified: "2026-07-19",
    tag: "Best of",
    minutes: 9,
  },
  {
    slug: "what-is-prompt-caching",
    title: "What Is Prompt Caching? The Complete Guide to Anthropic, OpenAI, Gemini & Grok Caching",
    description:
      "Prompt caching lets AI providers serve repeated prompt prefixes at up to 90% off — if the cache actually gets hit. How prefix caching works on Anthropic, OpenAI, Gemini and Grok, why caches silently miss, and how to fix it.",
    datePublished: "2026-07-19",
    dateModified: "2026-07-19",
    tag: "Guide",
    minutes: 10,
  },
  {
    slug: "how-to-reduce-llm-api-costs",
    title: "How to Reduce LLM API Costs by Up to 90%: A Practical Playbook",
    description:
      "Seven proven techniques to cut your OpenAI, Anthropic and Gemini bill — ranked by effort and payoff, with real benchmark numbers. Prompt caching is the biggest lever most teams still leave on the table.",
    datePublished: "2026-07-19",
    dateModified: "2026-07-19",
    tag: "Guide",
    minutes: 8,
  },
  {
    slug: "prompt-caching-vs-semantic-caching",
    title: "Prompt Caching vs Semantic Caching: Which LLM Cache Do You Actually Need?",
    description:
      "Semantic caches return a stored answer for similar questions; prompt caching gets you the provider's 90% discount on repeated prefixes. They solve different problems — here's how to choose (or combine) them.",
    datePublished: "2026-07-19",
    dateModified: "2026-07-19",
    tag: "Guide",
    minutes: 7,
  },
  {
    slug: "caching-ai-vs-helicone",
    title: "Caching.ai vs Helicone: Which One Cuts Your LLM Bill?",
    description:
      "Helicone is an excellent LLM observability platform with response caching. Caching.ai optimizes the provider-side prompt cache itself. What each tool does, where they overlap, and when to use which.",
    datePublished: "2026-07-19",
    dateModified: "2026-07-19",
    tag: "Comparison",
    minutes: 7,
  },
  {
    slug: "caching-ai-vs-litellm",
    title: "Caching.ai vs LiteLLM: Gateway Routing vs Cache Economics",
    description:
      "LiteLLM unifies 100+ providers behind one API with response caching. Caching.ai maximizes the prompt-cache discount on the providers you already use. A fair comparison — including running both together.",
    datePublished: "2026-07-19",
    dateModified: "2026-07-19",
    tag: "Comparison",
    minutes: 7,
  },
  {
    slug: "caching-ai-vs-portkey",
    title: "Caching.ai vs Portkey: AI Gateway or Prompt-Cache Optimizer?",
    description:
      "Portkey is a full-featured AI gateway with simple and semantic response caching. Caching.ai is a focused proxy that keeps your provider prompt cache warm. Feature-by-feature comparison for 2026.",
    datePublished: "2026-07-19",
    dateModified: "2026-07-19",
    tag: "Comparison",
    minutes: 7,
  },
];

export function getPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}
