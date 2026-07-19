import ArticleShell from "@/components/blog/ArticleShell";
import { postMetadata } from "@/lib/seo";

export const metadata = postMetadata("prompt-caching-vs-semantic-caching");

const faq = [
  {
    q: "Can semantic caching return wrong answers?",
    a: "Yes — that's its core trade-off. If the similarity threshold is too loose, a user asking 'how do I cancel my subscription?' can receive the cached answer for 'how do I change my subscription?'. Prompt caching has no such failure mode: the model always generates a fresh answer; only the billing of the repeated prefix changes.",
  },
  {
    q: "Which saves more money, prompt caching or semantic caching?",
    a: "Per hit, semantic caching saves more (100% — the model never runs, vs ~90% off the cached prefix tokens). Across a real workload, prompt caching usually wins because it applies to nearly every request in prefix-heavy traffic like agents and chatbots, while semantic hits only occur when different users ask sufficiently similar questions.",
  },
  {
    q: "Can I use prompt caching and semantic caching together?",
    a: "Yes, and it's the right architecture when both fit: check the semantic/exact cache first (a hit costs nothing), and every miss goes to the model through prompt caching so its prefix is billed at the discounted rate. The two layers are independent and stack cleanly.",
  },
];

export default function Post() {
  return (
    <ArticleShell slug="prompt-caching-vs-semantic-caching" faq={faq}>
      <p>
        Search for &ldquo;LLM caching&rdquo; and you&apos;ll find two families of tools that share a word and almost
        nothing else. <strong>Semantic caching</strong> (and its simpler cousin, exact-match response caching)
        stores <em>answers</em> and replays them. <strong>Prompt caching</strong> stores nothing on your side at
        all — it&apos;s a provider-side billing discount for re-sent prompt <em>prefixes</em>. Teams regularly adopt
        one thinking they&apos;re getting the other, so here is the clean split.
      </p>

      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Prompt (prefix) caching</th>
              <th>Semantic / response caching</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><strong>What is cached</strong></td><td>The model&apos;s processed prompt prefix, at the provider</td><td>Your previous responses, in your infrastructure</td></tr>
            <tr><td><strong>When it helps</strong></td><td>Any request repeating a prefix (system prompt, tools, history) — nearly all agent/chat traffic</td><td>Different requests asking the same/similar thing</td></tr>
            <tr><td><strong>Savings per hit</strong></td><td>~90% off the cached tokens; output still billed</td><td>100% — the model never runs</td></tr>
            <tr><td><strong>Answer freshness</strong></td><td>Always fresh — the model runs every time</td><td>Replayed — staleness and mismatch risk</td></tr>
            <tr><td><strong>Latency effect</strong></td><td>Faster first token (prefill skipped)</td><td>Near-instant on hit</td></tr>
            <tr><td><strong>Failure mode</strong></td><td>A miss: you lose the discount, never correctness</td><td>A false hit: the user gets a wrong or outdated answer</td></tr>
            <tr><td><strong>Ops burden</strong></td><td>None (provider-side); the work is keeping prefixes stable and warm</td><td>Embeddings, vector store, thresholds, invalidation</td></tr>
          </tbody>
        </table>
      </div>

      <h2>Why the confusion persists</h2>
      <p>
        Most AI gateways advertise &ldquo;caching&rdquo; and mean the response kind — it&apos;s a natural gateway
        feature. Providers advertise &ldquo;prompt caching&rdquo; and mean the billing kind. Both cut costs, so
        roundups lump them together. But they answer different questions: response caching asks{" "}
        <em>&ldquo;have we answered this before?&rdquo;</em>; prompt caching asks{" "}
        <em>&ldquo;has the model read this before?&rdquo;</em> In production traffic the second is true an order
        of magnitude more often than the first.
      </p>

      <h2>When semantic caching is the right call</h2>
      <ul>
        <li>High volumes of near-duplicate questions from different users (public FAQ bots, search-style interfaces).</li>
        <li>Answers that stay valid for hours or days, with a clear invalidation story.</li>
        <li>You can tune and monitor a similarity threshold — and eat the occasional false hit.</li>
      </ul>

      <h2>When prompt caching is the right call</h2>
      <ul>
        <li>Agents, copilots and chatbots that resend a large system prompt, tool schema or conversation history every call — i.e. most modern LLM apps.</li>
        <li>Anything where a replayed answer is unacceptable (personalized, stateful, or time-sensitive output).</li>
        <li>Batch jobs sharing one prefix across hundreds of calls — our benchmark measured 89% savings on a 300-call batch.</li>
      </ul>
      <p>
        The catch with prompt caching is operational, not architectural: caches expire after ~5 idle minutes,
        one unstable token at the top of the prompt silently zeroes the hit rate, and Anthropic requires
        explicit <code>cache_control</code> breakpoints. That upkeep — measuring the real hit rate, stabilizing
        prefixes, warming through gaps — is exactly what <a href="/">Caching.ai</a> automates behind a
        base-URL swap. Mechanics in full: <a href="/blog/what-is-prompt-caching">What is prompt caching?</a>
      </p>

      <h2>Use both — in the right order</h2>
      <p>
        The layers stack: put the response/semantic cache in front (a hit there is free), and let every miss
        flow to the provider through prompt caching so the prefix is billed at ~10%. Just keep the fallacy
        straight — a semantic cache does not improve your prefix hit rate, and prompt caching will never
        deduplicate two users asking the same question. Different caches, different jobs.
      </p>
    </ArticleShell>
  );
}
