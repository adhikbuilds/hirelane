"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

export type RevealProps = {
  children: ReactNode;
  /** Seconds before the reveal starts; use it to stagger siblings. */
  delay?: number;
  /** Pixels risen from. */
  y?: number;
  className?: string;
  as?: "div" | "section" | "li" | "span";
};

/** Fades and lifts its children into view the first time they scroll in. Static under reduced motion. */
export function Reveal({ children, delay = 0, y = 18, className, as = "div" }: RevealProps) {
  const reduce = useReducedMotion();
  const Tag = motion[as];
  if (reduce) return <Tag className={className}>{children}</Tag>;
  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </Tag>
  );
}
