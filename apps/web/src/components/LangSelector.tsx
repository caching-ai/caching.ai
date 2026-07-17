"use client";
import { useRouter } from "next/navigation";
import { LANG_COOKIE, LOCALE_NAMES, SUPPORTED_LOCALES } from "@/lib/i18n/shared";
import { useI18n } from "./I18nProvider";

export default function LangSelector({ compact = false, dark = false }: { compact?: boolean; dark?: boolean }) {
  const router = useRouter();
  const { locale, dict } = useI18n();

  return (
    <label className={`inline-flex items-center gap-2 text-[14px] ${dark ? "text-[#9a9a9a]" : "text-mute"}`}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2c2.5 2.6 4 6.1 4 10s-1.5 7.4-4 10c-2.5-2.6-4-6.1-4-10s1.5-7.4 4-10z" />
      </svg>
      {!compact && <span className="sr-only">{dict.footer.language}</span>}
      <select
        aria-label={dict.footer.language}
        className={`cursor-pointer rounded-btn border px-2 py-1.5 text-[14px] outline-none ${
          dark
            ? "border-[#3a3a3a] bg-[#1a1a1a] text-[#c9c9c9] hover:border-[#6a6a6a]"
            : "border-hairline bg-canvas text-body-mid hover:border-ink"
        }`}
        value={locale}
        onChange={(e) => {
          document.cookie = `${LANG_COOKIE}=${e.target.value};path=/;max-age=${365 * 24 * 3600};samesite=lax`;
          router.refresh();
        }}
      >
        {SUPPORTED_LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
