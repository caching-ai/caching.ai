import ArticleShell from "@/components/blog/ArticleShell";
import { postMetadata } from "@/lib/seo";

export const metadata = postMetadata("what-is-prompt-caching");

const faq = [
  {
    q: "How much does prompt caching save?",
    a: "Cached input tokens are typically billed at around 10% of the fresh-token price, so a request whose prompt is mostly cached prefix can cost close to 90% less. Realized savings depend entirely on your hit rate: our public benchmark measured 67% net savings on sparse support traffic and 89% on a shared-prefix batch.",
  },
  {
    q: "How long does a prompt cache last?",
    a: "Provider prefix caches typically expire after roughly 5 minutes of inactivity (Anthropic documents 5 minutes, with a 1-hour option at a higher write premium). Every hit refreshes the clock. One idle gap longer than the TTL and the next request pays full price and re-pays the write premium.",
  },
  {
    q: "Does prompt caching change the model's answers?",
    a: "No. Unlike a response cache, prompt caching never replays an old answer — the model processes every request and generates fresh output. The cache only skips re-processing (re-prefilling) the prompt prefix it has already seen, which is also why cache hits improve time-to-first-token.",
  },
  {
    q: "Why is my prompt cache hit rate so low?",
    a: "The usual culprits: idle gaps longer than the ~5-minute TTL, anything unstable at the start of the prompt (timestamps, request IDs, reordered tools), missing cache_control breakpoints on Anthropic, and prompts below the provider's minimum cacheable length. On GPT-5.6-generation models, SDK-default traffic can get 0% cross-request hits without an explicit breakpoint and a stable prompt_cache_key.",
  },
];

export default function Post() {
  return (
    <ArticleShell slug="what-is-prompt-caching" faq={faq}>
      <p>
        <strong>Prompt caching</strong> (also called prefix caching) is a billing discount every major LLM
        provider now offers: when the beginning of your prompt — the <em>prefix</em> — is identical to one the
        provider processed recently, they skip re-processing it and bill those tokens at a fraction of list
        price, typically around 10%. Your model still runs and produces a fresh answer; you just stop paying
        full price to re-read the same system prompt, tool definitions and conversation history on every call.
      </p>
      <p>
        That matters because modern LLM traffic is extremely prefix-heavy. An agent with a 6,000-token system
        prompt and tool schema resends those tokens on every turn. A support bot resends the whole
        conversation so far. In practice 60–90% of the input tokens you pay for are tokens the provider has
        already seen. Prompt caching is the single biggest cost lever most teams have — <em>if</em> the cache
        actually gets hit.
      </p>

      <h2>How prefix matching works</h2>
      <p>
        The provider hashes your prompt from the start, in blocks. If the first N tokens match a cached entry
        byte-for-byte, those N tokens are billed at the cached rate and the model&apos;s attention computation for
        them is reused (which is why cache hits also <em>reduce</em> time-to-first-token — the prefill step is
        skipped). Everything after the first difference is processed and billed normally.
      </p>
      <p>
        Two properties follow, and they explain nearly every &ldquo;why is my hit rate zero&rdquo; mystery:
      </p>
      <ul>
        <li><strong>Matching is exact and positional.</strong> One changed character at position 100 invalidates everything after position 100. A timestamp, a session ID, or a reordered tool list at the top of your prompt breaks caching for the entire request.</li>
        <li><strong>Caches are short-lived.</strong> Entries expire after roughly 5 idle minutes. Traffic with gaps longer than the TTL pays the cache <em>write premium</em> over and over without ever collecting a read discount.</li>
      </ul>

      <h2>Provider by provider</h2>
      <h3>Anthropic (Claude)</h3>
      <p>
        Caching is <strong>explicit</strong>: you mark up to four <code>cache_control</code> breakpoints in the
        request. Cache writes cost 1.25x list price (5-minute TTL) or 2x (1-hour TTL); reads cost about 10%.
        The catch: SDKs don&apos;t set breakpoints for you. No breakpoint, no cache — many teams pay full price
        simply because nothing in their stack adds <code>cache_control</code>.
      </p>
      <h3>OpenAI (GPT)</h3>
      <p>
        Historically <strong>automatic</strong> for stable prefixes of 1,024+ tokens, with cached input billed
        at a steep discount. On the GPT-5.6 generation we measured a change: plain SDK traffic stopped getting
        cross-request prefix hits (0% in our benchmark) — restoring caching requires an explicit cache
        breakpoint plus a stable <code>prompt_cache_key</code>. Verified live, that took the same workload from
        0% to 99.6% prefix hits.
      </p>
      <h3>Google (Gemini)</h3>
      <p>
        Two mechanisms: <strong>implicit caching</strong> (automatic prefix discounts) and <strong>explicit
        context caching</strong>, where you create a cache object for a large context and pay a small per-hour
        storage fee in exchange for much cheaper reads. Great for very large, long-lived contexts; the implicit
        path behaves like OpenAI&apos;s.
      </p>
      <h3>xAI (Grok)</h3>
      <p>
        Automatic prefix caching with cached-input discounts, OpenAI wire format. Hit rates improve when
        requests carry a stable conversation/routing hint — an <code>x-grok-conv-id</code> header keeps a
        conversation&apos;s traffic landing on the same cache.
      </p>

      <h2>The economics: when caching pays (and when it backfires)</h2>
      <p>
        Because writes carry a premium, caching is not automatically free money. The break-even is simple: a
        5-minute-TTL write costs 25% extra on the cached tokens, and each read saves ~90%. One hit within the
        TTL already pays for the write several times over. But if your calls arrive <em>further apart than the
        TTL</em>, you pay the premium on every call and never collect — hand-tuned caching on sparse traffic can
        be <strong>more expensive than doing nothing</strong>. We measured exactly that in our public
        benchmark: on support-style traffic with 6–9 minute gaps, DIY breakpoints lost money, while keeping the
        cache warm with tiny pings (each one counted against the savings) came out 67% cheaper than direct.
      </p>
      <blockquote>
        Rule of thumb: median gap &lt; TTL → set breakpoints and enjoy. Median gap &gt; TTL → either warm the
        cache through the gaps, switch to a longer TTL, or don&apos;t cache — and only measurement tells you which.
      </blockquote>

      <h2>Why real-world hit rates disappoint</h2>
      <ul>
        <li><strong>TTL expiry</strong> — one quiet stretch and the next user pays cold-start price.</li>
        <li><strong>Unstable prefixes</strong> — timestamps (&ldquo;Current time: …&rdquo;), request IDs, randomized few-shot examples, A/B copy, or tools serialized in nondeterministic order.</li>
        <li><strong>Missing breakpoints</strong> — Anthropic traffic with no <code>cache_control</code> at all.</li>
        <li><strong>Sub-minimum prompts</strong> — prefixes below the cacheable minimum (e.g. 1,024 tokens) never cache.</li>
        <li><strong>Fleet effects</strong> — deploys and model switches cold-start everything at once.</li>
      </ul>
      <p>
        None of these show up as errors. The request succeeds, the answer is fine, and the only symptom is a
        line item you can&apos;t see: most teams assume 60–70% hit rates and measure 20–30%.
      </p>

      <h2>Doing it right, automatically</h2>
      <p>
        Everything above is automatable, and that&apos;s what <a href="/">Caching.ai</a> does: a drop-in proxy that
        injects breakpoints where they&apos;re missing, detects cache-breakers and names the likely cause, keeps
        prefixes warm through idle gaps exactly as long as the math favors it, picks the right TTL from your
        real traffic rhythm, and — first of all — shows you the hit rate and wasted spend you actually have.
        One base-URL swap, 20% of verified savings, free under $5/month, Apache-2.0 core. If you&apos;d rather do
        it by hand, our playbook is in{" "}
        <a href="/blog/how-to-reduce-llm-api-costs">How to reduce LLM API costs</a> — the checklist is the same
        either way.
      </p>
    </ArticleShell>
  );
}
