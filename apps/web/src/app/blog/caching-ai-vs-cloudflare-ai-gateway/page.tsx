import ArticleShell from "@/components/blog/ArticleShell";
import { postMetadata } from "@/lib/seo";

export const metadata = postMetadata("caching-ai-vs-cloudflare-ai-gateway");

const faq = [
  {
    q: "Is Cloudflare AI Gateway's caching the same as prompt caching?",
    a: "No. AI Gateway caches whole responses at the edge and replays them when an identical request repeats. Prompt caching is the provider billing repeated prompt prefixes at ~10% while still generating a fresh answer. AI Gateway's cache does nothing for your prefix hit rate, and Caching.ai does nothing for identical-request replay — they're different layers.",
  },
  {
    q: "Can I use Cloudflare AI Gateway and Caching.ai together?",
    a: "Technically yes — both are base-URL proxies, so they can chain. In practice pick by need: keep AI Gateway if you value its edge logs, rate limits and free replay cache, and point the traffic whose bill is prefix-shaped (agents, chatbots) through Caching.ai. Chaining both adds a hop that only pays if you genuinely use both feature sets.",
  },
  {
    q: "Cloudflare AI Gateway is free — why would I pay for Caching.ai?",
    a: "Because they save different money. AI Gateway's cache only helps when the exact same request repeats. Caching.ai targets the much larger line item — the 90% prefix discount on every request that reuses a system prompt or history — and it charges 20% of savings it can verify against provider-reported usage, with fees under $5/month waived. If it saves nothing, it costs nothing.",
  },
];

export default function Post() {
  return (
    <ArticleShell slug="caching-ai-vs-cloudflare-ai-gateway" faq={faq}>
      <p>
        Short version: <strong>Cloudflare AI Gateway is free operational plumbing at the edge — logs,
        rate limits, retries, and an exact-match replay cache. Caching.ai is cache economics — it makes the
        provider&apos;s prompt-caching discount actually land.</strong> The overlap is one word and one integration
        pattern (both are a base-URL swap); the jobs are different. (Disclosure: Caching.ai is our product.
        Corrections → support@caching.ai.)
      </p>

      <h2>What each tool is</h2>
      <p>
        <strong>Cloudflare AI Gateway</strong> sits on Cloudflare&apos;s edge in front of your AI provider. You get
        request logs and analytics, rate limiting, retries and fallbacks, and response caching: identical
        requests can be served from the edge with a configurable TTL — free at its core, minutes to set up.
      </p>
      <p>
        <strong>Caching.ai</strong> is a drop-in proxy for Anthropic, OpenAI, Gemini and Grok focused on the
        provider-side <em>prompt cache</em>: hit-rate and wasted-spend analytics, automatic{" "}
        <code>cache_control</code> injection, cache-breaker diagnostics, economically-guarded cache warming
        through idle gaps, and TTL auto-tuning. On a public benchmark of 10,000+ billed calls: 67% saved on
        sparse support traffic, 89% on a shared-prefix batch, GPT-5.6 prefix hits restored from 0% to 97.8%+.
      </p>

      <div className="tbl-wrap">
        <table>
          <thead>
            <tr><th></th><th>Caching.ai</th><th>Cloudflare AI Gateway</th></tr>
          </thead>
          <tbody>
            <tr><td><strong>Category</strong></td><td>Prompt-cache cost optimizer</td><td>Edge AI gateway</td></tr>
            <tr><td><strong>Caching</strong></td><td>Provider prefix-cache optimization</td><td>Exact-match response replay at the edge</td></tr>
            <tr><td><strong>Saves money on</strong></td><td>Every request reusing a prefix (agents, chat, RAG)</td><td>Identical repeated requests only</td></tr>
            <tr><td><strong>Freshness risk</strong></td><td>None — model always runs</td><td>Replayed responses; TTL to manage</td></tr>
            <tr><td><strong>Rate limits / retries / fallbacks</strong></td><td>No</td><td>Yes</td></tr>
            <tr><td><strong>Cache accounting</strong></td><td>Verified $ saved / $ wasted, net of warming</td><td>Request analytics and logs</td></tr>
            <tr><td><strong>Prompt bodies stored</strong></td><td>Never by default</td><td>Logging configurable</td></tr>
            <tr><td><strong>Open source / self-host</strong></td><td>Apache-2.0 core, docker compose</td><td>No (managed service)</td></tr>
            <tr><td><strong>Pricing</strong></td><td>20% of verified savings; &lt;$5/mo waived</td><td>Free core</td></tr>
          </tbody>
        </table>
      </div>

      <h2>Choose Cloudflare AI Gateway if…</h2>
      <ul>
        <li>You want free, zero-maintenance logs, rate limits and retry/fallback in front of any provider.</li>
        <li>Meaningful traffic is literally identical requests (public demos, repeated evals) where edge replay shines.</li>
        <li>You&apos;re already deep in the Cloudflare ecosystem.</li>
      </ul>

      <h2>Choose Caching.ai if…</h2>
      <ul>
        <li>Your bill is prefix-shaped: agents and chatbots resending system prompts, tools and history all day.</li>
        <li>You want breakpoints, warming and TTL choices handled automatically and <em>proven</em> on provider-reported usage.</li>
        <li>You want self-hosting as an option and no prompt bodies stored by default.</li>
      </ul>

      <h2>The honest bottom line</h2>
      <p>
        &ldquo;Free edge cache&rdquo; and &ldquo;90% prefix discount&rdquo; are not competing claims — they apply to
        disjoint slices of your traffic. Look at one day of usage: count exact-duplicate requests (AI
        Gateway&apos;s territory) versus requests that reuse a prefix (prompt caching&apos;s territory). For most
        production LLM apps the second number is 10x the first, which is why we built what we built. Wider
        context: <a href="/blog/top-7-llm-caching-tools">Top 7 LLM caching tools</a> ·{" "}
        <a href="/blog/prompt-caching-vs-semantic-caching">prompt vs semantic caching</a>.
      </p>
    </ArticleShell>
  );
}
