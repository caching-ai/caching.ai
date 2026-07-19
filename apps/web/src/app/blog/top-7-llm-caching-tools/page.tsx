import ArticleShell from "@/components/blog/ArticleShell";
import { postMetadata } from "@/lib/seo";

export const metadata = postMetadata("top-7-llm-caching-tools");

const faq = [
  {
    q: "What is the best LLM caching tool?",
    a: "It depends on which kind of caching you need. For maximizing the provider-side prompt-caching discount (up to 90% off repeated prefixes on Anthropic, OpenAI, Gemini and Grok), Caching.ai is the only tool built specifically for that job. For deduplicating identical or similar requests, a response cache in Helicone, Portkey, LiteLLM or Cloudflare AI Gateway works well. Many teams run both kinds together.",
  },
  {
    q: "Is prompt caching the same as response caching?",
    a: "No. Response caching stores a previous answer and returns it without calling the model — great for identical repeated requests, but risky for anything that should be fresh. Prompt (prefix) caching is a provider-side discount: the model still runs and produces a fresh answer, but the repeated prompt prefix is billed at roughly 10% of list price. They are complementary, not competing.",
  },
  {
    q: "Do I need a caching tool if my provider already caches prompts automatically?",
    a: "The discount exists either way, but the hit rate is the problem: provider caches expire after about 5 idle minutes, and one unstable character at the start of a prompt silently breaks prefix matching. Most teams measure far lower hit rates than they assume. A tool that measures and protects the cache is how you find out — and fix it.",
  },
];

export default function Post() {
  return (
    <ArticleShell slug="top-7-llm-caching-tools" faq={faq}>
      <p>
        &ldquo;LLM caching&rdquo; means two very different things, and most tool roundups mix them up. <strong>Response
        caching</strong> stores an answer and replays it when the same (or a similar) request comes back —
        the model never runs. <strong>Prompt caching</strong> (prefix caching) is a discount the providers themselves
        offer: the model runs normally, but any prompt prefix it has seen recently is billed at roughly 10% of
        list price.
      </p>
      <p>
        Both save real money, but they fail differently: a response cache can return a stale or wrong answer,
        while a prompt cache can only ever miss — costing you the discount, never correctness. This list covers
        the best tools for both, and is upfront about which kind each one does. (Disclosure: Caching.ai is our
        product. We&apos;ve kept the comparisons factual — if you spot an error, email support@caching.ai and
        we&apos;ll fix it.)
      </p>

      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Tool</th>
              <th>Kind of caching</th>
              <th>Open source</th>
              <th>Pricing model</th>
              <th>Best for</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><strong>Caching.ai</strong></td><td>Provider prompt-cache optimization (analytics, auto breakpoints, warming)</td><td>Yes (Apache-2.0 core)</td><td>20% of verified savings; under $5/mo free</td><td>Getting the 90% prefix discount reliably</td></tr>
            <tr><td>Helicone</td><td>Response caching (exact match) + observability</td><td>Yes</td><td>Free tier + usage-based</td><td>LLM observability with caching on the side</td></tr>
            <tr><td>Portkey</td><td>Simple + semantic response caching</td><td>Gateway core</td><td>Free tier + subscription</td><td>Full-featured AI gateway</td></tr>
            <tr><td>LiteLLM</td><td>Response caching (Redis; semantic optional)</td><td>Yes</td><td>OSS free; enterprise paid</td><td>Unifying 100+ providers behind one API</td></tr>
            <tr><td>Cloudflare AI Gateway</td><td>Response caching (exact match) at the edge</td><td>No</td><td>Generous free core</td><td>Edge logging, rate limits, quick wins</td></tr>
            <tr><td>GPTCache</td><td>Semantic response caching (embeddings)</td><td>Yes</td><td>Free (library)</td><td>DIY semantic caching in Python</td></tr>
            <tr><td>Provider-native caching</td><td>Prompt (prefix) caching</td><td>—</td><td>Included in API pricing</td><td>Everyone — it&apos;s the baseline</td></tr>
          </tbody>
        </table>
      </div>

      <h2>1. Caching.ai — make the provider&apos;s 90% discount actually land</h2>
      <p>
        <a href="/">Caching.ai</a> is a drop-in proxy for the Anthropic, OpenAI, Gemini and Grok APIs that
        focuses on one job: making sure the provider-side prompt-caching discount you already qualify for
        actually shows up on your bill. Integration is a single base-URL swap — no code changes, streams pass
        through byte-for-byte.
      </p>
      <ul>
        <li><strong>Cache Analytics</strong> — your real hit rate, dollars saved, and the number nobody shows you: dollars wasted on prompts that should have been cached.</li>
        <li><strong>Cache Guard</strong> — automatic <code>cache_control</code> injection on Anthropic and cache-breaker detection (the timestamp in your system prompt that&apos;s silently costing 10x).</li>
        <li><strong>Cache Warmer</strong> — provider caches expire after ~5 idle minutes; tiny low-cost pings keep the prefix warm exactly as long as it&apos;s economical.</li>
        <li><strong>Measured, not promised</strong> — on a public benchmark of 10,000+ real billed calls: 67% saved on sparse support traffic, 89% on a shared-prefix batch, and on GPT-5.6 (where SDK-default traffic gets 0% prefix hits) hit rates restored to 97.8%+. Method and raw logs are open source.</li>
      </ul>
      <p>
        Pricing is performance-based: 20% of verified net savings, with fees under $5/month waived — save
        nothing, pay nothing. The core is Apache-2.0 and self-hostable with one <code>docker compose up</code>.
        What it is <em>not</em>: a response cache, a router, or an observability suite — it does one thing deeply.
      </p>

      <h2>2. Helicone — observability first, caching included</h2>
      <p>
        Helicone is an open-source LLM observability platform: request logging, cost tracking per user and
        feature, sessions, prompt experiments. Its caching feature is exact-match response caching configured
        with request headers — repeat an identical request and the stored response comes back instantly and
        free. If your primary need is seeing what your LLM app is doing, Helicone is a strong pick, and the
        cache is a nice bonus for identical repeats (think test suites and demo traffic). It does not manage
        provider prefix caches. See our detailed <a href="/blog/caching-ai-vs-helicone">Caching.ai vs Helicone</a> comparison.
      </p>

      <h2>3. Portkey — the kitchen-sink AI gateway</h2>
      <p>
        Portkey is a full-featured AI gateway: routing across hundreds of models, retries and fallbacks,
        guardrails, a prompt library, observability — plus both simple (exact) and semantic response caching
        with per-route TTLs. If you want one hosted control plane for many LLM concerns, Portkey covers the
        most ground of anything on this list. The trade-off is surface area: more concepts to configure, and
        the caching is response-level — the provider-side prefix discount is still up to you. Detailed
        comparison: <a href="/blog/caching-ai-vs-portkey">Caching.ai vs Portkey</a>.
      </p>

      <h2>4. LiteLLM — one API for 100+ providers</h2>
      <p>
        LiteLLM is the de-facto open-source standard for provider unification: an OpenAI-format proxy in front
        of 100+ providers, with load balancing, budgets, and virtual keys. Caching is Redis-backed response
        caching (with an optional semantic mode). If your problem is &ldquo;we call six providers and want one
        interface with spend controls,&rdquo; LiteLLM is excellent. Its cache dedupes identical requests; it
        doesn&apos;t warm or protect provider prefix caches. The two proxies also chain cleanly — details in{" "}
        <a href="/blog/caching-ai-vs-litellm">Caching.ai vs LiteLLM</a>.
      </p>

      <h2>5. Cloudflare AI Gateway — caching at the edge</h2>
      <p>
        Cloudflare&apos;s AI Gateway sits at the edge in front of your provider and adds logging, analytics, rate
        limiting, retries, and exact-match response caching with a TTL. It&apos;s free at its core, trivially easy
        to try (swap the base URL), and great operational insurance. Caching-wise it&apos;s the same story as the
        other gateways: identical requests hit, everything else misses, and prefix economics are out of scope.
      </p>

      <h2>6. GPTCache — DIY semantic caching</h2>
      <p>
        GPTCache (from Zilliz) is the best-known open-source semantic cache library: it embeds each query,
        stores responses in a vector store, and returns a cached answer when a new query is similar enough.
        Powerful when you have high volumes of near-duplicate questions and tolerance for approximate answers —
        FAQ bots are the classic case. Be aware it&apos;s a library you operate yourself (embedding model, vector
        store, similarity threshold are all your problem), and development activity has slowed. Background
        reading: <a href="/blog/prompt-caching-vs-semantic-caching">prompt caching vs semantic caching</a>.
      </p>

      <h2>7. Provider-native prompt caching — the baseline everyone should use</h2>
      <p>
        Anthropic, OpenAI, Gemini and Grok all ship prefix caching natively: Anthropic via explicit{" "}
        <code>cache_control</code> breakpoints (reads at ~10% of input price), OpenAI automatically for stable
        1,024+ token prefixes, Gemini with implicit caching plus explicit context caches, Grok automatically.
        It&apos;s not a tool you install — it&apos;s the discount all the tools above sit on top of. The catch, and the
        reason this list exists: caches expire in minutes, unstable prefixes break matching silently, and none
        of the providers show you the hit rate you&apos;re <em>losing</em>. Start here, then add tooling when the
        bill justifies it. Full mechanics: <a href="/blog/what-is-prompt-caching">What is prompt caching?</a>
      </p>

      <h2>How to choose</h2>
      <ul>
        <li><strong>Your bill is dominated by repeated prompt prefixes</strong> (agents, chatbots, RAG with big system prompts): maximize prompt caching — that&apos;s Caching.ai or careful DIY.</li>
        <li><strong>You serve many identical or near-identical requests</strong>: add a response cache — Helicone, Portkey, LiteLLM or Cloudflare AI Gateway.</li>
        <li><strong>You need multi-provider routing and spend controls</strong>: LiteLLM (OSS) or Portkey (hosted).</li>
        <li><strong>You mainly need visibility</strong>: Helicone.</li>
        <li><strong>Not sure where your money goes?</strong> Measure first — a proxy that shows hit rate and wasted spend turns the rest of this list from guesswork into arithmetic.</li>
      </ul>
    </ArticleShell>
  );
}
