"use client";

import { useEffect, useRef } from "react";
import { animate, useInView, useReducedMotion } from "motion/react";

export type CountUpProps = {
  value: number;
  /** Intl.NumberFormat options; the locale is fixed to en-US so server and client agree. */
  format?: Intl.NumberFormatOptions;
  prefix?: string;
  suffix?: string;
  durationSec?: number;
  className?: string;
};

/**
 * Counts from 0 to `value` once, when first scrolled into view. The server renders the final number, so crawlers,
 * no-JS readers and reduced-motion users always see the true figure.
 */
export function CountUp({ value, format, prefix = "", suffix = "", durationSec = 1.4, className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -5% 0px" });
  const reduce = useReducedMotion();
  const fmt = (n: number) => `${prefix}${new Intl.NumberFormat("en-US", format).format(n)}${suffix}`;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce || !inView) {
      el.textContent = fmt(value);
      return;
    }
    const controls = animate(0, value, {
      duration: durationSec,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (n) => {
        el.textContent = fmt(n);
      },
      onComplete: () => {
        el.textContent = fmt(value);
      },
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, reduce, value, durationSec]);

  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {fmt(value)}
    </span>
  );
}
