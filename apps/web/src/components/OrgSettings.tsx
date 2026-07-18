"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "./I18nProvider";
import { useConfirm } from "./ConfirmDialog";
import CopyCode from "./CopyCode";

interface AdminToken {
  id: number; name: string; created_at: string; last_used_at: string | null;
  created_by_email: string | null;
}

export default function OrgSettings({ orgName, role }: { orgName: string; role: "owner" | "admin" }) {
  const { dict } = useI18n();
  const t = dict.console.org.settings;
  const { confirm } = useConfirm();
  const router = useRouter();
  const [name, setName] = useState(orgName);
  const [saved, setSaved] = useState("");
  const [message, setMessage] = useState("");
  const [tokens, setTokens] = useState<AdminToken[]>([]);
  const [tokenName, setTokenName] = useState("");
  const [newToken, setNewToken] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);

  const loadTokens = useCallback(async () => {
    const r = await fetch("/api/org/admin-tokens");
    if (r.ok) setTokens((await r.json()).tokens ?? []);
  }, []);
  useEffect(() => { void loadTokens(); }, [loadTokens]);

  async function createToken() {
    if (!tokenName.trim() || tokenBusy) return;
    setTokenBusy(true);
    setMessage("");
    const r = await fetch("/api/org/admin-tokens", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: tokenName.trim() }),
    });
    const j = await r.json().catch(() => ({}));
    setTokenBusy(false);
    if (!r.ok) return setMessage(j.error ?? "Failed.");
    setNewToken(j.token);
    setTokenName("");
    await loadTokens();
  }

  async function revokeToken(id: number) {
    if (!(await confirm(t.apiRevokeConfirm, { danger: true }))) return;
    const r = await fetch(`/api/org/admin-tokens?id=${id}`, { method: "DELETE" });
    if (!r.ok) return setMessage((await r.json().catch(() => ({}))).error ?? "Failed.");
    await loadTokens();
  }

  async function rename() {
    setSaved(""); setMessage("");
    const r = await fetch("/api/org", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) return setMessage((await r.json().catch(() => ({}))).error ?? "Failed.");
    setSaved(t.renamed);
    router.refresh();
  }

  async function deleteOrg() {
    if (!(await confirm(t.deleteConfirm, { danger: true }))) return;
    setMessage("");
    const r = await fetch("/api/org", { method: "DELETE" });
    if (!r.ok) return setMessage((await r.json().catch(() => ({}))).error ?? "Failed.");
    router.push("/console");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-display-md text-ink">{t.title}</h1>
        <p className="mt-1 text-[16px] text-mute">{t.sub}</p>
      </header>
      {message && <p className="text-[15px] text-error">{message}</p>}

      <section className="card">
        <h2 className="text-[19px] font-medium text-ink">{t.renameTitle}</h2>
        <div className="mt-4 flex gap-2">
          <input className="input flex-1 max-w-md" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn-secondary" onClick={rename} disabled={name.trim().length < 2}>{t.renameCta}</button>
          {saved && <span className="self-center text-[14px] text-accent-green">{saved}</span>}
        </div>
      </section>

      <section className="card" data-testid="org-admin-api">
        <h2 className="text-[19px] font-medium text-ink">{t.apiTitle}</h2>
        <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-mute">{t.apiSub}</p>

        <div className="mt-4 flex gap-2">
          <input className="input flex-1 max-w-md" placeholder={t.apiTokenPlaceholder}
            value={tokenName} onChange={(e) => setTokenName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createToken()} />
          <button className="btn-secondary" onClick={createToken} disabled={tokenBusy || !tokenName.trim()}>
            {t.apiCreate}
          </button>
        </div>

        {newToken && (
          <div className="mt-4">
            <p className="mb-2 text-[14px] font-medium text-accent-green">{t.apiShownOnce}</p>
            <CopyCode code={newToken} label={dict.console.keys.copy} />
          </div>
        )}

        {tokens.length === 0 ? (
          <p className="mt-4 text-[15px] text-mute">{t.apiEmpty}</p>
        ) : (
          <table className="mt-4 w-full text-[15px]">
            <thead>
              <tr className="border-b border-hairline text-left text-badge text-mute">
                {[t.apiColName, t.apiColCreated, t.apiColLastUsed, ""].map((h, i) => (
                  <th key={i} className="py-2 pr-4 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tokens.map((tok) => (
                <tr key={tok.id} className="border-b border-hairline last:border-0">
                  <td className="py-2 pr-4">
                    {tok.name}
                    {tok.created_by_email && <span className="ml-2 text-[13px] text-mute">{tok.created_by_email}</span>}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap text-mute">{new Date(tok.created_at).toLocaleDateString()}</td>
                  <td className="py-2 pr-4 whitespace-nowrap text-mute">
                    {tok.last_used_at ? new Date(tok.last_used_at).toLocaleString() : t.apiNever}
                  </td>
                  <td className="py-2 text-right">
                    <button className="text-[14px] text-error hover:underline" onClick={() => revokeToken(tok.id)}>
                      {t.apiRevoke}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h3 className="mt-6 text-[16px] font-medium text-ink">{t.apiExamplesTitle}</h3>
        <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-mute">{t.apiExamplesSub}</p>
        <div className="mt-3 flex flex-col gap-3">
          <CopyCode label={dict.console.keys.copy} code={`# list members / departments / pending invites
curl -H "Authorization: Bearer oat_your_token" https://caching.ai/api/org/members
curl -H "Authorization: Bearer oat_your_token" https://caching.ai/api/org/departments
curl -H "Authorization: Bearer oat_your_token" https://caching.ai/api/org/invites`} />
          <CopyCode label={dict.console.keys.copy} code={`# add one department · bulk-import a CSV (name column)
curl -X POST https://caching.ai/api/org/departments \\
  -H "Authorization: Bearer oat_your_token" -H "content-type: application/json" \\
  -d '{"name": "Engineering"}'
curl -X POST https://caching.ai/api/org/departments/bulk \\
  -H "Authorization: Bearer oat_your_token" -H "content-type: text/csv" \\
  --data-binary @departments.csv`} />
          <CopyCode label={dict.console.keys.copy} code={`# invite members — JSON or CSV (email,role,department); departments are
# created on the fly. Same format as the console CSV template.
curl -X POST https://caching.ai/api/org/invites/bulk \\
  -H "Authorization: Bearer oat_your_token" -H "content-type: application/json" \\
  -d '{"invites": [{"email": "alice@acme.com", "department": "Engineering"}]}'
curl -X POST https://caching.ai/api/org/invites/bulk \\
  -H "Authorization: Bearer oat_your_token" -H "content-type: text/csv" \\
  --data-binary @members.csv`} />
        </div>
      </section>

      <section className="card border-error/40" data-testid="org-danger">
        <h2 className="text-[19px] font-medium text-error">{t.dangerTitle}</h2>
        <h3 className="mt-4 text-[16px] font-medium text-ink">{t.deleteTitle}</h3>
        <p className="mt-1 max-w-xl text-[15px] leading-relaxed text-mute">{t.deleteNote}</p>
        {role === "owner" ? (
          <button className="btn-secondary mt-4 !border-error !text-error" onClick={deleteOrg}>
            {t.deleteCta}
          </button>
        ) : (
          <p className="mt-4 text-[14px] text-mute">{t.ownerOnly}</p>
        )}
      </section>
    </div>
  );
}
