import Link from "next/link";
import LangSelector from "@/components/LangSelector";
import { getLocale } from "@/lib/i18n/server";
import { getDict } from "@/lib/i18n/shared";

const PROXY = process.env.NEXT_PUBLIC_PROXY_URL ?? "https://proxy.caching.ai";

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-card bg-[#0d0d0d] p-5 font-mono text-[15px] leading-relaxed text-[#e8e8e8]">
      {children}
    </pre>
  );
}

export default async function DocsPage() {
  const locale = await getLocale();
  const t = getDict(locale).docs;

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" aria-label="caching.ai">
        <img src="/logo.png" alt="caching.ai" className="h-8 w-auto" />
      </Link>
      <h1 className="mt-8 text-display-lg text-ink">{t.title}</h1>
      <p className="mt-3 text-[17px] text-body-mid">{t.intro}</p>

      <ol className="mt-10 flex flex-col gap-10">
        <li>
          <h2 className="text-display-md text-ink">{t.s1t}</h2>
          <p className="mt-2 text-body-mid">{t.s1b}</p>
        </li>

        <li>
          <h2 className="text-display-md text-ink">{t.s2t}</h2>
          <p className="mt-2 text-body-mid">{t.s2b}</p>
          <div className="mt-4 flex flex-col gap-4">
            <Code>{`# environment variables — works with every Anthropic SDK
export ANTHROPIC_BASE_URL="${PROXY}"
export ANTHROPIC_API_KEY="ck_your_key_here"`}</Code>
            <Code>{`# python
import anthropic
client = anthropic.Anthropic(
    base_url="${PROXY}",
    api_key="ck_your_key_here",
)`}</Code>
            <Code>{`// typescript
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic({
  baseURL: "${PROXY}",
  apiKey: "ck_your_key_here",
});`}</Code>
          </div>
        </li>

        <li>
          <h2 className="text-display-md text-ink">{t.alsoT}</h2>
          <p className="mt-2 text-body-mid">{t.alsoB}</p>
          <div className="mt-4 flex flex-col gap-4">
            <Code>{`# openai — same base URL swap
from openai import OpenAI
client = OpenAI(base_url="${PROXY}/v1", api_key="ck_your_key_here")`}</Code>
            <Code>{`# gemini (google-genai)
from google import genai
client = genai.Client(
    api_key="ck_your_key_here",
    http_options={"base_url": "${PROXY}"},
)`}</Code>
            <Code>{`# grok (xAI) — OpenAI-compatible, routed by the grok-* model name
from openai import OpenAI
client = OpenAI(base_url="${PROXY}/v1", api_key="ck_your_key_here")
client.chat.completions.create(model="grok-4", messages=[...])`}</Code>
          </div>
          <p className="mt-3 text-[14px] text-mute">{t.alsoNote}</p>
        </li>

        <li>
          <h2 className="text-display-md text-ink">{t.s3t}</h2>
          <p className="mt-2 text-body-mid">{t.s3b}</p>
        </li>

        <li>
          <h2 className="text-display-md text-ink">{t.whatT}</h2>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-body-mid">
            {t.what.map((w) => (
              <li key={w.t}>
                <strong className="text-ink">{w.t}</strong> — {w.b}
              </li>
            ))}
          </ul>
        </li>

        <li>
          <h2 className="text-display-md text-ink">{t.holdT}</h2>
          <p className="mt-2 text-body-mid">{t.holdB}</p>
          <div className="mt-4">
            <Code>{`# a chat message, through any SDK — the proxy answers it, the AI never sees it
"keep my cache warm for 2 hours"
"캐시 2시간 지켜줘" · "キャッシュを2時間保温して"
"mantén mi caché caliente 2 horas" · "帮我保温缓存 2 小时"
cai:hold 45m   # explicit command — works anywhere, any language

# → 🔥 Warming held for 2 hours. (answered at the proxy, $0)`}</Code>
          </div>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-body-mid">
            {t.holdBullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <p className="mt-3 text-[14px] text-mute">{t.holdNote}</p>
        </li>

        <li>
          <h2 className="text-display-md text-ink">{t.verifyT}</h2>
          <div className="mt-4">
          <Code>{`curl ${PROXY}/v1/messages \\
  -H "content-type: application/json" \\
  -H "x-api-key: ck_your_key_here" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 128,
    "messages": [{"role": "user", "content": "Say hi"}]
  }'`}</Code>
          </div>
          <p className="mt-3 text-body-mid">{t.verifyB}</p>
        </li>
      </ol>

      <p className="mt-10 text-[15px] text-mute">
        {t.selfHostNote}{" "}
        <a href="https://github.com/caching-ai/caching.ai" target="_blank" rel="noopener noreferrer" className="text-ink underline hover:no-underline">
          github.com/caching-ai/caching.ai
        </a>
      </p>

      <footer className="mt-16 flex flex-col gap-4 border-t border-hairline pt-8 text-[15px] text-mute sm:flex-row sm:items-center sm:justify-between">
        <span>{t.footerNote}</span>
        <LangSelector />
      </footer>
    </main>
  );
}
