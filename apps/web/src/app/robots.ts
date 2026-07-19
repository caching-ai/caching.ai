import type { MetadataRoute } from "next";

// Console, org and auth-adjacent API surfaces are private; everything else is
// crawlable. AI/answer-engine crawlers are explicitly welcomed (AEO) — they
// inherit the general rule, listed here so an operator adding a block later
// has to do it consciously per bot.
export default function robots(): MetadataRoute.Robots {
  const disallow = ["/console", "/org", "/api/", "/login", "/signup"];
  const aiBots = [
    "GPTBot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "ClaudeBot",
    "Claude-SearchBot",
    "Claude-User",
    "PerplexityBot",
    "Perplexity-User",
    "Google-Extended",
    "Applebot-Extended",
    "Bytespider",
    "CCBot",
    "meta-externalagent",
    "cohere-ai",
  ];
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      ...aiBots.map((userAgent) => ({ userAgent, allow: "/", disallow })),
    ],
    sitemap: "https://caching.ai/sitemap.xml",
    host: "https://caching.ai",
  };
}
