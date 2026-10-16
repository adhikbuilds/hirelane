"use client";

import { useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
import { cn, Reveal } from "../ui";
import { ApproveMock, MatchMock, RepliesMock, UploadMock } from "./how-mockups";
import { SectionHeading } from "./section-heading";

const STEPS: { id: string; title: string; body: string; mock: ReactNode }[] = [
  {
    id: "upload",
    title: "Upload",
    body: "Drop a PDF. Hirelane reads your roles, skills and pay floor in your browser, and you fix anything it got wrong.",
    mock: <UploadMock />,
  },
  {
    id: "match",
    title: "Match",
    body: "Every new job is scored against your resume with the maths shown: which requirements you meet, which you miss, and how the pay compares.",
    mock: <MatchMock />,
  },
  {
    id: "approve",
    title: "Approve",
    body: "Each application is drafted for you. Anything it cannot answer from your resume becomes a Needs-you field. Approve, and you get four seconds to undo.",
    mock: <ApproveMock />,
  },
  {
    id: "replies",
    title: "Replies",
    body: "Replies are filed on the right application, with rejections soft-filed, so you read the ones that matter.",
    mock: <RepliesMock />,
  },
];

export function HowItWorks() {
  const reduce = useReducedMotion();
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({ target: track, offset: ["start start", "end end"] });
  useMotionValueEvent(scrollYProgress, "change", (p) => {
    const i = Math.min(STEPS.length - 1, Math.max(0, Math.floor(p * STEPS.length)));
    setActive((cur) => (cur === i ? cur : i));
  });

  const jump = (i: number) => {
    setActive(i);
    const el = track.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const span = el.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + ((i + 0.5) / STEPS.length) * span, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <section id="how-it-works" aria-labelledby="how-h" className="scroll-mt-16 bg-canvas py-16 sm:py-24" data-testid="how-it-works">
      <div className="mx-auto max-w-page px-4 sm:px-8">
        <Reveal>
          <SectionHeading eyebrow="How it works" title="From resume to a handed-off application in four steps" id="how-h">
            You stay in charge at every step. Nothing leaves Hirelane until you approve it.
          </SectionHeading>
        </Reveal>

        {/* Desktop: a sticky stepper beside a mockup that changes as the page scrolls. */}
        <div ref={track} className="relative mt-12 hidden lg:block" style={{ height: `${STEPS.length * 62}vh` }}>
          <div className="sticky top-24 grid h-[min(560px,calc(100vh-8rem))] grid-cols-[minmax(0,400px)_minmax(0,1fr)] items-center gap-16">
            <ol className="relative grid gap-2" aria-label="Steps">
              <span aria-hidden className="absolute bottom-6 left-[19px] top-6 w-0.5 rounded-full bg-line" />
              <motion.span
                aria-hidden
                className="absolute left-[19px] top-6 w-0.5 origin-top rounded-full bg-lane"
                style={{ height: "calc(100% - 48px)", scaleY: scrollYProgress }}
              />
              {STEPS.map((s, i) => {
                const on = i === active;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => jump(i)}
                      aria-current={on ? "step" : undefined}
                      data-testid={`step-${s.id}`}
                      className={cn(
                        "relative flex w-full gap-4 rounded-[14px] p-3 text-left transition-colors duration-200",
                        on ? "bg-surface shadow-card ring-1 ring-line" : "hover:bg-surface/60",
                      )}
                    >
                      <span
                        className={cn(
                          "relative z-10 grid size-10 shrink-0 place-items-center rounded-full border-2 text-[15px] font-extrabold tabular-nums transition-colors duration-200",
                          on ? "border-lane bg-lane text-white" : i < active ? "border-lane bg-lane-50 text-lane" : "border-line bg-surface text-ink-3",
                        )}
                      >
                        {i + 1}
                      </span>
                      <span className="min-w-0">
                        <span className={cn("block text-[20px] font-extrabold leading-10 tracking-tight", on ? "text-ink" : "text-ink-2")}>{s.title}</span>
                        <AnimatePresence initial={false}>
                          {on && (
                            <motion.span
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: reduce ? 0 : 0.25 }}
                              className="block overflow-hidden text-[15px] leading-[24px] text-ink-2"
                            >
                              <span className="block pb-2">{s.body}</span>
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <div className="relative" data-testid="how-panel">
              <div aria-hidden className="absolute -inset-4 rounded-[28px] bg-lane-50" />
              <div className="relative">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={STEPS[active]!.id}
                    initial={reduce ? false : { opacity: 0, y: 18, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, y: -14, scale: 0.98 }}
                    transition={{ duration: reduce ? 0 : 0.25, ease: [0.16, 1, 0.3, 1] }}
                    data-step={STEPS[active]!.id}
                  >
                    {STEPS[active]!.mock}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile and tablet: the same four steps as stacked cards. */}
        <ol className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-8 lg:hidden" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s.id} className="min-w-0">
              <Reveal>
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-full bg-lane text-[15px] font-extrabold text-white tabular-nums">{i + 1}</span>
                  <h3 className="text-[22px] font-extrabold tracking-tight">{s.title}</h3>
                </div>
                <p className="mt-2 text-[16px] leading-[25px] text-ink-2">{s.body}</p>
                <div className="mt-4 rounded-[22px] bg-lane-50 p-3">{s.mock}</div>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
