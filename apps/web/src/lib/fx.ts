"use client";
import { useEffect, useState } from "react";

// Locale → display currency, with daily-refreshed rates from /api/fx and
// static fallbacks (2026-07 snapshot) until they arrive. Rates are units of
// the currency per 1 USD; money is STORED in USD everywhere.

export interface DisplayCurrency {
  code: string;
  numLocale: string;
  /** whole-number currencies get integer inputs/rounding */
  integer: boolean;
}

export const CURRENCY_BY_LOCALE: Record<string, DisplayCurrency> = {
  en: { code: "USD", numLocale: "en-US", integer: false },
  ko: { code: "KRW", numLocale: "ko-KR", integer: true },
  ja: { code: "JPY", numLocale: "ja-JP", integer: true },
  zh: { code: "CNY", numLocale: "zh-CN", integer: false },
  es: { code: "EUR", numLocale: "es-ES", integer: false },
};

export const STATIC_RATES: Record<string, number> = { USD: 1, KRW: 1520, JPY: 162, CNY: 6.8, EUR: 0.87 };

let cached: Record<string, number> | null = null;

export function useFx(locale: string) {
  const cur = CURRENCY_BY_LOCALE[locale] ?? CURRENCY_BY_LOCALE.en;
  const [rates, setRates] = useState<Record<string, number>>(cached ?? STATIC_RATES);

  useEffect(() => {
    if (cached) return;
    fetch("/api/fx")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.rates) {
          const merged: Record<string, number> = { ...STATIC_RATES, ...j.rates };
          cached = merged;
          setRates(merged);
        }
      })
      .catch(() => {});
  }, []);

  const rate = rates[cur.code] ?? 1;
  const fmtMoney = (usd: number, maxFrac?: number) =>
    new Intl.NumberFormat(cur.numLocale, {
      style: "currency",
      currency: cur.code,
      maximumFractionDigits: maxFrac ?? (cur.integer ? 0 : 2),
    }).format(usd * rate);

  return { cur, rate, fmtMoney };
}
