"use client";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "./I18nProvider";
import Tip from "./Tooltip";

interface Period {
  period_start: string;
  period_end: string;
  gross_saved_usd: number;
  keepalive_cost_usd: number;
  net_saved_usd: number;
  fee_usd: number;
  fee_rate: number;
  status: string;
  computed_at: string;
}

interface Method {
  psp: "stripe" | "toss";
  card_label: string;
}

const usd = (v: number) =>
  "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: v < 10 ? 4 : 2 });

declare global {
  interface Window {
    TossPayments?: (clientKey: string) => { requestBillingAuth: (method: string, opts: object) => void };
  }
}

/** card-on-file — Toss for Korean users, Stripe elsewhere */
function PaymentMethod({ tossClientKey }: { tossClientKey: string }) {
  const { dict, locale } = useI18n();
  const t = dict.console.billing;
  const [method, setMethod] = useState<Method | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<"ok" | "fail" | "">("");

  const load = useCallback(async () => {
    const r = await fetch("/api/billing/pm");
    if (r.ok) setMethod((await r.json()).method);
    else setMethod(null);
  }, []);

  useEffect(() => {
    void load();
    const q = new URLSearchParams(window.location.search).get("card");
    if (q === "ok") setBanner("ok");
    if (q === "fail") setBanner("fail");
  }, [load]);

  async function addCard() {
    setBusy(true);
    try {
      if (locale === "ko" && tossClientKey) {
        // Toss Payments billing-key widget (Korea)
        if (!window.TossPayments) {
          await new Promise<void>((resolve, reject) => {
            const s = document.createElement("script");
            s.src = "https://js.tosspayments.com/v1/payment";
            s.onload = () => resolve();
            s.onerror = () => reject(new Error("sdk"));
            document.head.appendChild(s);
          });
        }
        if (!window.TossPayments) throw new Error("not ready");
        // customerKey must match what the confirm route expects: cai-<uid>
        const ckRes = await fetch("/api/billing/customer-key");
        if (!ckRes.ok) throw new Error("session");
        const { customerKey } = await ckRes.json();
        window.TossPayments(tossClientKey).requestBillingAuth("카드", {
          customerKey,
          successUrl: `${window.location.origin}/api/billing/toss/confirm`,
          failUrl: `${window.location.origin}/console/billing?card=fail`,
        });
      } else {
        const r = await fetch("/api/billing/stripe/checkout", { method: "POST" });
        const j = await r.json();
        if (r.ok && j.url) window.location.href = j.url;
        else setBanner("fail");
      }
    } catch {
      setBanner("fail");
    }
    setBusy(false);
  }

  async function removeCard() {
    if (!confirm(t.pmRemoveConfirm)) return;
    await fetch("/api/billing/pm", { method: "DELETE" });
    await load();
  }

  return (
    <section className="card" data-testid="payment-method">
      <h2 className="text-[19px] font-medium text-ink">{t.pmTitle}</h2>
      <p className="mt-1 text-[15px] leading-relaxed text-body-mid">{t.pmSub}</p>
      <p className="mt-1 text-[14px] text-mute">{t.pmNote}</p>
      {banner === "ok" && <p className="mt-3 text-[15px] text-accent-green">{t.pmOk}</p>}
      {banner === "fail" && <p className="mt-3 text-[15px] text-error">{t.pmFail}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-4">
        {method === undefined ? null : method ? (
          <>
            <span className="rounded-btn border border-hairline px-4 py-2.5 font-mono text-[15px] text-ink">
              {method.card_label}
            </span>
            <button className="btn-secondary" onClick={addCard} disabled={busy}>{t.pmReplace}</button>
            <button className="text-[15px] text-error hover:underline" onClick={removeCard}>{t.pmRemove}</button>
          </>
        ) : (
          <>
            <span className="text-[15px] text-mute">{t.pmNone}</span>
            <button className="btn-primary" onClick={addCard} disabled={busy} data-testid="add-card">
              {t.pmAdd}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

export default function Billing({ tossClientKey }: { tossClientKey: string }) {
  const { dict } = useI18n();
  const t = dict.console.billing;
  const tips = dict.console.tips;
  const [periods, setPeriods] = useState<Period[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/billing")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((j) => setPeriods(j.periods))
      .catch(() => setError(t.loadError));
  }, []);

  if (error) return <p className="text-error">{error}</p>;
  if (!periods) return <p className="text-mute">{t.loading}</p>;

  const current = periods[0];
  const statusLabel = (s: string) =>
    s === "beta_waived" ? t.statusWaived
    : s === "paid" ? t.statusPaid
    : s === "charge_failed" ? t.statusFailed
    : s === "waived_min" ? t.statusWaivedMin
    : s === "accruing" ? t.statusAccruing
    : s === "no_payment_method" ? t.statusNoPm
    : s;

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <header>
        <h1 className="text-display-md text-ink">{t.title}</h1>
        <p className="mt-1 text-[16px] text-mute">{t.sub}</p>
      </header>

      <section className="grid gap-6 md:grid-cols-3">
        <div className="card">
          <div className="inline-flex items-center text-badge text-mute">{t.netSaved}<Tip text={tips.netSaved} /></div>
          <div className={`mt-2 font-mono text-[34px] font-medium leading-none ${(current?.net_saved_usd ?? 0) >= 0 ? "text-accent-green" : "text-ink"}`}>
            {usd(current?.net_saved_usd ?? 0)}
          </div>
        </div>
        <div className="card">
          <div className="inline-flex items-center text-badge text-mute">{t.fee}<Tip text={tips.fee} /></div>
          <div className="mt-2 font-mono text-[34px] font-medium leading-none text-ink">
            {usd(current?.fee_usd ?? 0)}
          </div>
          {current && (
            <span className="mt-3 inline-block rounded bg-blue-info/10 px-2 py-1 text-badge text-blue-info">
              {statusLabel(current.status)}
            </span>
          )}
        </div>
        <div className="card">
          <div className="text-badge text-mute">{t.due}</div>
          <div className="mt-2 font-mono text-[34px] font-medium leading-none text-ink">
            {usd(current?.status === "accruing" || current?.status === "no_payment_method" ? current.fee_usd : 0)}
          </div>
          <p className="mt-3 text-[14px] text-mute">
            {current?.status === "no_payment_method" ? t.dueNoteNoCard : t.dueNote}
          </p>
        </div>
      </section>

      <PaymentMethod tossClientKey={tossClientKey} />

      <section className="card !p-0 overflow-x-auto">
        <h2 className="px-8 pt-8 text-[19px] font-medium text-ink">{t.history}</h2>
        <table className="mt-4 w-full text-[15px]">
          <thead>
            <tr className="border-b border-hairline text-left text-badge text-mute">
              {[t.colPeriod, t.colGross, t.colKa, t.colNet, t.colFee, t.colStatus].map((h) => (
                <th key={h} className="px-8 py-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.period_start} className="border-b border-hairline last:border-0">
                <td className="px-8 py-3 font-mono">{p.period_start.slice(0, 7)}</td>
                <td className={`px-6 py-3 ${p.gross_saved_usd >= 0 ? "text-accent-green" : "text-ink"}`}>{usd(p.gross_saved_usd)}</td>
                <td className="px-8 py-3">{usd(p.keepalive_cost_usd)}</td>
                <td className="px-8 py-3 font-medium text-ink">{usd(p.net_saved_usd)}</td>
                <td className="px-8 py-3">{usd(p.fee_usd)}</td>
                <td className="px-8 py-3">
                  <span className="rounded bg-blue-info/10 px-2 py-0.5 text-badge text-blue-info">
                    {statusLabel(p.status)}
                  </span>
                </td>
              </tr>
            ))}
            {!periods.length && (
              <tr><td className="px-8 py-6 text-mute" colSpan={6}>{t.emptyHistory}</td></tr>
            )}
          </tbody>
        </table>
        <p className="px-8 pb-8 pt-3 text-[14px] text-mute">{t.note}</p>
      </section>
    </div>
  );
}
