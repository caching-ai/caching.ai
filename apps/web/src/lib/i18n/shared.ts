// Client-safe i18n primitives (no next/headers imports here).
import { en, type Dict } from "./en";
import { ko } from "./ko";
import { ja } from "./ja";
import { zh } from "./zh";
import { es } from "./es";

export const SUPPORTED_LOCALES = ["en", "ko", "ja", "zh", "es"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  ko: "한국어",
  ja: "日本語",
  zh: "中文",
  es: "Español",
};

const DICTS: Record<Locale, Dict> = { en, ko, ja, zh, es };

export const LANG_COOKIE = "caching_lang";

export function isLocale(v: string | undefined | null): v is Locale {
  return !!v && (SUPPORTED_LOCALES as readonly string[]).includes(v);
}

export function negotiate(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return "en";
  const parts = acceptLanguage
    .split(",")
    .map((p) => {
      const [tag, q] = p.trim().split(";q=");
      return { tag: (tag ?? "").toLowerCase(), q: q ? parseFloat(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { tag } of parts) {
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return "en";
}

export function getDict(locale: Locale): Dict {
  return DICTS[locale] ?? en;
}

/** "{name} pings" + {name: "3"} → "3 pings" */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

export type { Dict };
