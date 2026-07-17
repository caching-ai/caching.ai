"use client";
import { useRouter } from "next/navigation";
import { useI18n } from "./I18nProvider";

/** Self-serve account deletion — small link in the console sidebar footer. */
export default function DeleteAccount() {
  const router = useRouter();
  const { dict } = useI18n();
  const t = dict.console.account;

  return (
    <button
      className="self-start text-[13px] text-mute-soft hover:text-error"
      onClick={async () => {
        if (!confirm(t.deleteConfirm)) return;
        if (!confirm(t.deleteConfirm2)) return;
        const r = await fetch("/api/account", { method: "DELETE" });
        if (r.ok) {
          router.push("/");
          router.refresh();
        } else {
          alert(t.deleteFailed);
        }
      }}
    >
      {t.delete}
    </button>
  );
}
