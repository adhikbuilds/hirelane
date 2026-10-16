"use client";

import { useEffect, useRef, useState } from "react";
import { animate, motion, useInView, useReducedMotion } from "motion/react";

/** Field labels of the demo form, in order. The counter uses the real count, so extra fields are generic. */
const FIELDS = ["Full name", "Email", "LinkedIn", "Resume version", "Why us?", "Start date"] as const;
const VALUES = ["Asha Rao", "asha@example.com", "linkedin.com/in/asha", "Resume v3.pdf", "I build pipelines that…", "Immediately"];

/** Counts up to `to` once in view; reduced motion shows the final number. */
function useCount(to: number, active: boolean, reduce: boolean) {
  const [n, setN] = useState(reduce ? to : 0);
  useEffect(() => {
    if (reduce) return setN(to);
    if (!active) return;
    const c = animate(0, to, { duration: 1.2, delay: 0.9, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => setN(Math.round(v)) });
    return () => c.stop();
  }, [to, active, reduce]);
  return n;
}

export function ProblemPile({ fieldCount, applications }: { fieldCount: number; applications: number }) {
  const reduce = !!useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const total = fieldCount * applications;
  const count = useCount(total, inView, reduce);
  const rows = Array.from({ length: fieldCount }, (_, i) => ({ label: FIELDS[i] ?? `Question ${i - FIELDS.length + 3}`, value: VALUES[i] ?? "Same answer" }));

  return (
    <div ref={ref} className="relative mx-auto w-full max-w-[560px] pb-4 pt-2" data-testid="problem-pile">
      <ol aria-label={`${applications} application forms asking the same ${fieldCount} fields`} className="relative" style={{ height: 176 + (applications - 1) * 62 }}>
        {Array.from({ length: applications }, (_, i) => {
          const last = i === applications - 1;
          return (
            <motion.li
              key={i}
              initial={{ opacity: 0, y: -48, rotate: i % 2 ? 1.6 : -1.4 }}
              animate={inView ? { opacity: 1, y: 0, rotate: i % 2 ? 0.8 : -0.7 } : undefined}
              transition={{ duration: reduce ? 0 : 0.6, delay: reduce ? 0 : i * 0.12, ease: [0.16, 1, 0.3, 1] }}
              className="absolute inset-x-0 rounded-[18px] bg-card p-4 shadow-[0_1px_2px_rgb(19_32_26/.08),0_14px_30px_-14px_rgb(19_32_26/.28)] ring-1 ring-black/5"
              style={{ top: i * 62, zIndex: i }}
            >
              <p className="flex items-center justify-between text-[13px] font-bold text-muted-foreground">
                <span>Application {i + 1}</span>
                <span className="rounded-full bg-accent px-2 py-0.5">{fieldCount} fields</span>
              </p>
              <dl className={last ? "mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5" : "mt-2 grid grid-cols-2 gap-x-4"}>
                {rows.slice(0, last ? fieldCount : 2).map((r) => (
                  <div key={r.label} className="min-w-0">
                    <dt className="text-[12px] font-semibold leading-4 text-muted-foreground">{r.label}</dt>
                    <dd className="truncate text-[14px] font-semibold leading-5">{r.value}</dd>
                  </div>
                ))}
              </dl>
            </motion.li>
          );
        })}
      </ol>

      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={inView ? { opacity: 1, scale: 1 } : undefined}
        transition={{ duration: reduce ? 0 : 0.4, delay: reduce ? 0 : 0.7 }}
        className="absolute -right-2 -top-3 z-30 rounded-[16px] bg-[var(--ink)] px-4 py-3 text-[#f7f6f2] shadow-[0_18px_36px_-14px_rgb(19_32_26/.55)] sm:-right-6"
        data-testid="field-counter"
      >
        <p className="text-[34px] font-extrabold leading-9 tracking-[-0.03em] tabular-nums" aria-label={`${total} fields`}>
          <span aria-hidden>{count}</span>
        </p>
        <p className="text-[12px] font-semibold leading-4 text-[#b4c0b9]">fields Asha would retype</p>
        <p className="text-[11px] leading-4 text-[#b4c0b9]" data-testid="counter-math">
          {fieldCount} fields × {applications} applications
        </p>
      </motion.div>
      <p className="mt-6 text-[13px] text-muted-foreground">Sample profile: Asha, data engineer, Bengaluru.</p>
    </div>
  );
}
