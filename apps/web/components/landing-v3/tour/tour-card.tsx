"use client";

import { AnimatePresence, motion, type MotionValue } from "motion/react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MiniPayTrace } from "../stack/card-details";
import { CARD_HEIGHT, CardFace, PANEL_SURFACE } from "../stack/card-face";
import type { StackCardModel } from "../stack/cards";
import { shadowFor } from "../stack/physics";
import { litWindow, type TourFrame, type TourStage } from "./stages";
import type { TraceDemo } from "../../landing/types";
import { useReduced } from "../stack/use-reduced";

const noop = () => {};

/**
 * The card as the tour shows it: the same face and surface as the live stack, held still while the stage changes
 * what is on it. `drain` is the undo bar's remaining share (1 to 0) as a motion value so scrubbing is transform-only.
 */
export function TourCard({
  card,
  stage,
  started,
  frame,
  drain,
  trace = null,
}: {
  card: StackCardModel;
  stage: TourStage;
  started: boolean;
  frame: TourFrame;
  drain: MotionValue<number>;
  /** A real posting's pay trace, from the database. Its verified span is lit; without one the sheet shows the figures only. */
  trace?: TraceDemo | null;
}) {
  const reduce = useReduced();
  const lit = litWindow(trace);
  const answer = frame.answered ? (card.needs?.answers[1] ?? card.needs?.answers[0] ?? "") : "";
  const spring = reduce ? { duration: 0.15 } : { type: "spring" as const, stiffness: 300, damping: 30 };

  return (
    <div data-ui data-testid="tour-card" data-stage={stage} className="relative mx-auto w-full max-w-[420px] pb-[76px]">
      <div className="relative">
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[28px]" style={{ boxShadow: shadowFor(0.5) }} />
        <div className={cn(PANEL_SURFACE, CARD_HEIGHT)}>
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-white/[0.07] to-transparent" />
          <CardFace
            card={card}
            chipsOpen={started}
            needs={{ value: answer, onChange: noop, invalid: false, shakeKey: 0, pulse: stage === 2 && !frame.answered, inputId: `tour-needs-${stage}` }}
            tabIndex={-1}
            focus={stage === 0 ? "maths" : stage === 2 ? "needs" : null}
          />

          {/* Stage 2: the details sheet slides up with the pay words lit. */}
          <AnimatePresence>
            {stage === 1 && (
              <motion.div
                key="sheet"
                data-testid="tour-sheet"
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={spring}
                className="absolute inset-x-0 bottom-0 z-10 flex h-[78%] flex-col gap-3 rounded-t-[28px] bg-[#0c190d] p-5 shadow-[0_-18px_40px_rgb(0_0_0/0.4)]"
              >
                <span aria-hidden className="mx-auto h-1 w-10 rounded-full bg-white/25" />
                <p className="text-[13px] leading-5 font-bold text-[#a3ada3]">{lit ? `Pay, as ${lit.source} states it` : "Pay trace"}</p>
                {lit ? (
                  <p data-testid="tour-trace" className="rounded-2xl bg-black/25 p-3 text-[14px] leading-6 text-white/85">
                    {lit.before}
                    <mark className="rounded bg-[#FACC15] px-1 py-0.5 font-bold text-[#1b1500]">{lit.lit}</mark>
                    {lit.after}
                  </p>
                ) : (
                  <MiniPayTrace card={card} lit />
                )}
                <ul className="mt-1 flex flex-col divide-y divide-white/8">
                  {card.match.chips.slice(0, 3).map((c) => (
                    <li key={c.label} className="flex items-center gap-2.5 py-2 text-[14px] leading-5 font-bold">
                      <span className={cn("grid size-5 place-items-center rounded-full", c.met ? "bg-[#c6f19d] text-[#0f1f10]" : "bg-white/12 text-[#a3ada3]")}>
                        {c.met ? <Check aria-hidden className="size-3.5" strokeWidth={3.5} /> : <X aria-hidden className="size-3.5" strokeWidth={3.5} />}
                      </span>
                      {c.label}
                    </li>
                  ))}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Stage 4: the undo bar drains, then the hand-off. */}
      <div className="absolute inset-x-0 bottom-0 h-14">
        <AnimatePresence mode="wait" initial={false}>
          {stage === 3 && !frame.handed && (
            <motion.div
              key="bar"
              data-testid="tour-undo"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="relative flex h-12 items-center justify-between overflow-hidden rounded-2xl bg-[#FACC15] px-4 text-[14px] font-bold text-[#1b1500]"
            >
              <span>
                Sending to {card.company} in {frame.secondsLeft.toFixed(1)}s
              </span>
              <span className="rounded-xl px-3 py-2 font-extrabold">Undo</span>
              <motion.span aria-hidden className="absolute inset-x-0 bottom-0 h-1 origin-left bg-[#1b1500]/40" style={{ scaleX: drain }} />
            </motion.div>
          )}
          {stage === 3 && frame.handed && (
            <motion.div
              key="done"
              data-testid="tour-handed"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="flex h-12 items-center gap-2 rounded-2xl bg-[#162a17] px-4 text-[14px] font-bold text-white shadow-[0_10px_30px_rgb(0_0_0/0.4)]"
            >
              <Check aria-hidden className="size-4 text-[#c6f19d]" strokeWidth={3} />
              Handed off to {card.company}&apos;s site
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
