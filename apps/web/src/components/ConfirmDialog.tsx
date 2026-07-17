"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useI18n } from "./I18nProvider";

// Custom replacement for window.confirm/alert — the native popups clash with
// the product's look. One provider per (client) subtree; call sites await
// confirm()/notice() exactly like the built-ins.

interface DialogState {
  mode: "confirm" | "notice";
  message: string;
  danger: boolean;
  resolve: (v: boolean) => void;
}

const Ctx = createContext<{
  confirm: (message: string, opts?: { danger?: boolean }) => Promise<boolean>;
  notice: (message: string) => Promise<void>;
} | null>(null);

export function useConfirm() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}

export default function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const { dict } = useI18n();
  const [dlg, setDlg] = useState<DialogState | null>(null);

  const confirm = useCallback(
    (message: string, opts?: { danger?: boolean }) =>
      new Promise<boolean>((resolve) =>
        setDlg({ mode: "confirm", message, danger: opts?.danger ?? false, resolve })
      ),
    []
  );
  const notice = useCallback(
    (message: string) =>
      new Promise<void>((resolve) =>
        setDlg({ mode: "notice", message, danger: false, resolve: () => resolve() })
      ),
    []
  );

  const close = useCallback(
    (result: boolean) => {
      dlg?.resolve(result);
      setDlg(null);
    },
    [dlg]
  );

  useEffect(() => {
    if (!dlg) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter" && dlg.mode === "notice") close(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dlg, close]);

  return (
    <Ctx.Provider value={{ confirm, notice }}>
      {children}
      {dlg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
          onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }}
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-card border border-hairline bg-canvas p-6 shadow-featured">
            <p className="whitespace-pre-line text-[15.5px] leading-relaxed text-ink">{dlg.message}</p>
            <div className="mt-6 flex justify-end gap-2">
              {dlg.mode === "confirm" && (
                <button className="btn-secondary !min-h-[38px] !px-4 !py-1.5 text-[14px]" onClick={() => close(false)}>
                  {dict.dialog.cancel}
                </button>
              )}
              <button
                className={`btn-primary !min-h-[38px] !px-4 !py-1.5 text-[14px] ${
                  dlg.danger ? "!bg-[#c81e33] hover:!bg-[#a5172a]" : ""
                }`}
                onClick={() => close(true)}
                autoFocus
              >
                {dict.dialog.ok}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
