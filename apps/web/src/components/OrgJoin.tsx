"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "./I18nProvider";
import { fmt } from "@/lib/i18n/shared";

type State =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "signin" }
  | { kind: "mismatch"; email: string }
  | { kind: "ready"; orgName: string; role: string }
  | { kind: "accepting" }
  | { kind: "done"; orgName: string };

export default function OrgJoin() {
  const { dict } = useI18n();
  const t = dict.console.org.join;
  const roles = dict.console.ws.roles;
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!token) return setState({ kind: "invalid" });
    fetch(`/api/org/invites/preview?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (r.status === 401) return setState({ kind: "signin" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return setState({ kind: "invalid" });
        if (!j.emailMatches) return setState({ kind: "mismatch", email: j.email });
        setState({ kind: "ready", orgName: j.orgName, role: j.role });
      })
      .catch(() => setState({ kind: "invalid" }));
  }, [token]);

  async function accept() {
    if (state.kind !== "ready") return;
    const orgName = state.orgName;
    setState({ kind: "accepting" });
    const r = await fetch("/api/org/invites/accept", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!r.ok) return setState({ kind: "invalid" });
    setState({ kind: "done", orgName });
    setTimeout(() => { router.push("/console"); router.refresh(); }, 1200);
  }

  const roleLabel = state.kind === "ready" ? ((roles as any)[state.role] ?? state.role) : "";

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="card w-full max-w-md text-center">
        <a href="/" aria-label="caching.ai">
          <img src="/logo.png" alt="caching.ai" className="mx-auto h-8 w-auto" />
        </a>
        <h1 className="mt-6 text-[24px] font-medium text-ink">{t.title}</h1>
        <div className="mt-4 text-[16px] leading-relaxed text-body-mid">
          {state.kind === "loading" && t.loading}
          {state.kind === "invalid" && <span className="text-error">{t.invalid}</span>}
          {state.kind === "signin" && (
            <>
              {t.signin}{" "}
              <a className="text-blue-deep underline" href={`/login?next=${encodeURIComponent(`/org/join?token=${token}`)}`}>
                {dict.nav.signIn}
              </a>
            </>
          )}
          {state.kind === "mismatch" && fmt(t.emailMismatch, { email: state.email })}
          {state.kind === "ready" && fmt(t.invited, { org: state.orgName, role: roleLabel })}
          {state.kind === "accepting" && t.accepting}
          {state.kind === "done" && fmt(t.done, { org: state.orgName })}
        </div>
        {state.kind === "ready" && (
          <button className="btn-primary mt-6 w-full" onClick={accept}>{t.acceptCta}</button>
        )}
      </div>
    </main>
  );
}
