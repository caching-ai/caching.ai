"use client";
import { useRouter } from "next/navigation";
import { useI18n } from "./I18nProvider";

export default function LogoutButton() {
  const router = useRouter();
  const { dict } = useI18n();
  return (
    <button
      className="self-start text-[14.5px] text-mute hover:text-ink"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/");
        router.refresh();
      }}
    >
      {dict.console.nav.signOut}
    </button>
  );
}
