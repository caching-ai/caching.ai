import ArticleShell from "@/components/blog/ArticleShell";
import { postMetadata } from "@/lib/seo";

export const metadata = postMetadata("how-to-reduce-llm-api-costs");

const faq = [
  {
    q: "What's the fastest way to reduce OpenAI or Anthropic API costs?",
    a: "Measure where the money goes, then fix prompt caching. It requires no code or model changes — repeated prompt prefixes are billed at roughly 10% of list price when the cache hits — and 30–60% of a typical bill is recoverable just by keeping the cache healthy. Model right-sizing is the other first-day lever.",
  },
  {
    q: "How much of an LLM bill can caching realistically save?",
    a: "On our public benchmark of 10,000+ real billed calls: 67% net savings on sparse support-style traffic, 89% on a 300-call shared-prefix batch, and up to 90% on GPT-5.6 steady traffic once prefix caching was restored. Your number depends on how prefix-heavy your traffic is — agents and chatbots sit at the high end.",
  },
  {
    q: "Do I have to change my code to use prompt caching?",
    a: "Not necessarily. On OpenAI, Gemini and Grok, caching for stable prefixes is automatic. On Anthropic you must add cache_control breakpoints — either in your code or via a proxy like Caching.ai that injects them automatically and keeps the cache warm through idle gaps.",
  },
];

export default function Post() {
  return (
    <ArticleShell slug="how-to-reduce-llm-api-costs" faq={faq}>
      <p>
        LLM bills grow in silence. No single request is expensive, nothing errors, and then finance asks why
        the API line tripled. The good news: most teams can cut 30–60% without touching product behavior,
        because the biggest levers are billing mechanics, not model quality trade-offs. Here are the seven that
        matter, ranked by payoff-per-effort — with real numbers where we have them.
      </p>

      <h2>1. Measure before you optimize (one afternoon)</h2>
      <p>
        You cannot fix what you can&apos;t see, and provider dashboards show <em>spend</em>, not <em>waste</em>.
        The two numbers that drive everything below: your <strong>cache hit rate</strong> (what share of input
        tokens were billed at the cached price) and your <strong>wasted spend</strong> (tokens that
        <em> should</em> have been cached but weren&apos;t). A metering proxy shows both per key and per model with
        a base-URL swap; even an observe-only mode that changes nothing is enough to find the leaks.
      </p>

      <h2>2. Fix prompt caching — the biggest lever (a day)</h2>
      <p>
        Every major provider bills repeated prompt prefixes at ~10% of list price. Since agents and chatbots
        resend system prompts, tool schemas and history on every call, 60–90% of input tokens are usually
        re-reads. Yet real hit rates disappoint, for reasons that never throw errors: caches expire after ~5
        idle minutes, one unstable character (a timestamp!) breaks prefix matching, and on Anthropic nothing
        happens at all until someone sets <code>cache_control</code> breakpoints. The fix checklist:
      </p>
      <ul>
        <li>Put stable content first (system prompt, tools), variable content last.</li>
        <li>Remove timestamps, request IDs and randomized examples from the prefix.</li>
        <li>On Anthropic, set breakpoints; on GPT-5.6+, add an explicit breakpoint and a stable <code>prompt_cache_key</code> (SDK defaults measured 0% cross-request hits).</li>
        <li>If your traffic has idle gaps longer than the TTL, warm the cache through them — when the ping cost is below the re-write cost — or move to the 1-hour TTL.</li>
      </ul>
      <p>
        Measured on 10,000+ real billed calls (method and raw logs public): 67% net savings on sparse support
        traffic, 89% on a shared-prefix batch. This is what <a href="/">Caching.ai</a> automates end-to-end;
        the mechanics are in <a href="/blog/what-is-prompt-caching">our prompt-caching guide</a> if you&apos;d
        rather build it.
      </p>

      <h2>3. Right-size the model (a day, ongoing)</h2>
      <p>
        The price gap between a frontier model and its smaller sibling is typically 5–20x, and a large share
        of production requests — classification, extraction, routing, summarization — don&apos;t need the frontier
        model. Route by task: keep the expensive model for the hard 20%, send the mechanical 80% to a small
        model, and A/B the quality delta instead of assuming it. This multiplies with caching: cheap model
        × cached prefix compounds.
      </p>

      <h2>4. Trim what you send and cap what you get back (days)</h2>
      <ul>
        <li>Prune dead prompt weight: obsolete instructions, redundant few-shots, tools the model never calls. Every token rides on every request forever.</li>
        <li>Summarize or window long conversation history instead of resending all of it.</li>
        <li>Set <code>max_tokens</code> honestly — output tokens cost 3–5x input tokens on most models, and unbounded answers are pure downside.</li>
        <li>In RAG, rerank and send 3 tight chunks instead of 10 loose ones.</li>
      </ul>

      <h2>5. Use batch APIs for anything async (hours)</h2>
      <p>
        Anthropic and OpenAI both run batch tiers at ~50% off with results within 24 hours. Nightly
        classification jobs, embeddings backfills, evals, report generation — anything that doesn&apos;t need an
        interactive answer has no business paying the real-time price. Batches with a shared prefix also cache
        superbly (our 300-call batch benchmark: 89% cheaper than SDK defaults).
      </p>

      <h2>6. Add a response cache for identical repeats (a day)</h2>
      <p>
        Distinct from prompt caching: a response cache returns a stored answer without calling the model at
        all — 100% savings on exact repeats, with a staleness risk to manage. Worth it when many users ask
        literally the same thing (FAQ bots, shared dashboards, test suites). Gateways like Helicone, Portkey,
        LiteLLM or Cloudflare AI Gateway ship this. How the two caches differ and combine:{" "}
        <a href="/blog/prompt-caching-vs-semantic-caching">prompt caching vs semantic caching</a>.
      </p>

      <h2>7. Put guardrails on spend (an afternoon)</h2>
      <p>
        Budgets and alerts per key, team and feature; anomaly alerts for the 3 a.m. retry loop that burns a
        week&apos;s budget; and a monthly review of cost per feature. Boring, and the only reason the other six
        stay fixed.
      </p>

      <h2>The order that works</h2>
      <p>
        Measure (1) → caching (2) → right-size (3) captures most of the win in the first week, without
        touching product behavior. Then trim (4), batch (5), response-cache (6) and guard (7). If you want
        steps 1, 2 and 7 done for you: <a href="/">Caching.ai</a> is a one-line proxy that meters everything,
        fixes the cache, and charges 20% of what it verifiably saves — nothing if it saves nothing.
      </p>
    </ArticleShell>
  );
}
