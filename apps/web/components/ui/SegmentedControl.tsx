"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "./cn";

export type Segment<T extends string> = { value: T; label: ReactNode; ariaLabel?: string; disabled?: boolean };

export type SegmentedControlProps<T extends string> = {
  label: string;
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
  tone?: "light" | "dark";
};

/** A radiogroup with roving tabindex: arrows move and select, Home/End jump. A sliding thumb marks the choice. */
export function SegmentedControl<T extends string>({ label, segments, value, onChange, size = "md", className, tone = "light" }: SegmentedControlProps<T>) {
  const group = useId();
  const reduce = useReducedMotion();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (from: number, dir: 1 | -1 | "first" | "last") => {
    const enabled = segments.map((s, i) => (s.disabled ? -1 : i)).filter((i) => i >= 0);
    if (enabled.length === 0) return;
    let next: number;
    if (dir === "first") next = enabled[0]!;
    else if (dir === "last") next = enabled[enabled.length - 1]!;
    else {
      const pos = enabled.indexOf(from);
      next = enabled[(pos + dir + enabled.length) % enabled.length]!;
    }
    onChange(segments[next]!.value);
    refs.current[next]?.focus();
  };

  const onKey = (e: KeyboardEvent, i: number) => {
    const map: Record<string, 1 | -1 | "first" | "last"> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: "first", End: "last" };
    const dir = map[e.key];
    if (dir === undefined) return;
    e.preventDefault();
    move(i, dir);
  };

  const dark = tone === "dark";
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex rounded-[12px] border p-1",
        dark ? "border-white/15 bg-white/10" : "border-line bg-ink/[0.04]",
        className,
      )}
    >
      {segments.map((s, i) => {
        const selected = s.value === value;
        return (
          <button
            key={s.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={s.ariaLabel}
            disabled={s.disabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(s.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "relative rounded-[9px] font-bold tabular-nums transition-colors duration-150 disabled:opacity-40",
              size === "sm" ? "h-8 px-3 text-[13px]" : "h-9 px-4 text-[14px]",
              selected ? (dark ? "text-ink" : "text-lane") : dark ? "text-white/70 hover:text-white" : "text-ink-2 hover:text-ink",
            )}
          >
            {selected && (
              <motion.span
                layoutId={`seg-${group}`}
                aria-hidden
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 38 }}
                className={cn("absolute inset-0 rounded-[9px]", dark ? "bg-white" : "bg-surface shadow-control ring-1 ring-line")}
              />
            )}
            <span className="relative z-10">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}
