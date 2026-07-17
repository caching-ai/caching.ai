"use client";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "./I18nProvider";
import { fmt } from "@/lib/i18n/shared";
import Tip from "./Tooltip";
import CacheVisualGuide from "./CacheVisualGuide";

interface KeyRow {
  id: number;
  name: string;
  key_prefix_display: string;
  auto_cache_control: boolean;
  anthropic_cache_ttl: "5m" | "1h";
  openai_cache_retention: "default" | "24h";
  cache_tuning_mode: "manual" | "auto";
  keepalive_enabled: boolean;
  keepalive_budget_usd_daily: string;
  keepalive_hold_until: string | null;
  created_at: string;
  revoked_at: string | null;
  has_anthropic_key: boolean;
  has_openai_key: boolean;
  has_gemini_key: boolean;
  has_grok_key: boolean;
}

const PROVIDERS = [
  { id: "anthropic", field: "anthropic_key", noteKey: "anthropic", has: "has_anthropic_key", label: "Anthropic", placeholder: "sk-ant-…" },
  { id: "openai", field: "openai_key", noteKey: "openai", has: "has_openai_key", label: "OpenAI", placeholder: "sk-…" },
  { id: "gemini", field: "gemini_key", noteKey: "gemini", has: "has_gemini_key", label: "Gemini", placeholder: "AIza…" },
  { id: "grok", field: "grok_key", noteKey: "grok", has: "has_grok_key", label: "Grok (xAI)", placeholder: "xai-…" },
] as const;

function buildSnippets(proxyUrl: string, ck: string): Record<string, Record<string, string>> {
  return {
    anthropic: {
      curl: `curl ${proxyUrl}/v1/messages \\
  -H "content-type: application/json" \\
  -H "x-api-key: ${ck}" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{"model":"claude-opus-4-8","max_tokens":256,
       "messages":[{"role":"user","content":"Hello"}]}'`,
      ts: `import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "${proxyUrl}",
  apiKey: "${ck}",
});`,
      py: `import anthropic

client = anthropic.Anthropic(
    base_url="${proxyUrl}",
    api_key="${ck}",
)`,
    },
    openai: {
      curl: `curl ${proxyUrl}/v1/chat/completions \\
  -H "content-type: application/json" \\
  -H "Authorization: Bearer ${ck}" \\
  -d '{"model":"gpt-4o-mini",
       "messages":[{"role":"user","content":"Hello"}]}'`,
      ts: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${proxyUrl}/v1",
  apiKey: "${ck}",
});`,
      py: `from openai import OpenAI

client = OpenAI(
    base_url="${proxyUrl}/v1",
    api_key="${ck}",
)`,
    },
    gemini: {
      curl: `curl "${proxyUrl}/v1beta/models/gemini-2.5-flash:generateContent" \\
  -H "content-type: application/json" \\
  -H "x-goog-api-key: ${ck}" \\
  -d '{"contents":[{"role":"user","parts":[{"text":"Hello"}]}]}'`,
      ts: `import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: "${ck}",
  httpOptions: { baseUrl: "${proxyUrl}" },
});`,
      py: `from google import genai

client = genai.Client(
    api_key="${ck}",
    http_options={"base_url": "${proxyUrl}"},
)`,
    },
    grok: {
      curl: `curl ${proxyUrl}/v1/chat/completions \\
  -H "content-type: application/json" \\
  -H "Authorization: Bearer ${ck}" \\
  -d '{"model":"grok-4",
       "messages":[{"role":"user","content":"Hello"}]}'`,
      ts: `import OpenAI from "openai";

// Grok is OpenAI-compatible — routed by the grok-* model name
const client = new OpenAI({
  baseURL: "${proxyUrl}/v1",
  apiKey: "${ck}",
});`,
      py: `from openai import OpenAI

# Grok is OpenAI-compatible — routed by the grok-* model name
client = OpenAI(
    base_url="${proxyUrl}/v1",
    api_key="${ck}",
)`,
    },
  };
}

/** cloud-only (ee/): per-key tuning recommendation, fetched once for all keys */
interface KeyRec {
  anthropic?: {
    samples: number;
    medianGapMin: number;
    recommended: "5m" | "1h";
    savingsPct: number;
    confident: boolean;
  };
  openaiRetention?: { samples: number; recommended: "24h" };
}

const SNIPPET_PROVIDERS = ["anthropic", "openai", "gemini", "grok"] as const;
const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic", openai: "OpenAI", gemini: "Gemini", grok: "Grok",
};

function Snippet({ proxyUrl, plaintext }: { proxyUrl: string; plaintext: string }) {
  const { dict } = useI18n();
  const [prov, setProv] = useState<(typeof SNIPPET_PROVIDERS)[number]>("anthropic");
  const [tab, setTab] = useState<"curl" | "ts" | "py">("curl");
  const snippets = buildSnippets(proxyUrl, plaintext);
  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-1.5">
        {SNIPPET_PROVIDERS.map((p) => (
          <button key={p} onClick={() => setProv(p)}
            className={`rounded-btn border px-3 py-1.5 text-[14px] font-medium transition-colors ${
              prov === p ? "border-ink bg-primary text-white" : "border-hairline bg-canvas text-body-mid hover:border-ink"
            }`}>
            {PROVIDER_LABELS[p]}
          </button>
        ))}
      </div>
      <div className="mt-3 flex gap-1">
        {(["curl", "ts", "py"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-t-btn px-3 py-1.5 text-[14px] ${tab === t ? "bg-[#0d0d0d] text-white" : "bg-canvas text-mute border border-b-0 border-hairline"}`}>
            {t === "curl" ? "cURL" : t === "ts" ? "TypeScript" : "Python"}
          </button>
        ))}
      </div>
      <pre className="overflow-x-auto rounded-b-card rounded-tr-card bg-[#0d0d0d] p-5 font-mono text-[15.5px] leading-relaxed text-[#e8e8e8]">
        {snippets[prov][tab]}
      </pre>
      <button className="btn-secondary mt-3 !py-2 !min-h-[36px] text-[14px]"
        onClick={() => navigator.clipboard.writeText(snippets[prov][tab]).catch(() => {})}>
        {dict.console.keys.copySnippet}
      </button>
    </div>
  );
}

/** account-level provider keys — register once, every ck_ key uses them */
function AccountProviderKeys() {
  const { dict } = useI18n();
  const t = dict.console.keys;
  const tips = dict.console.tips;
  const [registered, setRegistered] = useState<Record<string, string>>({});
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const r = await fetch("/api/provider-keys");
    if (r.ok) setRegistered((await r.json()).registered ?? {});
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(provider: string, body: object) {
    setMessage("");
    const r = await fetch("/api/provider-keys", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, ...body }),
    });
    if (!r.ok) setMessage((await r.json().catch(() => ({}))).error ?? t.updateFailed);
    await load();
  }

  return (
    <section className="card" data-testid="account-provider-keys">
      <h2 className="flex items-center text-[20px] font-medium text-ink">
        {t.providerSection}
        <Tip text={tips.providerKeys} />
      </h2>
      <p className="mt-1 text-[15px] text-body-mid">{t.providerSectionSub}</p>
      {message && <p className="mt-3 text-[15px] text-error">{message}</p>}
      <div className="mt-6 flex flex-col gap-6">
        {PROVIDERS.map((p) => (
          <div key={p.id}>
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-medium uppercase tracking-wide text-body-mid">
                {p.label} API KEY
              </span>
              {registered[p.id] && (
                <button className="text-[14px] text-error hover:underline"
                  onClick={() => { if (confirm(t.providerRemoveConfirm)) void save(p.id, { remove: true }); }}>
                  {t.providerRemove}
                </button>
              )}
            </div>
            <p className="mt-1 text-[15px] text-mute">
              {registered[p.id]
                ? <>{t.registered} <span className="font-mono">{t.encrypted}</span> {t.replaceNote}</>
                : p.id === "anthropic" ? t.requiredAnthropic : fmt(t.optionalProvider, { label: p.label })}
            </p>
            <p className="text-[14px] text-mute">{t.providerNotes[p.noteKey]}</p>
            <div className="mt-2 flex gap-2">
              <input type="password" placeholder={p.placeholder} className="input flex-1"
                value={inputs[p.id] ?? ""}
                onChange={(e) => setInputs((s) => ({ ...s, [p.id]: e.target.value }))} />
              <button className="btn-secondary"
                onClick={async () => {
                  if (!inputs[p.id]) return;
                  await save(p.id, { key: inputs[p.id] });
                  setInputs((s) => ({ ...s, [p.id]: "" }));
                }}>
                {t.save}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function KeyManager({ proxyUrl }: { proxyUrl: string }) {
  const { dict } = useI18n();
  const t = dict.console.keys;
  const tips = dict.console.tips;
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [newKey, setNewKey] = useState<{ plaintext: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [keyMode, setKeyMode] = useState<"optimize" | "observe">("optimize");
  const [overrideInputs, setOverrideInputs] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [cloud, setCloud] = useState(false);
  const [recs, setRecs] = useState<Record<number, KeyRec>>({});

  const load = useCallback(async () => {
    const r = await fetch("/api/keys");
    if (r.ok) {
      const j = await r.json();
      setKeys(j.keys);
      setCloud(j.cloud === true);
      if (j.cloud) {
        // one call for every key — the card list never fans out per key
        fetch("/api/keys/recommendations")
          .then(async (rr) => { if (rr.ok) setRecs((await rr.json()).recs ?? {}); })
          .catch(() => {});
      }
    }
    setLoaded(true);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createKey() {
    setBusy(true);
    const r = await fetch("/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: keyName.trim() || "default", mode: keyMode }),
    });
    if (r.ok) {
      const j = await r.json();
      setNewKey({ plaintext: j.plaintext });
      setNaming(false);
      setKeyName("");
      setKeyMode("optimize");
      await load();
    }
    setBusy(false);
  }

  async function patch(id: number, body: any) {
    setMessage("");
    const r = await fetch(`/api/keys/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setMessage(j.error ?? t.updateFailed);
    }
    await load();
  }

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center text-display-md text-ink">
            {t.title}
            <Tip text={tips.ckKey} />
          </h1>
          <p className="mt-1 text-[16px] text-mute">{t.sub}</p>
        </div>
        {!naming && (
          <button className="btn-primary" onClick={() => setNaming(true)} disabled={busy} data-testid="create-key">
            {t.create}
          </button>
        )}
      </header>

      {naming && (
        <div className="card" data-testid="name-key-panel">
          <label className="text-[14px] font-medium uppercase tracking-wide text-body-mid" htmlFor="key-name">
            {t.nameLabel}
          </label>
          <p className="mt-1 text-[15px] text-mute">{t.nameHelp}</p>
          <form
            className="mt-3 flex flex-col gap-4"
            onSubmit={(e) => { e.preventDefault(); if (!busy) void createKey(); }}
          >
            <input
              id="key-name"
              autoFocus
              className="input"
              placeholder={t.namePlaceholder}
              value={keyName}
              maxLength={64}
              onChange={(e) => setKeyName(e.target.value)}
            />
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t.modeLabel}>
              {([
                ["optimize", t.modeOptimize, t.modeOptimizeDesc],
                ["observe", t.modeObserve, t.modeObserveDesc],
              ] as const).map(([mode, label, desc]) => (
                <label
                  key={mode}
                  data-testid={`mode-${mode}`}
                  className={`flex cursor-pointer items-start gap-3 rounded-card border p-4 transition-colors ${
                    keyMode === mode ? "border-ink bg-[#fafafa]" : "border-hairline hover:border-ink"
                  }`}
                >
                  <input type="radio" name="key-mode" className="mt-1 h-4 w-4 accent-[#080808]"
                    checked={keyMode === mode} onChange={() => setKeyMode(mode)} />
                  <span>
                    <span className="block text-[15px] font-medium text-ink">{label}</span>
                    <span className="mt-0.5 block text-[14px] leading-relaxed text-mute">{desc}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn-primary" disabled={busy} data-testid="confirm-create-key">
                {busy ? t.creating : t.confirmCreate}
              </button>
              <button type="button" className="btn-secondary" onClick={() => { setNaming(false); setKeyName(""); setKeyMode("optimize"); }}>
                {t.cancel}
              </button>
            </div>
          </form>
        </div>
      )}

      {message && <p className="text-error text-[15px]">{message}</p>}

      {newKey && (
        <div className="card border-accent-green shadow-featured" data-testid="new-key-panel">
          <div className="text-badge text-accent-green">{t.createdBadge}</div>
          <p className="mt-2 text-[16px] text-body-mid">{t.createdBody}</p>
          <div className="mt-3 flex items-center gap-3">
            <code className="flex-1 overflow-x-auto rounded-btn border border-hairline bg-canvas px-4 py-3 font-mono text-[15px] text-ink" data-testid="plaintext-key">
              {newKey.plaintext}
            </code>
            <button className="btn-secondary !py-2 !min-h-[40px]"
              onClick={() => navigator.clipboard.writeText(newKey.plaintext).catch(() => {})}>
              {t.copy}
            </button>
          </div>
          <Snippet proxyUrl={proxyUrl} plaintext={newKey.plaintext} />
        </div>
      )}

      <AccountProviderKeys />

      <CacheVisualGuide />

      {!loaded ? (
        <p className="text-mute text-[16px]">{t.loading}</p>
      ) : keys.length === 0 ? (
        <div className="card"><p className="text-[16px] text-body-mid">{t.empty}</p></div>
      ) : (
        keys.map((k) => (
          <div key={k.id} className={`card ${k.revoked_at ? "opacity-50" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-[18px] font-medium text-ink">
                  {k.name}
                  {!k.revoked_at && !k.auto_cache_control && !k.keepalive_enabled && (
                    <span className="rounded bg-accent-blue/10 px-2 py-0.5 text-badge font-semibold text-blue-info" data-testid="observe-badge">
                      {t.observeBadge}
                      <Tip text={tips.observe} />
                    </span>
                  )}
                </div>
                <div className="mt-1 font-mono text-[15px] text-body-mid">{k.key_prefix_display}</div>
                <div className="mt-1 text-[14px] text-mute">
                  {t.created} {new Date(k.created_at).toLocaleDateString()}
                  {k.revoked_at && ` · ${t.revoked}`}
                </div>
              </div>
              {!k.revoked_at && (
                <button className="text-[15px] text-error hover:underline"
                  onClick={() => { if (confirm(t.revokeConfirm)) void patch(k.id, { revoke: true }); }}>
                  {t.revoke}
                </button>
              )}
            </div>

            {!k.revoked_at && (
              <div className="mt-6 flex flex-col gap-5 border-t border-hairline pt-6">
                {/* toggles */}
                <label className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-[#080808]"
                    checked={k.auto_cache_control}
                    onChange={(e) => void patch(k.id, { auto_cache_control: e.target.checked })} />
                  <span>
                    <span className="inline-flex items-center text-[16px] font-medium text-ink">
                      {t.autoCacheTitle}
                      <Tip text={tips.autoCache} />
                    </span>
                    <span className="block text-[14px] leading-relaxed text-mute">{t.autoCacheBody}</span>
                  </span>
                </label>

                {k.auto_cache_control && (() => {
                  const auto = k.cache_tuning_mode === "auto";
                  const rec = recs[k.id];
                  const ttlLabel = (v: "5m" | "1h") => (v === "1h" ? t.ttl1hShort : t.ttl5mShort);
                  const pct = rec?.anthropic ? Math.round(rec.anthropic.savingsPct * 100) : 0;
                  return (
                  <div className="flex flex-col gap-4 pl-7">
                    {cloud && (
                      <label className="flex items-start gap-3">
                        <input type="checkbox" className="mt-1 h-4 w-4 accent-[#080808]"
                          checked={auto}
                          onChange={(e) => void patch(k.id, { cache_tuning_mode: e.target.checked ? "auto" : "manual" })} />
                        <span>
                          <span className="inline-flex items-center text-[15px] font-medium text-ink">
                            {t.adaptiveTitle}
                            <span className="ml-2 rounded bg-[#00d722]/15 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-[#008a16]">
                              {t.adaptiveCloudBadge}
                            </span>
                            <Tip text={tips.adaptive} />
                          </span>
                          <span className="block text-[14px] leading-relaxed text-mute">{t.adaptiveBody}</span>
                          {auto && (
                            <span className="mt-1 block text-[14px] leading-relaxed text-body-mid" data-testid="adaptive-status">
                              {rec?.anthropic
                                ? fmt(t.adaptiveStatus, {
                                    gap: rec.anthropic.medianGapMin,
                                    n: rec.anthropic.samples,
                                    ttl: ttlLabel(rec.anthropic.recommended),
                                    pct,
                                  })
                                : t.adaptiveWaiting}
                            </span>
                          )}
                        </span>
                      </label>
                    )}
                    <div className={auto ? "opacity-50" : ""}>
                      <span className="inline-flex items-center text-[15px] font-medium text-ink">
                        {t.cacheTtlTitle}
                        <Tip text={tips.anthropicTtl} />
                      </span>
                      <select
                        className="input ml-3 mt-1.5 !w-auto !py-2 text-[15px]"
                        value={k.anthropic_cache_ttl}
                        disabled={auto}
                        onChange={(e) => void patch(k.id, { anthropic_cache_ttl: e.target.value })}
                      >
                        <option value="5m">{t.cacheTtl5m}</option>
                        <option value="1h">{t.cacheTtl1h}</option>
                      </select>
                      <p className="mt-1.5 text-[14px] leading-relaxed text-mute">{t.cacheTtlNote}</p>
                      {!auto && rec?.anthropic?.confident && rec.anthropic.recommended !== k.anthropic_cache_ttl && (
                        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[14px]" data-testid="ttl-suggestion">
                          <span className="rounded bg-[#00d722]/10 px-2 py-1 text-[#046a12]">
                            {fmt(t.adaptiveSuggest, { ttl: ttlLabel(rec.anthropic.recommended), pct })}
                          </span>
                          <button className="text-[14px] font-medium text-ink underline hover:no-underline"
                            onClick={() => void patch(k.id, { anthropic_cache_ttl: rec.anthropic!.recommended })}>
                            {t.adaptiveApply}
                          </button>
                        </p>
                      )}
                    </div>
                    <div className={auto ? "opacity-50" : ""}>
                      <span className="inline-flex items-center text-[15px] font-medium text-ink">
                        {t.retentionTitle}
                        <Tip text={tips.openaiRetention} />
                      </span>
                      <select
                        className="input ml-3 mt-1.5 !w-auto !py-2 text-[15px]"
                        value={k.openai_cache_retention}
                        disabled={auto}
                        onChange={(e) => void patch(k.id, { openai_cache_retention: e.target.value })}
                      >
                        <option value="default">{t.retentionDefault}</option>
                        <option value="24h">{t.retention24h}</option>
                      </select>
                      <p className="mt-1.5 text-[14px] leading-relaxed text-mute">{t.retentionNote}</p>
                      {!auto && rec?.openaiRetention && k.openai_cache_retention === "default" && (
                        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[14px]" data-testid="retention-suggestion">
                          <span className="rounded bg-[#00d722]/10 px-2 py-1 text-[#046a12]">
                            {t.adaptiveRetentionSuggest}
                          </span>
                          <button className="text-[14px] font-medium text-ink underline hover:no-underline"
                            onClick={() => void patch(k.id, { openai_cache_retention: "24h" })}>
                            {t.adaptiveApply}
                          </button>
                        </p>
                      )}
                    </div>
                  </div>
                  );
                })()}

                <label className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-[#080808]"
                    checked={k.keepalive_enabled}
                    onChange={(e) => void patch(k.id, { keepalive_enabled: e.target.checked })} />
                  <span>
                    <span className="inline-flex items-center text-[16px] font-medium text-ink">
                      {t.keepaliveTitle}
                      <Tip text={tips.keepalive} />
                    </span>
                    <span className="block text-[14px] leading-relaxed text-mute">{t.keepaliveBody}</span>
                  </span>
                </label>

                {k.keepalive_enabled && (
                  <div className="flex items-center gap-3 pl-7">
                    <span className="inline-flex items-center text-[15px] text-body-mid">
                      {t.budget}
                      <Tip text={tips.budget} />
                    </span>
                    <input type="number" min={0} max={1000} step={0.5} className="input !w-28"
                      defaultValue={Number(k.keepalive_budget_usd_daily)}
                      onBlur={(e) => void patch(k.id, { keepalive_budget_usd_daily: e.target.value })} />
                  </div>
                )}
                {k.keepalive_enabled && k.keepalive_hold_until &&
                  new Date(k.keepalive_hold_until) > new Date() && (
                  <div className="ml-7 inline-flex w-fit items-center gap-1.5 rounded-btn bg-accent-green/[0.12] px-2.5 py-1 text-[13px] font-medium text-ink"
                    data-testid="hold-badge">
                    🔥 {fmt(t.holdActive, {
                      until: new Date(k.keepalive_hold_until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                    })}
                  </div>
                )}

                {/* advanced: per-key provider key overrides */}
                <details className="group">
                  <summary className="cursor-pointer select-none text-[15px] text-body-mid hover:text-ink">
                    {t.overrideToggle}
                  </summary>
                  <p className="mt-2 text-[14px] text-mute">{t.overrideNote}</p>
                  <div className="mt-4 flex flex-col gap-5">
                    {PROVIDERS.map((p) => {
                      const inputId = `${k.id}:${p.field}`;
                      const overridden = (k as any)[p.has] as boolean;
                      return (
                        <div key={p.field}>
                          <div className="flex items-center gap-2">
                            <span className="text-[13.5px] font-medium uppercase tracking-wide text-body-mid">
                              {p.label} API KEY
                            </span>
                            {overridden && (
                              <button className="text-[14px] text-error hover:underline"
                                onClick={() => { if (confirm(t.providerRemoveConfirm)) void patch(k.id, { remove_provider: p.id }); }}>
                                {t.providerRemove}
                              </button>
                            )}
                          </div>
                          {overridden && (
                            <p className="mt-1 text-[14px] text-body-mid">
                              {t.registered} <span className="font-mono">{t.encrypted}</span> {t.replaceNote}
                            </p>
                          )}
                          <div className="mt-2 flex gap-2">
                            <input type="password" placeholder={p.placeholder} className="input flex-1"
                              value={overrideInputs[inputId] ?? ""}
                              onChange={(e) => setOverrideInputs((s) => ({ ...s, [inputId]: e.target.value }))} />
                            <button className="btn-secondary"
                              onClick={async () => {
                                if (!overrideInputs[inputId]) return;
                                await patch(k.id, { [p.field]: overrideInputs[inputId] });
                                setOverrideInputs((s) => ({ ...s, [inputId]: "" }));
                              }}>
                              {t.save}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </details>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
