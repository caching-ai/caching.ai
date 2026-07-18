"use client";
import { useState } from "react";

/** Code block with a hover copy button — used on the docs page. */
export default function CopyCode({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-card bg-[#0d0d0d] p-5 font-mono text-[15px] leading-relaxed text-[#e8e8e8]">
        {code}
      </pre>
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }).catch(() => {});
        }}
        className="absolute right-2.5 top-2.5 rounded-btn border border-white/20 bg-white/10 px-2.5 py-1 text-[12.5px] font-medium text-white opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
      >
        {copied ? "✓" : label}
      </button>
    </div>
  );
}
