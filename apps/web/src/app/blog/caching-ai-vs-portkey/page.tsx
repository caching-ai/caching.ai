import ArticleShell from "@/components/blog/ArticleShell";
import { postMetadata } from "@/lib/seo";

export const metadata = postMetadata("caching-ai-vs-portkey");

const faq = [
  {
    q: "What's the main difference between Portkey and Caching.ai?",
    a: "Scope. Portkey is a broad AI gateway — routing, fallbacks, guardrails, observability, prompt management, plus simple and semantic response caching. Caching.ai does one thing deeply: it maximizes the provider-side prompt-cache discount with analytics, automatic breakpoints, cache warming and TTL auto-tuning. Breadth vs depth.",
  },
  {
    q: "Does Portkey's semantic cache replace prompt caching?",
    a: "No. Portkey's caches replay stored responses for identical or similar requests. Prompt caching is the provider billing ~10% for re-sent prompt prefixes while still generating fresh answers. A semantic cache does nothing for your prefix hit rate — the two mechanisms are complementary.",
  },
  {
    q: "Which is cheaper, Portkey or Caching.ai?",
    a: "They price differently rather than one being cheaper: Portkey uses free-tier plus subscription pricing you pay regardless of outcome, while Caching.ai charges 20% of verified net savings (warming costs subtracted) and waives fees under $5/month — if it saves you nothing, it costs nothing.",
  },
];

export default function Post() {
  return (
    <ArticleShell slug="caching-ai-vs-portkey" faq={faq}>
      <p>
        Short version: <strong>Portkey wants to be your AI control plane; Caching.ai wants to shrink your AI
        bill.</strong> If you&apos;re choosing between them you&apos;re really choosing between breadth (one gateway for
        routing, guardrails, observability and caching) and depth (one tool that squeezes everything out of
        provider prompt caching). (Disclosure: Caching.ai is our product; we&apos;ve kept this factual —
        corrections → support@caching.ai.)
      </p>

      <h2>What each tool is</h2>
      <p>
        <strong>Portkey</strong> is a hosted AI gateway (with an open-source gateway core) that fronts
        hundreds of models: smart routing, automatic retries and fallbacks, guardrails, a prompt library,
        detailed observability — and caching in two modes, <em>simple</em> (exact match) and{" "}
        <em>semantic</em> (similarity match), both replaying stored responses with configurable TTLs.
      </p>
      <p>
        <strong>Caching.ai</strong> is a drop-in proxy for Anthropic, OpenAI, Gemini and Grok that optimizes
        the <em>provider-side prefix cache</em>: hit-rate and wasted-spend analytics, automatic{" "}
        <code>cache_control</code> injection, cache-breaker diagnostics, economically-guarded cache warming
        through idle gaps, and per-key TTL auto-tuning. Benchmarked on 10,000+ real billed calls (public
        method and logs): 67% saved on sparse traffic, 89% on a shared-prefix batch, GPT-5.6 prefix hits
        restored from 0% to 97.8%+.
      </p>

      <div className="tbl-wrap">
        <table>
          <thead>
            <tr><th></th><th>Caching.ai</th><th>Portkey</th></tr>
          </thead>
          <tbody>
            <tr><td><strong>Category</strong></td><td>Prompt-cache cost optimizer</td><td>Full AI gateway</td></tr>
            <tr><td><strong>Caching</strong></td><td>Provider prefix-cache optimization</td><td>Simple + semantic response caching</td></tr>
            <tr><td><strong>Routing / fallbacks / guardrails</strong></td><td>No</td><td>Yes — core product</td></tr>
            <tr><td><strong>Observability</strong></td><td>Cache-focused metering (no bodies stored)</td><td>Full request logging &amp; tracing</td></tr>
            <tr><td><strong>Freshness risk on cache hit</strong></td><td>None — model always runs</td><td>Replayed responses; thresholds to tune</td></tr>
            <tr><td><strong>Savings accounting</strong></td><td>Verified net savings vs list price, warming costs subtracted</td><td>Cost analytics on traffic</td></tr>
            <tr><td><strong>Open source</strong></td><td>Apache-2.0 core (proxy + console)</td><td>Gateway core OSS; platform hosted</td></tr>
            <tr><td><strong>Pricing</strong></td><td>20% of verified savings; &lt;$5/mo waived</td><td>Free tier + subscription</td></tr>
          </tbody>
        </table>
      </div>

      <h2>Choose Portkey if…</h2>
      <ul>
        <li>You want one hosted control plane: routing, fallbacks, guardrails, prompt management, logs.</li>
        <li>You operate many models/providers and value resilience features as much as cost.</li>
        <li>Your repeat traffic profile suits response/semantic caching (similar questions, tolerant of replay).</li>
      </ul>

      <h2>Choose Caching.ai if…</h2>
      <ul>
        <li>Cost is the problem to solve, and your traffic is prefix-heavy (agents, copilots, chatbots, big system prompts).</li>
        <li>You want breakpoints, warming and TTL choices handled automatically — and proven on the bill, not promised.</li>
        <li>You prefer no prompt bodies stored by default, and pricing that only triggers when verified savings exist.</li>
      </ul>

      <h2>The honest bottom line</h2>
      <p>
        These tools fail differently: choosing Portkey and skipping prefix optimization leaves the provider&apos;s
        90% discount partly uncollected; choosing Caching.ai alone leaves you without routing and guardrails
        if you need them. Some teams run Portkey for control-plane concerns and still point high-volume
        Anthropic/OpenAI traffic through Caching.ai for the cache math. Start from your bill: if cached-token
        line items are small and prefix-shaped waste is big, depth wins. Context:{" "}
        <a href="/blog/top-7-llm-caching-tools">Top 7 LLM caching tools</a> ·{" "}
        <a href="/blog/prompt-caching-vs-semantic-caching">prompt vs semantic caching</a>.
      </p>
    </ArticleShell>
  );
}
