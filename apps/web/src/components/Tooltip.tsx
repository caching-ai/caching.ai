"use client";
import { useRef, useState } from "react";

/**
 * Custom help tooltip — a small "?" that explains jargon in plain language.
 * Shows immediately on hover/focus, toggles on tap (mobile). Never uses the
 * native title= attribute. Opens above by default, but flips below when the
 * trigger is near the top of the viewport so it never gets clipped, and
 * nudges horizontally to stay inside the viewport.
 */
export default function Tip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [below, setBelow] = useState(false);
  const [shiftX, setShiftX] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);

  const show = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      // ~130px is the typical rendered tooltip height incl. margin
      setBelow(r.top < 140);
      const half = 150; // tooltip width 300 / 2
      const center = r.left + r.width / 2;
      let dx = 0;
      if (center - half < 8) dx = 8 - (center - half);
      else if (center + half > window.innerWidth - 8) dx = window.innerWidth - 8 - (center + half);
      setShiftX(dx);
    }
    setOpen(true);
  };
  const hide = () => setOpen(false);

  return (
    <span
      className="relative inline-flex items-center align-middle"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <button
        ref={btnRef}
        type="button"
        aria-label={text}
        onFocus={show}
        onBlur={hide}
        onClick={() => (open ? hide() : show())}
        className="ml-1.5 flex h-[18px] w-[18px] shrink-0 cursor-help items-center justify-center rounded-full border border-hairline bg-canvas text-[12px] font-medium leading-none text-mute transition-colors hover:border-ink hover:text-ink"
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          style={{ transform: `translateX(calc(-50% + ${shiftX}px))` }}
          className={`absolute left-1/2 z-50 w-[300px] max-w-[80vw] whitespace-normal rounded-card border border-ink bg-ink p-3.5 text-left text-[14.5px] font-normal normal-case leading-relaxed tracking-normal text-white shadow-featured ${
            below ? "top-full mt-2" : "bottom-full mb-2"
          }`}
        >
          {text}
          <span
            style={{ transform: `translateX(calc(-50% - ${shiftX}px))` }}
            className={`absolute left-1/2 border-[5px] border-transparent ${
              below ? "bottom-full border-b-ink" : "top-full border-t-ink"
            }`}
          />
        </span>
      )}
    </span>
  );
}
