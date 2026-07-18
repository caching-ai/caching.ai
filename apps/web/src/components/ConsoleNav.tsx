"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "./I18nProvider";

export default function ConsoleNav({
  workspace = "personal",
  orgAdmin = false,
}: {
  workspace?: "personal" | "org";
  orgAdmin?: boolean;
}) {
  const path = usePathname();
  const { dict } = useI18n();
  const t = dict.console.nav;
  const to = dict.console.org.nav;
  // Team workspace: admins get the team dashboard as THE dashboard — the
  // personal one is hidden (its numbers live in the member table). Members
  // keep their own view, labeled "my usage" so it can't be mistaken for a
  // team-wide picture.
  const items: { href: string; label: string }[] =
    workspace === "org" && orgAdmin
      ? [
          { href: "/console/org", label: to.overview },
          { href: "/console/org/members", label: to.members },
          { href: "/console/org/policies", label: to.policies },
          { href: "/console/keys", label: t.keys },
          { href: "/console/billing", label: t.billing },
          { href: "/console/org/audit", label: to.audit },
          { href: "/console/org/settings", label: to.settings },
        ]
      : [
          { href: "/console", label: workspace === "org" ? t.myUsage : t.dashboard },
          { href: "/console/keys", label: t.keys },
          { href: "/console/billing", label: t.billing },
        ];
  items.push({ href: "/docs", label: t.docs });
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 py-3 md:flex-col md:overflow-visible">
      {items.map((it) => {
        const active = path === it.href;
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`relative whitespace-nowrap rounded-btn px-3 py-2 text-[16px] transition-colors ${
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
