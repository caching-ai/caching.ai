"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "./I18nProvider";

interface OrgInfo {
  id: number;
  name: string;
  role: "owner" | "admin" | "member";
  members: number;
}

/**
 * Personal ↔ team workspace switcher (top of the console sidebar, onpod
 * style). Switching sets the workspace cookie server-side, then refreshes —
 * every page and API re-scopes from the verified cookie.
 */
export default function WorkspaceSwitcher({
  active,
  org,
  email,
}: {
  active: "personal" | "org";
  org: OrgInfo | null;
  email: string;
}) {
  const { dict } = useI18n();
  const t = dict.console.ws;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  async function switchTo(ws: "personal" | "org") {
    if ((ws === "org") === (active === "org")) return setOpen(false);
    setBusy(true);
    const r = await fetch("/api/org/switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ws }),
    });
    setBusy(false);
    if (!r.ok) return setError(t.switchFailed);
    setOpen(false);
    router.push("/console");
    router.refresh();
  }

  async function createOrg() {
    if (name.trim().length < 2 || busy) return;
    setBusy(true);
    setError("");
    const r = await fetch("/api/org", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(j.error ?? t.switchFailed);
    setOpen(false);
    setCreating(false);
    router.push("/console");
    router.refresh();
  }

  const current = active === "org" && org ? org.name : t.personal;
  const roleLabel = org ? t.roles[org.role] : "";

  return (
    <div className="relative px-6 pb-1" ref={ref} data-testid="workspace-switcher">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-btn border border-hairline px-3 py-2 text-left transition-colors hover:border-ink/30"
      >
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-medium text-ink">{current}</span>
          <span className="block truncate text-[12px] text-mute">
            {active === "org" ? `${t.team} · ${roleLabel}` : email}
          </span>
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0 text-mute">
          <path d="M7 9l5-5 5 5M7 15l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-6 right-6 z-30 mt-1 rounded-card border border-hairline bg-white p-1 shadow-lg">
          <button
            onClick={() => switchTo("personal")}
            className={`flex w-full items-center justify-between rounded-btn px-3 py-2 text-left text-[14px] hover:bg-canvas ${active === "personal" ? "font-medium text-ink" : "text-body-mid"}`}
          >
            <span className="truncate">{t.personal}</span>
            {active === "personal" && <Check />}
          </button>
          {org ? (
            <button
              onClick={() => switchTo("org")}
              className={`flex w-full items-center justify-between rounded-btn px-3 py-2 text-left text-[14px] hover:bg-canvas ${active === "org" ? "font-medium text-ink" : "text-body-mid"}`}
            >
              <span className="min-w-0">
                <span className="block truncate">{org.name}</span>
                <span className="block text-[12px] text-mute">{t.roles[org.role]}</span>
              </span>
              {active === "org" && <Check />}
            </button>
          ) : creating ? (
            <div className="p-2">
              <p className="mb-2 text-[12px] leading-relaxed text-mute">{t.createSub}</p>
              <input
                autoFocus
                className="input w-full !min-h-[36px] !py-1.5 text-[14px]"
                placeholder={t.namePlaceholder}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createOrg()}
              />
              {error && <p className="mt-1 text-[12px] text-error">{error}</p>}
              <button
                onClick={createOrg}
                disabled={busy || name.trim().length < 2}
                className="btn-primary mt-2 w-full !min-h-[36px] !py-1.5 text-[14px] disabled:opacity-50"
              >
                {busy ? t.creating : t.create}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-2 rounded-btn px-3 py-2 text-left text-[14px] text-body-mid hover:bg-canvas"
            >
              <span className="text-[16px] leading-none">+</span> {t.createCta}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0 text-accent-green">
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
