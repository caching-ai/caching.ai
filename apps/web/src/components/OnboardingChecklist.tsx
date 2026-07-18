"use client";
// First-run guide: computed from the account's REAL state (provider keys,
// ck_ keys, traffic), so it always points at the next concrete action.
// Auto-hides once traffic flows; dismissible any time (localStorage).
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "./I18nProvider";
import { IconFlag } from "./icons";

const DISMISS_KEY = "cai-onboarding-dismissed";

interface StepState {
  provider: boolean;
  ck: boolean;
  traffic: boolean;
}

export default function OnboardingChecklist() {
  const { dict } = useI18n();
  const t = dict.console.onboarding;
  const [state, setState] = useState<StepState | null>(null);
  const [dismissed, setDismissed] = useState(true); // avoid flash before mount

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  const load = useCallback(async () => {
    try {
      const [keys, stats]: any[] = await Promise.all([
        fetch("/api/keys").then((r) => (r.ok ? r.json() : {})),
        fetch("/api/stats?days=30").then((r) => (r.ok ? r.json() : {})),
      ]);
      // in the org workspace the relevant provider keys are the TEAM's
      const pk: any = await fetch(
        keys.workspace === "org" ? "/api/org/provider-keys" : "/api/provider-keys"
      ).then((r) => (r.ok ? r.json() : {}));
      setState({
        provider: Object.keys(pk.registered ?? {}).length > 0,
        ck: (keys.keys ?? []).some((k: any) => !k.revoked_at),
        traffic: (stats.totals?.requests ?? 0) > 0,
      });
    } catch {
      /* leave hidden on failure */
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (dismissed || !state) return null;
  if (state.provider && state.ck && state.traffic) return null; // journey complete

  const steps = [
    { done: state.provider, title: t.s1t, body: t.s1b, href: "/console/keys#provider-keys", cta: t.s1cta },
    { done: state.ck, title: t.s2t, body: t.s2b, href: "/console/keys#create-key", cta: t.s2cta },
    { done: state.traffic, title: t.s3t, body: t.s3b, href: "/docs#connect", cta: t.s3cta },
    { done: state.traffic, title: t.s4t, body: t.s4b, href: "/console", cta: t.s4cta },
  ];
  const current = steps.findIndex((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <section className="card !p-6 border-accent-green/60" data-testid="onboarding">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[18px] font-semibold text-ink"><IconFlag size={16} className="shrink-0" /> {t.title}</h2>
          <p className="mt-1 text-[14.5px] text-body-mid">{t.sub}</p>
        </div>
        <button className="shrink-0 text-[13px] text-mute hover:text-ink"
          onClick={() => { localStorage.setItem(DISMISS_KEY, "1"); setDismissed(true); }}>
          {t.dismiss}
        </button>
      </div>
      {/* progress */}
      <div className="mt-4 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#eeeeee]">
          <div className="h-1.5 rounded-full bg-accent-green transition-all"
            style={{ width: `${(doneCount / steps.length) * 100}%` }} />
        </div>
        <span className="text-[12.5px] font-medium text-mute">{doneCount}/{steps.length}</span>
      </div>
      <ol className="mt-5 flex flex-col gap-3">
        {steps.map((s, i) => (
          <li key={s.title}
            className={`flex items-start gap-3 rounded-card border p-3.5 ${
              i === current ? "border-ink bg-[#fafafa]" : "border-hairline"
            } ${s.done ? "opacity-60" : ""}`}>
            <span aria-hidden
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${
                s.done ? "bg-accent-green text-white" : i === current ? "bg-ink text-white" : "bg-[#eeeeee] text-mute"
              }`}>
              {s.done ? "✓" : i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block text-[15px] font-medium ${s.done ? "text-mute line-through" : "text-ink"}`}>{s.title}</span>
              {!s.done && <span className="mt-0.5 block text-[13.5px] leading-relaxed text-mute">{s.body}</span>}
            </span>
            {!s.done && i === current && (
              <Link href={s.href} className="btn-secondary shrink-0 !min-h-[34px] !px-3 !py-1.5 text-[13.5px]">
                {s.cta}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
