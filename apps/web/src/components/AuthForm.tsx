"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useI18n } from "./I18nProvider";

export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  // ?next= only ever navigates within this origin (e.g. back to an invite)
  const rawNext = useSearchParams().get("next") ?? "";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/console";
  const { dict } = useI18n();
  const t = dict.auth;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) {
      router.push(next);
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? t.error);
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md">
        <Link href="/" aria-label="caching.ai">
          <img src="/logo.png" alt="caching.ai" className="h-9 w-auto" />
        </Link>
        <h1 className="mt-8 text-display-md text-ink">
          {mode === "signup" ? t.signupTitle : t.loginTitle}
        </h1>
        <p className="mt-2 text-body-mid">{mode === "signup" ? t.signupSub : t.loginSub}</p>
        <a href="/api/auth/google" className="btn-secondary mt-8 w-full gap-3">
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.7 1.22 9.2 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          {t.google}
        </a>
        <div className="mt-6 flex items-center gap-4">
          <span className="h-px flex-1 bg-hairline" />
          <span className="text-[13px] text-mute">{t.orDivider}</span>
          <span className="h-px flex-1 bg-hairline" />
        </div>
        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          <input
            type="email" required placeholder={t.email} className="input"
            value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
          />
          <input
            type="password" required placeholder={t.password} className="input"
            value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8}
          />
          {error && <p className="text-sm text-error">{error}</p>}
          <button className="btn-primary" disabled={busy}>
            {busy ? t.busy : mode === "signup" ? t.createAccount : t.signIn}
          </button>
        </form>
        <p className="mt-6 text-[15px] text-body-mid">
          {mode === "signup" ? (
            <>{t.haveAccount} <Link href="/login" className="text-blue-deep">{t.signIn}</Link></>
          ) : (
            <>{t.newHere} <Link href="/signup" className="text-blue-deep">{t.createAccount}</Link></>
          )}
        </p>
      </div>
    </main>
  );
}
