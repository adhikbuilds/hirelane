"use client";

import Image from "next/image";
import { useRef, type ReactNode } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { cn } from "@/lib/utils";

/** Spatial panel: translucent forest, 20px blur, 1px inner highlight, layered shadows (docs/design/landing-v3.md). */
export const PANEL =
  "relative isolate overflow-hidden rounded-[28px] bg-[rgb(15_31_16/0.55)] backdrop-blur-[20px] " +
  "shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08),0_1px_2px_rgb(0_0_0/0.35),0_16px_32px_-12px_rgb(0_0_0/0.45),0_48px_96px_-32px_rgb(0_0_0/0.6)] " +
  "before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-[linear-gradient(160deg,rgb(255_255_255/0.07),transparent_38%)]";

/** Entrance: 16-32px rise and fade, once, staggered by `index` x 75 ms. No movement under reduced motion. */
export function Rise({ children, index = 0, y = 24, className }: { children: ReactNode; index?: number; y?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      // Same `initial` on server and client (no reduced-motion branch, or hydration would differ); reduced motion only zeroes the timing.
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: reduce ? 0 : 0.6, ease: [0.16, 1, 0.3, 1], delay: reduce ? 0 : index * 0.075 }}
    >
      {children}
    </motion.div>
  );
}

/** A road photograph behind a section under a forest scrim. It drifts a little with scroll (transform only). */
export function PhotoBackdrop({ src, scrim = 0.68, alt = "", className }: { src: string; scrim?: number; alt?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [-28, 28]);
  return (
    <div ref={ref} aria-hidden className={cn("absolute inset-0 -z-10 overflow-hidden bg-[#0f1f10]", className)}>
      <motion.div className="absolute inset-x-0 -inset-y-10 motion-reduce:!transform-none" style={{ y }}>
        <Image src={src} alt={alt} fill sizes="100vw" className="object-cover" />
      </motion.div>
      <div className="absolute inset-0" style={{ background: `rgb(15 31 16 / ${scrim})` }} />
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[#0f1f10] to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#0f1f10] to-transparent" />
    </div>
  );
}
