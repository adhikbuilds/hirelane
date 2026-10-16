"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motion, useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
import { cn } from "@/lib/utils";

type Stop = { label: string; y: number };
type Geo = { w: number; h: number; stops: Stop[]; end: number };

const NO_GEO: Geo = { w: 0, h: 0, stops: [], end: 0 };
/** Signpost sits this far below the top of its chapter, inside the chapter's top padding. */
export const STOP_OFFSET = 28;
const CURVE = 120;

/** Gutter x of the lane: 14px on phones, 26px from md up. */
const laneX = (w: number) => (w >= 768 ? 26 : 14);

/** The lane runs straight down the gutter, then swings to the centre and ends above the last chapter. */
export function lanePath(g: Geo): string {
  const x = laneX(g.w);
  const cx = g.w / 2;
  const y1 = Math.max(0, g.end - 40 - CURVE);
  return `M ${x} 0 L ${x} ${y1} C ${x} ${y1 + CURVE * 0.7}, ${cx} ${y1 + CURVE * 0.3}, ${cx} ${g.end}`;
}

/**
 * The throughline: a lane with dash marks, drawn as you scroll, with a signpost at every `[data-chapter]` inside.
 * It sits behind the chapters (they are transparent), ends in a lime arrow above the last one, and is fully drawn and
 * static under reduced motion. Wrap the page's chapters with it.
 */
export function LaneLine({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = !!useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<Geo>(NO_GEO);
  const [lit, setLit] = useState(reduce ? Infinity : 0);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const chapters = Array.from(el.querySelectorAll<HTMLElement>("[data-chapter]"));
    const stops = chapters.map((c) => ({ label: c.dataset.chapter ?? "", y: Math.round(c.getBoundingClientRect().top - box.top + STOP_OFFSET) }));
    const last = chapters[chapters.length - 1];
    const end = last ? Math.round(last.getBoundingClientRect().top - box.top + 112) : Math.round(box.height);
    setGeo((p) => (p.w === Math.round(box.width) && p.h === Math.round(box.height) && p.end === end && p.stops.length === stops.length && p.stops.every((s, i) => s.y === stops[i]!.y) ? p : { w: Math.round(box.width), h: Math.round(box.height), stops, end }));
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure, children]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 60%", "end 60%"] });
  useMotionValueEvent(scrollYProgress, "change", (p) => {
    if (!reduce) setLit(p * geo.h);
  });
  useEffect(() => {
    if (reduce) setLit(Infinity);
  }, [reduce]);

  const x = laneX(geo.w);
  const d = geo.w ? lanePath(geo) : "";
  const done = lit >= geo.end;

  return (
    <div ref={ref} className={cn("relative", className)} data-testid="lane">
      {geo.w > 0 && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
          <svg width={geo.w} height={geo.h} className="absolute left-0 top-0 overflow-visible" data-testid="lane-svg">
            <defs>
              <mask id="lane-drawn" maskUnits="userSpaceOnUse" x="0" y="0" width={geo.w} height={geo.h}>
                <motion.path d={d} fill="none" stroke="#fff" strokeWidth={8} style={{ pathLength: reduce ? 1 : scrollYProgress }} />
              </mask>
            </defs>
            <path d={d} fill="none" stroke="#13201a" strokeOpacity={0.14} strokeWidth={3} strokeDasharray="10 12" strokeLinecap="round" />
            <path d={d} fill="none" stroke="#0f5c45" strokeWidth={3} strokeDasharray="10 12" strokeLinecap="round" mask="url(#lane-drawn)" />
            <path
              d={`M ${geo.w / 2 - 11} ${geo.end - 14} L ${geo.w / 2} ${geo.end + 4} L ${geo.w / 2 + 11} ${geo.end - 14} Z`}
              fill="#c6f19d"
              stroke="#13201a"
              strokeWidth={2.5}
              strokeLinejoin="round"
              style={{ opacity: done || reduce ? 1 : 0.25, transition: "opacity 300ms" }}
              data-testid="lane-arrow"
            />
          </svg>
          {geo.stops.map((s) => {
            const on = lit >= s.y;
            return (
              <div key={`${s.label}-${s.y}`} className="absolute flex items-center gap-2" style={{ top: s.y - 12, left: x - 7 }} data-testid="lane-stop">
                <span className={cn("size-3.5 rounded-full border-[3px] transition-colors duration-300", on ? "border-[#0f5c45] bg-[#c6f19d]" : "border-[#13201a]/25 bg-[#f7f6f2]")} />
                <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-bold uppercase leading-3 tracking-[0.08em] transition-colors duration-300", on ? "bg-[#13201a] text-[#f7f6f2]" : "bg-[#13201a]/8 text-[#55625b]")}>{s.label}</span>
              </div>
            );
          })}
        </div>
      )}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
