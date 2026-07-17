"use client";
import { useEffect, useState } from "react";
import { useI18n } from "./I18nProvider";

/** shown until the user's email is verified; also flashes the success state
 *  right after the verification link redirects back with ?verified=1 */
export default function VerifyBanner({ verified }: { verified: boolean }) {
  const { dict } = useI18n();
  const t = dict.console.verifyBanner;
  const [sent, setSent] = useState(false);
  const [justVerified, setJustVerified] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("verified") === "1") {
      setJustVerified(true);
      const timer = setTimeout(() => setJustVerified(false), 6000);
      return () => clearTimeout(timer);
    }
  }, []);

  if (verified) {
    return justVerified ? (
      <p className="mb-6 rounded-card border border-accent-green bg-accent-green/5 px-5 py-3.5 text-[15px] text-ink">
        {t.done}
      </p>
    ) : null;
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-card border border-warn bg-[#fff8e8] px-5 py-3.5">
      <span className="text-[15px] text-ink">{sent ? t.sent : t.body}</span>
      {!sent && (
        <button
          className="text-[15px] font-medium text-blue-deep hover:underline"
          onClick={async () => {
            const r = await fetch("/api/auth/verify", { method: "POST" });
            if (r.ok) setSent(true);
          }}
        >
          {t.resend}
        </button>
      )}
    </div>
  );
}
