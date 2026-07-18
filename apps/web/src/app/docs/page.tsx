import Link from "next/link";
import LangSelector from "@/components/LangSelector";
import CopyCode from "@/components/CopyCode";
import { getLocale } from "@/lib/i18n/server";
import { getDict } from "@/lib/i18n/shared";
import { IconTerminal } from "@/components/icons";

const PROXY = process.env.NEXT_PUBLIC_PROXY_URL ?? "https://proxy.caching.ai";

export default async function DocsPage() {
  const locale = await getLocale();
  const dict = getDict(locale);
  const t = dict.docs;
  const copyLabel = dict.console.keys.copy;
  const Code = ({ children }: { children: string }) => (
    <CopyCode code={children} label={copyLabel} />
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="flex items-center justify-between gap-4">
        <Link href="/" aria-label="caching.ai">
          <img src="/logo.png" alt="caching.ai" className="h-8 w-auto" />
        </Link>
        <nav className="flex items-center gap-5 text-[15px]">
          <Link href="/" className="text-body-mid hover:text-ink">{t.navHome}</Link>
          <Link href="/console" className="text-body-mid hover:text-ink">{t.navConsole}</Link>
        </nav>
      </div>
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
client.chat.completions.create(model="grok-4.5", messages=[...])`}</Code>
          </div>
          <p className="mt-3 text-[14px] text-mute">{t.alsoNote}</p>
        </li>

        <li id="connect">
          <h2 className="text-display-md text-ink">{t.connectT}</h2>
          <p className="mt-2 text-body-mid">{t.connectB}</p>
          {/* the fastest path: let the user's own agent do the setup */}
          <div className="mt-5 rounded-card border border-accent-purple/40 bg-accent-purple/[0.05] p-5">
            <div className="flex items-center gap-2 text-[15.5px] font-semibold text-ink">
              <IconTerminal size={17} className="shrink-0 text-accent-purple" />
              {t.connectAgentT}
            </div>
            <p className="mt-1 text-[14px] leading-relaxed text-body-mid">{t.connectAgentB}</p>
            <div className="mt-3">
              <Code>{`Set up the caching.ai proxy for my AI tools.
1) Fetch https://caching.ai/agent-setup.md and follow it exactly, including its safety rules.
2) My caching.ai key: ck_your_key_here
3) Detect which supported tools I use, confirm the list with me, back up every config you touch, apply the changes, then run the verification step and show me the result.`}</Code>
            </div>
          </div>
          <div className="mt-6 flex flex-col gap-8">
            {[
              {
                name: "Claude Code",
                badge: "Anthropic",
                note: t.connectNotes.claudeCode,
                code: `# ~/.claude/settings.json
{
  "env": {
    "ANTHROPIC_BASE_URL": "${PROXY}",
    "ANTHROPIC_AUTH_TOKEN": "ck_your_key_here"
  }
}
# or just: export ANTHROPIC_BASE_URL="${PROXY}"
#          export ANTHROPIC_AUTH_TOKEN="ck_your_key_here"`,
              },
              {
                name: "OpenAI Codex CLI",
                badge: "OpenAI",
                note: t.connectNotes.codex,
                code: `# ~/.codex/config.toml
model_provider = "caching"

[model_providers.caching]
name = "Caching.ai proxy"
base_url = "${PROXY}/v1"
env_key = "CACHING_API_KEY"     # export CACHING_API_KEY=ck_your_key_here
wire_api = "responses"`,
              },
              {
                name: "Cline / Roo Code (VS Code)",
                badge: "Anthropic · OpenAI",
                note: t.connectNotes.cline,
                code: `# Settings → API Provider
#   Anthropic       → check "Use custom base URL" → ${PROXY}
#   OpenAI Compatible → Base URL ${PROXY}/v1
# API Key: ck_your_key_here`,
              },
              {
                name: "Continue (VS Code / JetBrains)",
                badge: "Anthropic · OpenAI",
                code: `# ~/.continue/config.yaml
models:
  - name: claude-via-caching
    provider: anthropic
    model: claude-sonnet-4-5
    apiBase: ${PROXY}
    apiKey: ck_your_key_here
  - name: gpt-via-caching
    provider: openai
    model: gpt-4o
    apiBase: ${PROXY}/v1
    apiKey: ck_your_key_here`,
              },
              {
                name: "Aider",
                badge: "OpenAI · Anthropic",
                note: t.connectNotes.aider,
                code: `# OpenAI-path models
export OPENAI_API_BASE=${PROXY}/v1
export OPENAI_API_KEY=ck_your_key_here
aider --model openai/gpt-4o

# Anthropic-path models (root URL — litellm appends /v1/messages)
aider --anthropic-api-key ck_your_key_here \\
      --set-env ANTHROPIC_API_BASE=${PROXY} \\
      --model claude-sonnet-4-5`,
              },
              {
                name: "Gemini CLI",
                badge: "Gemini",
                note: t.connectNotes.geminiCli,
                code: `# ~/.gemini/.env
GEMINI_API_KEY=ck_your_key_here
GOOGLE_GEMINI_BASE_URL=${PROXY}`,
              },
              {
                name: "LangChain",
                badge: "Anthropic · OpenAI",
                code: `# python
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
llm = ChatOpenAI(model="gpt-4o", base_url="${PROXY}/v1", api_key="ck_your_key_here")
claude = ChatAnthropic(model="claude-sonnet-4-5", base_url="${PROXY}", api_key="ck_your_key_here")

// typescript
const llm = new ChatOpenAI({ apiKey: "ck_...", configuration: { baseURL: "${PROXY}/v1" } });
const claude = new ChatAnthropic({ apiKey: "ck_...", anthropicApiUrl: "${PROXY}" });`,
              },
              {
                name: "LlamaIndex",
                badge: "Anthropic · OpenAI",
                note: t.connectNotes.llamaindex,
                code: `from llama_index.llms.openai_like import OpenAILike
from llama_index.llms.anthropic import Anthropic
llm = OpenAILike(model="gpt-4o", api_base="${PROXY}/v1",
                 api_key="ck_your_key_here", is_chat_model=True)
claude = Anthropic(model="claude-sonnet-4-5", base_url="${PROXY}",
                   api_key="ck_your_key_here")`,
              },
              {
                name: "Vercel AI SDK",
                badge: "Anthropic · OpenAI · Gemini",
                note: t.connectNotes.aisdk,
                code: `import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";

const openai = createOpenAI({ baseURL: "${PROXY}/v1", apiKey: "ck_..." });
const anthropic = createAnthropic({ baseURL: "${PROXY}/v1", apiKey: "ck_..." });
const google = createGoogle({ baseURL: "${PROXY}/v1beta", apiKey: "ck_..." });`,
              },
              {
                name: "OpenAI Agents SDK",
                badge: "OpenAI",
                note: t.connectNotes.agents,
                code: `from openai import AsyncOpenAI
from agents import Agent, OpenAIChatCompletionsModel, set_tracing_disabled

set_tracing_disabled(True)  # tracing uploads would need a real sk- key
client = AsyncOpenAI(api_key="ck_your_key_here", base_url="${PROXY}/v1")
agent = Agent(name="Helper",
              model=OpenAIChatCompletionsModel(model="gpt-4o", openai_client=client))`,
              },
              {
                name: "Cursor",
                badge: "OpenAI",
                note: t.connectNotes.cursor,
                code: `# Cursor Settings → Models → OpenAI API Key: ck_your_key_here
#   → "Override OpenAI Base URL": ${PROXY}/v1`,
              },
            ].map((tool) => (
              <div key={tool.name}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[18px] font-semibold text-ink">{tool.name}</h3>
                  <span className="rounded-full bg-accent-blue/10 px-2.5 py-0.5 text-[12px] font-medium text-blue-info">{tool.badge}</span>
                </div>
                {tool.note && <p className="mt-1.5 text-[14px] leading-relaxed text-mute">{tool.note}</p>}
                <div className="mt-3"><Code>{tool.code}</Code></div>
              </div>
            ))}
          </div>
          <p className="mt-6 text-[14px] leading-relaxed text-mute">{t.connectFootnote}</p>
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
