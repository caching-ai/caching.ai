import ArticleShell from "@/components/blog/ArticleShell";
import { postMetadata } from "@/lib/seo";

export const metadata = postMetadata("anthropic-prompt-caching-guide");

const faq = [
  {
    q: "How much does Anthropic prompt caching cost?",
    a: "Cache reads are billed at roughly 10% of the model's input price. Writes carry a premium: about 1.25x input price for the 5-minute TTL and 2x for the 1-hour TTL. One cache hit within the TTL already outweighs the write premium several times over.",
  },
  {
    q: "Why is my Claude cache hit rate 0%?",
    a: "The most common causes, in order: no cache_control breakpoints set at all (SDK defaults don't add them), something unstable at the top of the prompt (timestamp, request ID, reordered tools) breaking the byte-exact prefix match, a prefix below the model's minimum cacheable length, or requests arriving further apart than the TTL so every entry expires before it's reused.",
  },
  {
    q: "Should I use the 5-minute or 1-hour cache TTL on Claude?",
    a: "Compare your median gap between requests to the TTL. If calls arrive within 5 minutes of each other, the 5-minute TTL's cheaper write premium (1.25x vs 2x) wins. If gaps run longer — support traffic, sparse agents — the 1-hour TTL or keeping the 5-minute cache warm with tiny pings is cheaper than re-writing on every call. The right answer follows from measured traffic, not guesswork.",
  },
  {
    q: "Does prompt caching work with streaming and tool use on Claude?",
    a: "Yes. Caching applies to the prompt prefix regardless of whether the response streams, and tool definitions are part of the cacheable prefix — in fact tools plus system prompt are usually the largest stable block you have. Keep tool ordering deterministic or the prefix changes every call.",
  },
];

export default function Post() {
  return (
    <ArticleShell slug="anthropic-prompt-caching-guide" faq={faq}>
      <p>
        Claude bills cached prompt tokens at roughly <strong>10% of list price</strong> — but unlike OpenAI and
        Gemini, Anthropic&apos;s caching is <strong>explicit</strong>: nothing is cached until you mark it. This
        tutorial covers the mechanics that actually determine whether you collect the discount: breakpoints,
        TTL selection, the write-premium math, and the failure modes that silently zero hit rates in
        production.
      </p>

      <h2>The mental model</h2>
      <p>
        You place up to four <code>cache_control</code> markers in a request. Everything from the start of the
        prompt up to each marker becomes a cacheable prefix block. On the next request, if that prefix matches
        byte-for-byte, those tokens are billed as <em>cache reads</em> (~10%) instead of fresh input (100%).
        Order matters for hit probability, so structure prompts stable-first:
      </p>
      <ol>
        <li><strong>Tools</strong> — schemas change rarely; keep serialization order deterministic.</li>
        <li><strong>System prompt</strong> — instructions, policies, few-shot examples.</li>
        <li><strong>Conversation history</strong> — grows per turn; a breakpoint after the last complete turn lets each turn extend the cached prefix.</li>
        <li><strong>The new user message</strong> — always fresh; never cache-marked.</li>
      </ol>

      <h2>The pricing math</h2>
      <p>Three billing rates exist per model:</p>
      <ul>
        <li><strong>Cache write</strong>: 1.25x input price (5-minute TTL) or 2x (1-hour TTL) — charged when a prefix block is stored.</li>
        <li><strong>Cache read</strong>: ~0.1x input price — charged when a prefix block hits.</li>
        <li><strong>Plain input</strong>: 1x — everything uncached.</li>
      </ul>
      <p>
        The break-even is forgiving: a 5-minute write costs 25% extra once, and each subsequent hit saves ~90%.
        A prefix reused even twice within its TTL is strongly profitable. The trap is the other direction — if
        your requests arrive <em>further apart than the TTL</em>, you pay the write premium on every call and
        never collect a read. We measured this on our public benchmark: on support-style traffic with 6–9
        minute gaps, hand-tuned breakpoints were <strong>more expensive than no caching at all</strong>, while
        keeping the cache warm through the gaps came out 67% cheaper than direct.
      </p>

      <h2>Choosing the TTL — with real traffic, not vibes</h2>
      <p>
        The decision variable is your <strong>median inter-request gap per key</strong>:
      </p>
      <ul>
        <li>Gap &lt; 5 min → 5-minute TTL. Cheapest writes; every hit refreshes the clock.</li>
        <li>Gap 5–60 min → either the 1-hour TTL (2x writes, but they survive the gaps) or a warmed 5-minute cache (tiny keep-alive pings, each costing a fraction of a re-write). Which wins depends on prefix size and gap distribution — it&apos;s arithmetic, not preference.</li>
        <li>Gap &gt; 1 h → caching cross-request prefixes rarely pays; cache within bursts only.</li>
      </ul>

      <h2>The five mistakes that zero your hit rate</h2>
      <ol>
        <li><strong>No breakpoints at all.</strong> SDK defaults don&apos;t add <code>cache_control</code>. If you&apos;ve never set it, your hit rate is 0% and nothing in the response tells you.</li>
        <li><strong>A timestamp in the system prompt.</strong> &ldquo;Current time: 14:32:07&rdquo; changes every call, and everything after it can never match. Move volatile context to the end, or truncate to the hour if the model truly needs it.</li>
        <li><strong>Nondeterministic serialization.</strong> Tool lists built from an unordered map reorder randomly between processes — byte-exact matching fails invisibly.</li>
        <li><strong>Breakpoint placed too early.</strong> Marking only a 200-token system stub caches 200 tokens and re-bills the 5,000-token tool schema above… nothing. Mark the largest stable prefix, not the smallest.</li>
        <li><strong>Fleet cold starts.</strong> Deploys and prompt edits invalidate everything at once; the first call per conversation after a release pays write price. Expected — but it means hit rate must be judged as a trend, not a point value.</li>
      </ol>

      <h2>Measuring: the number Anthropic reports and the one it doesn&apos;t</h2>
      <p>
        Every response&apos;s <code>usage</code> block reports <code>cache_creation_input_tokens</code> and{" "}
        <code>cache_read_input_tokens</code> — your ground truth. What no provider reports is the
        counterfactual: tokens that <em>should</em> have been cached but weren&apos;t, i.e. the money you&apos;re
        leaving on the table. That&apos;s the number worth alerting on, and computing it requires comparing each
        request&apos;s prefix against what was cacheable — tedious by hand, mechanical for a proxy.
      </p>

      <h2>Automating all of the above</h2>
      <p>
        Everything in this guide is deterministic policy, which is why we built{" "}
        <a href="/">Caching.ai</a> as a drop-in proxy: it injects <code>cache_control</code> on the largest
        stable prefix, flags cache-breakers with the likely cause, chooses 5-minute vs 1-hour TTL from your
        measured gap distribution, keeps prefixes warm only while the ping cost stays below the re-write cost,
        and shows hit rate, saved dollars and wasted dollars per key. One base-URL swap; 20% of verified
        savings; free under $5/month. The broader mechanics across providers are in{" "}
        <a href="/blog/what-is-prompt-caching">What is prompt caching?</a>, and the full cost playbook is in{" "}
        <a href="/blog/how-to-reduce-llm-api-costs">How to reduce LLM API costs</a>.
      </p>
    </ArticleShell>
  );
}
