"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "./I18nProvider";
import { useConfirm } from "./ConfirmDialog";

export default function OrgSettings({ orgName, role }: { orgName: string; role: "owner" | "admin" }) {
  const { dict } = useI18n();
  const t = dict.console.org.settings;
  const { confirm } = useConfirm();
  const router = useRouter();
  const [name, setName] = useState(orgName);
  const [saved, setSaved] = useState("");
  const [message, setMessage] = useState("");

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
