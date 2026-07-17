"use client";
import { useState } from "react";

const PROXY = process.env.NEXT_PUBLIC_PROXY_URL ?? "https://proxy.caching.ai";

// Code snippets stay in English (like the docs page); only the surrounding
// before/after comments are localized and passed in from the server page.
function snippets(codeBefore: string, codeAfter: string): Record<string, string> {
  return {
    Anthropic: `${codeBefore}
ANTHROPIC_BASE_URL=https://api.anthropic.com

${codeAfter}
ANTHROPIC_BASE_URL=${PROXY}
ANTHROPIC_API_KEY=ck_your_caching_ai_key`,
    OpenAI: `from openai import OpenAI

client = OpenAI(
    base_url="${PROXY}/v1",
    api_key="ck_your_caching_ai_key",
)`,
    Gemini: `from google import genai

client = genai.Client(
    api_key="ck_your_caching_ai_key",
    http_options={"base_url": "${PROXY}"},
)`,
    Grok: `# OpenAI-compatible — grok-* model names route automatically
from openai import OpenAI

client = OpenAI(base_url="${PROXY}/v1", api_key="ck_your_caching_ai_key")
client.chat.completions.create(model="grok-4", messages=[...])`,
  };
}

export default function ProviderCodeTabs({ codeBefore, codeAfter }: { codeBefore: string; codeAfter: string }) {
  const snips = snippets(codeBefore, codeAfter);
  const names = Object.keys(snips);
  const [active, setActive] = useState(names[0]);

  return (
    <div className="mx-auto mt-10 max-w-2xl overflow-hidden rounded-card border border-hairline bg-[#0d0d0d]" data-testid="provider-code-tabs">
      <div className="flex border-b border-white/10">
        {names.map((n) => (
          <button
            key={n}
            onClick={() => setActive(n)}
            className={`px-4 py-3 text-[14px] font-medium transition-colors ${
              active === n ? "bg-white/[0.08] text-white" : "text-[#8b8b8b] hover:text-white"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <pre className="overflow-x-auto whitespace-pre p-6 font-mono text-[15px] leading-relaxed text-[#e8e8e8]">
        {snips[active].split("\n").map((line, i) => (
          <div key={i} className={line.startsWith("#") ? "text-[#7a7a7a]" : undefined}>
            {line || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}
