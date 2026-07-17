"use client";
import { useState } from "react";
import { useI18n } from "./I18nProvider";
import { useFx } from "@/lib/fx";

// Honest model: providers already cache — the win is a HIGHER hit rate.
// bill(hit) = tokens × price × (1 − 0.9 × hit)   (cache reads at 0.1×)
const PRICE_PER_MTOK = 5; // Opus-tier input price used for illustration

export default function SavingsCalculator() {
  const { dict, locale } = useI18n();
  const t = dict.calc;
  const { cur, rate, fmtMoney } = useFx(locale);
  const [mtok, setMtok] = useState(500);
  const [currentHit, setCurrentHit] = useState(25);
  const [targetHit, setTargetHit] = useState(70);

  const bill = (hit: number) => mtok * PRICE_PER_MTOK * (1 - 0.9 * (hit / 100));
  const now = bill(currentHit);
  const after = bill(Math.max(targetHit, currentHit));
  const saved = Math.max(0, now - after);

  const fmt = (v: number) => fmtMoney(v, 0);

  return (
    <div className="card shadow-featured">
      <div className="grid gap-8 md:grid-cols-2">
        <div className="flex flex-col gap-6">
          <label className="block">
            <span className="text-badge text-mute">{t.tokens}</span>
            <div className="mt-1 font-mono text-display-md text-ink">{mtok.toLocaleString()}M</div>
            <input
              type="range" min={10} max={10000} step={10} value={mtok}
              onChange={(e) => setMtok(Number(e.target.value))}
              className="mt-2 w-full accent-[#080808]"
            />
          </label>
          <label className="block">
            <span className="text-badge text-mute">{t.currentHit}</span>
            <div className="mt-1 font-mono text-display-md text-mute">{currentHit}%</div>
            <input
              type="range" min={0} max={90} step={5} value={currentHit}
              onChange={(e) => {
                const v = Number(e.target.value);
                setCurrentHit(v);
                if (targetHit < v) setTargetHit(v);
              }}
              className="mt-2 w-full accent-[#898989]"
            />
          </label>
          <label className="block">
            <span className="text-badge text-mute">{t.targetHit}</span>
            <div className="mt-1 font-mono text-display-md text-ink">{Math.max(targetHit, currentHit)}%</div>
            <input
              type="range" min={currentHit} max={95} step={5} value={Math.max(targetHit, currentHit)}
              onChange={(e) => setTargetHit(Number(e.target.value))}
              className="mt-2 w-full accent-[#080808]"
            />
          </label>
        </div>
        <div className="flex flex-col justify-center gap-5 border-t border-hairline pt-6 md:border-l md:border-t-0 md:pl-8 md:pt-0">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-badge text-mute">{t.now}</span>
            <span className="font-mono text-[24px] text-mute">{fmt(now)}{t.perMo}</span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-badge text-mute">{t.after}</span>
            <span className="font-mono text-[24px] text-ink">{fmt(after)}{t.perMo}</span>
          </div>
          <div className="border-t border-hairline pt-5">
            <div className="text-badge text-mute">{t.savings}</div>
            <div className="font-mono text-display-lg text-[#00a51b]" data-testid="calc-savings">
              {fmt(saved)}{t.perMo}
            </div>
          </div>
          <p className="text-sm text-mute">{t.note}{rate !== 1 ? ` ${t.fxNote}` : ""}</p>
        </div>
      </div>
    </div>
  );
}
