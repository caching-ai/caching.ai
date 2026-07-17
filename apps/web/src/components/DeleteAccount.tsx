"use client";
import { useRouter } from "next/navigation";
import { useI18n } from "./I18nProvider";
import { useConfirm } from "./ConfirmDialog";

/** Self-serve account deletion — small link in the console sidebar footer. */
export default function DeleteAccount() {
  const router = useRouter();
  const { dict } = useI18n();
  const { confirm, notice } = useConfirm();
  const t = dict.console.account;

  return (
    <button
      className="self-start text-[13px] text-mute-soft hover:text-error"
      onClick={async () => {
        if (!(await confirm(t.deleteConfirm, { danger: true }))) return;
        if (!(await confirm(t.deleteConfirm2, { danger: true }))) return;
        const r = await fetch("/api/account", { method: "DELETE" });
        if (r.ok) {
          router.push("/");
          router.refresh();
        } else {
          await notice(t.deleteFailed);
        }
      }}
    >
      {t.delete}
    </button>
  );
}
