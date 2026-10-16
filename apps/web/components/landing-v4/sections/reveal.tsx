"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

/** Entrance: a 20px rise and fade, once, staggered by `index` x 70 ms. Reduced motion zeroes the timing only. */
export function Reveal({ children, index = 0, y = 20, className }: { children: ReactNode; index?: number; y?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12 }}
      transition={{ duration: reduce ? 0 : 0.55, ease: [0.16, 1, 0.3, 1], delay: reduce ? 0 : index * 0.07 }}
    >
      {children}
    </motion.div>
  );
}
