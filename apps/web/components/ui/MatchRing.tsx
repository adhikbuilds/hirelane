"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "./cn";

export type MatchRingProps = {
  /** 0 to 100. Out-of-range and non-finite values are clamped. */
  score: number;
  size?: number;
  strokeWidth?: number;
  /** Shows the number in the middle. */
  showValue?: boolean;
  className?: string;
};

export const clampScore = (n: number): number => (Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 0);

/** Colour is state: green for a strong match, signal for a partial one, red for a weak one. */
export function ringTone(score: number): { stroke: string; text: string; label: string } {
  if (score >= 75) return { stroke: "var(--color-match)", text: "text-[#047857]", label: "strong match" };
  if (score >= 50) return { stroke: "var(--color-signal)", text: "text-signal-ink", label: "partial match" };
  return { stroke: "var(--color-miss)", text: "text-[#b91c1c]", label: "weak match" };
}

/** An SVG score ring whose stroke draws in on mount (static under reduced motion). */
export function MatchRing({ score, size = 72, strokeWidth = 7, showValue = true, className }: MatchRingProps) {
  const reduce = useReducedMotion();
  const s = clampScore(score);
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const target = c * (1 - s / 100);
  const tone = ringTone(s);
  return (
    <div
      role="img"
      aria-label={`Match score ${s} out of 100, ${tone.label}`}
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={strokeWidth} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone.stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: reduce ? target : c }}
          animate={{ strokeDashoffset: target }}
          transition={reduce ? { duration: 0 } : { duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
          data-testid="match-ring-arc"
        />
      </svg>
      {showValue && (
        <span aria-hidden className={cn("absolute font-extrabold tabular-nums tracking-tight", tone.text)} style={{ fontSize: size * 0.32 }}>
          {s}
        </span>
      )}
    </div>
  );
}
