/** 44px match ring in lane green, the percentage in tabular figures. Drawn as SVG; the ring draws once when it appears. */
export function MatchRing({ score, size = 44 }: { score: number; size?: number }) {
  const sw = 4;
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const s = Math.min(100, Math.max(0, Math.round(score)));
  return (
    <div role="img" aria-label={`Match ${s} percent`} data-testid="match-ring" className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E4EBE6" strokeWidth={sw} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#0F5C45" strokeWidth={sw} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - s / 100)} />
      </svg>
      <span aria-hidden className="absolute text-[13px] leading-none font-extrabold tracking-tight text-[#13201A] tabular-nums">
        {s}%
      </span>
    </div>
  );
}
