"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "./I18nProvider";

export default function ConsoleNav() {
  const path = usePathname();
  const { dict } = useI18n();
  const t = dict.console.nav;
  const items = [
    { href: "/console", label: t.dashboard },
    { href: "/console/keys", label: t.keys },
    { href: "/console/billing", label: t.billing },
    { href: "/docs", label: t.docs },
  ];
  return (
    <nav className="flex gap-1 px-3 pb-3 md:flex-col md:pb-0">
      {items.map((it) => {
        const active = path === it.href;
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`relative rounded-btn px-3 py-2 text-[16px] transition-colors ${
              active ? "font-medium text-ink" : "text-body-mid hover:text-ink"
            }`}
          >
            {active && (
              <span className="absolute left-0 top-1/2 hidden h-5 w-[3px] -translate-y-1/2 rounded bg-primary md:block" />
            )}
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
