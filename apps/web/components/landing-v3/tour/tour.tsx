"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { motion, motionValue, useMotionValueEvent, useScroll, useTransform } from "motion/react";
import { cn } from "@/lib/utils";
import type { TraceDemo } from "../../landing/types";
import type { StackCardModel } from "../stack/cards";
import { ANSWER_AT, HANDOFF_AT, TOUR_STAGES, frameAt, tourAt, type TourStage } from "./stages";
import { TourCard } from "./tour-card";

/**
 * The pinned scroll tour. Scroll position comes from motion's `useScroll` over a tall section whose inner stage is
 * `position: sticky` (no GSAP: the card stack already uses motion, so there is one animation library on the page).
 * On phones and under reduced motion the four stages are static frames, one under the other.
 */
export function ScrollTour({ card, trace = null }: { card: StackCardModel | null; trace?: TraceDemo | null }) {
  if (!card) return null;
  return (
    <section id="tour" aria-label="What is on every card" data-testid="tour" data-ui-section className="relative bg-[#0f1f10] text-white">
      <div className="hidden lg:motion-safe:block">
        <PinnedTour card={card} trace={trace} />
      </div>
      <div className="lg:motion-safe:hidden">
        <StaticTour card={card} trace={trace} />
      </div>
    </section>
  );
}

function Backdrop() {
  return (
    <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
      <Image src="/landing/road-0000.jpg" alt="" fill sizes="100vw" className="object-cover" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(15_31_16/0.94)_0%,rgb(15_31_16/0.9)_45%,rgb(15_31_16/0.72)_100%)]" />
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#0f1f10] to-transparent" />
    </div>
  );
}

function PinnedTour({ card, trace }: { card: StackCardModel; trace: TraceDemo | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [at, setAt] = useState(() => tourAt(0));
  const [frame, setFrame] = useState(() => frameAt(0, 0));

  useMotionValueEvent(scrollYProgress, "change", (p) => {
    const next = tourAt(p);
    setAt((prev) => (prev.stage === next.stage && prev.started === next.started ? prev : next));
    const f = frameAt(next.stage, next.local);
    setFrame((prev) => (prev.answered === f.answered && prev.handed === f.handed && prev.secondsLeft === f.secondsLeft ? prev : f));
  });
  const drain = useTransform(scrollYProgress, (p) => {
    const { stage, local } = tourAt(p);
    return stage === 3 ? Math.max(0, 1 - local / HANDOFF_AT) : 1;
  });

  return (
    <div ref={ref} className="relative h-[340svh]" data-testid="tour-pinned">
      <div className="sticky top-0 isolate flex h-svh items-center overflow-hidden">
        <Backdrop />
        <div className="mx-auto grid w-full max-w-[1320px] grid-cols-[minmax(0,1fr)_420px] items-center gap-16 px-10">
          <ol className="flex flex-col gap-5" aria-label="Four things every card does">
            {TOUR_STAGES.map((s, i) => {
              const on = at.stage === i;
              return (
                <li key={s.id} aria-current={on ? "step" : undefined} className="relative pl-7">
                  <motion.span
                    aria-hidden
                    className="absolute top-1 bottom-1 left-0 w-1 origin-top rounded-full bg-[#c6f19d]"
                    animate={{ scaleY: on ? 1 : 0.18, opacity: on ? 1 : 0.35 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                  <motion.h2 className="t-heading" animate={{ opacity: on ? 1 : 0.3 }} transition={{ duration: 0.3 }}>
                    {s.heading}
                  </motion.h2>
                </li>
              );
            })}
          </ol>
          <TourCard card={card} stage={at.stage} started={at.started} frame={frame} drain={drain} trace={trace} />
        </div>
      </div>
    </div>
  );
}

function StaticTour({ card, trace }: { card: StackCardModel; trace: TraceDemo | null }) {
  return (
    <div className="relative isolate overflow-hidden px-5 py-20 md:px-10 lg:py-28" data-testid="tour-static">
      <Backdrop />
      <ol className="mx-auto flex max-w-[1100px] flex-col gap-24">
        {TOUR_STAGES.map((s, i) => {
          const stage = i as TourStage;
          const local = stage === 2 ? ANSWER_AT + 0.1 : stage === 3 ? 0.45 : 0.5;
          return (
            <li key={s.id} className={cn("grid items-center gap-8 md:grid-cols-2 md:gap-16", i % 2 === 1 && "md:[&>*:first-child]:order-2")}>
              <h2 className="t-heading max-md:text-center">{s.heading}</h2>
              <TourCard card={card} stage={stage} started frame={frameAt(stage, local)} drain={motionValue(1 - local / HANDOFF_AT)} trace={trace} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
