"use client";
import { createContext, useContext } from "react";
import type { Dict, Locale } from "@/lib/i18n/shared";
import { en } from "@/lib/i18n/en";

const Ctx = createContext<{ locale: Locale; dict: Dict }>({ locale: "en", dict: en });

export function I18nProvider({
  locale,
  dict,
  children,
}: {
  locale: Locale;
  dict: Dict;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={{ locale, dict }}>{children}</Ctx.Provider>;
}

export function useI18n() {
  return useContext(Ctx);
}
