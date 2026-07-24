// #economics timeline — the sparse-traffic shape (same shape as benchmark S2),
// drawn twice: warming off (every re-request lands outside the 5-min cache band
// → red re-buy) vs warming on (continuous warm band, all hits + cheap pings).
// Pure SVG, server-safe; labels come from the locale dict.

const W = 720;
const PAD = 16;
const AXIS = 60; // minutes
const TTL = 5;
const CALLS = [1, 11, 21, 31, 41, 51];
const C = { blue: "#4f7cf0", green: "#1f9d5b", red: "#c0392b", gray: "#b7becc", band: "#e9edf6", warm: "rgba(31,157,91,.16)", cold: "rgba(79,124,240,.14)" };

const x = (min: number) => PAD + (min / AXIS) * (W - PAD * 2);

function pings(): number[] {
  const out: number[] = [];
  for (let i = 0; i < CALLS.length - 1; i++) {
    for (let p = CALLS[i] + 4; p < CALLS[i + 1] - 0.5; p += 4) out.push(p);
  }
  return out;
}

function Lane({ warmed, y }: { warmed: boolean; y: number }) {
  const ps = warmed ? pings() : [];
  const acts = warmed ? [...CALLS, ...ps].sort((a, b) => a - b) : CALLS;
  return (
    <g>
      <line x1={PAD} y1={y} x2={W - PAD} y2={y} stroke={C.band} strokeWidth={1.5} />
      {acts.map((a, i) => {
        const end = Math.min(a + TTL, acts[i + 1] ?? AXIS, AXIS);
        return <rect key={"t" + i} x={x(a)} y={y - 4} width={Math.max(0, x(end) - x(a))} height={8} rx={4} fill={warmed ? C.warm : C.cold} />;
      })}
      {ps.map((p, i) => <circle key={"p" + i} cx={x(p)} cy={y} r={2.2} fill={C.gray} />)}
      {CALLS.map((c, i) => {
        const miss = !warmed && i > 0 && c - CALLS[i - 1] > TTL;
        return (
          <g key={"c" + i}>
            {miss && <circle cx={x(c)} cy={y} r={8} fill="rgba(192,57,43,.14)" />}
            <circle cx={x(c)} cy={y} r={4} fill={i === 0 ? C.blue : miss ? C.red : C.green} />
          </g>
        );
      })}
    </g>
  );
}

export type EconVizLabels = {
  off: string; offResult: string; on: string; onResult: string;
  legend: [string, string, string, string]; // first-write, hit, miss, ping
  note: string;
};

export default function EconTimeline({ t }: { t: EconVizLabels }) {
  const H = 112;
  const legendDot = (color: string, label: string, ring?: boolean) => (
    <span key={label} className="inline-flex items-center gap-1.5 text-[12.5px] text-body-mid">
      <svg width={13} height={13} viewBox="0 0 14 14">
        {ring && <circle cx={7} cy={7} r={7} fill="rgba(192,57,43,.14)" />}
        <circle cx={7} cy={7} r={4} fill={color} />
      </svg>
      {label}
    </span>
  );
  return (
    <div className="card mx-auto mt-10 max-w-4xl !p-6">
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
        {legendDot(C.blue, t.legend[0])}
        {legendDot(C.green, t.legend[1])}
        {legendDot(C.red, t.legend[2], true)}
        {legendDot(C.gray, t.legend[3])}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 block h-auto w-full" role="img" aria-label={t.note}>
        <text x={PAD} y={20} fontSize={12} fill="#7c8496">{t.off}</text>
        <text x={W - PAD} y={20} fontSize={12} fill={C.red} fontWeight={700} textAnchor="end">{t.offResult}</text>
        <Lane warmed={false} y={32} />
        <text x={PAD} y={68} fontSize={12} fill="#7c8496">{t.on}</text>
        <text x={W - PAD} y={68} fontSize={12} fill={C.green} fontWeight={700} textAnchor="end">{t.onResult}</text>
        <Lane warmed y={80} />
        <text x={PAD} y={H - 4} fontSize={11} fill="#a3aab8">0m</text>
        <text x={W - PAD} y={H - 4} fontSize={11} fill="#a3aab8" textAnchor="end">60m</text>
      </svg>
      <p className="mt-2 text-center text-[13px] leading-relaxed text-mute">{t.note}</p>
    </div>
  );
}
