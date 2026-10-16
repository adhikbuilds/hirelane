"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { AnimatePresence, motion, type MotionValue } from "motion/react";
import { commonSign, type RoadShot, type SignRect } from "./road";
import { useReduced } from "../stack/use-reduced";

export const FADE_S = 1.6;
export const HOLD_S = 6;

export type SignContent = { company: string; role: string };

/**
 * The full-bleed road, four photos crossfading (1.6 s fade, 6 s hold). The group is sized by CSS container units, so
 * the 3:2 photo and its sign rectangle share one box and the road.json percentages apply directly to it.
 * Parallax moves the whole group by `x` and `y` (pixels, at most 12).
 */
export function Backdrop({ shots, start, sign, x, y }: { shots: RoadShot[]; start: number; sign: SignContent; x: MotionValue<number>; y: MotionValue<number> }) {
  const reduce = useReduced();
  const [active, setActive] = useState(start);

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => {
      if (!document.hidden) setActive((a) => (a + 1) % shots.length);
    }, (FADE_S + HOLD_S) * 1000);
    return () => clearInterval(id);
  }, [reduce, shots.length]);

  return (
    <div
      aria-hidden
      className="absolute inset-0 -z-10 overflow-hidden bg-[#0f1f10] [container-type:size] [--lw:calc(max(100cqw,150svh)*var(--zoom))] [--lx:calc((100cqw-var(--lw))/2)] [--zoom:1] [--ly:calc(76px-var(--lw)*2/3*0.208)] lg:[--zoom:1.1] lg:[--ly:calc((100svh-var(--lw)*2/3)*0.72)]"
      data-testid="road-backdrop"
    >
      <motion.div className="absolute inset-0" style={{ x, y }}>
        <div
          className="absolute max-lg:[mask-image:linear-gradient(to_bottom,#000_62%,transparent_100%)]"
          style={{ left: "var(--lx)", top: "var(--ly)", width: "var(--lw)", aspectRatio: "3 / 2" }}
        >
          {shots.map((s, i) => (
            <div
              key={s.slot}
              data-slot={s.slot}
              data-active={i === active}
              className="absolute inset-0 transition-opacity ease-in-out motion-reduce:transition-none"
              style={{ opacity: i === active ? 1 : 0, transitionDuration: `${FADE_S}s` }}
            >
              <Image src={s.src} alt="" fill sizes="(min-width: 768px) 1600px, 1500px" priority={i === start} className="object-cover" />
            </div>
          ))}
        </div>

      </motion.div>

      {/* Forest scrim: where the text sits, plus a floor so the stack's shadows land on something. */}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(15_31_16/0.7)_0%,rgb(15_31_16/0.38)_42%,rgb(15_31_16/0.06)_75%)] max-lg:bg-[linear-gradient(180deg,rgb(15_31_16/0)_0%,rgb(15_31_16/0.35)_30%,rgb(15_31_16/0.82)_62%,#0f1f10_80%)]" />
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#0f1f10]/70 to-transparent" />

      {/* The sign text sits above the scrim so it stays white-on-green, and moves with the photo. */}
      <motion.div className="absolute inset-0" style={{ x, y }}>
        <SignText rect={commonSign(shots)} content={sign} />
      </motion.div>
    </div>
  );
}

/** White Overpass set on the green sign. Flips (rotateX) when the top card changes, like a panel updating. */
function SignText({ rect, content }: { rect: SignRect; content: SignContent }) {
  const reduce = useReduced();
  const { x, y, w, h } = rect;
  // The rectangle in container coordinates: the layer box (--lx, --ly, --lw) plus the sign's share of it.
  const style = {
    "--sx": `calc(var(--lx) + var(--lw) * ${x / 100})`,
    "--sw": `calc(var(--lw) * ${w / 100})`,
    top: `calc(var(--ly) + var(--lw) * 2 / 3 * ${y / 100})`,
    height: `calc(var(--lw) * 2 / 3 * ${h / 100})`,
    perspective: 900,
  } as React.CSSProperties;
  return (
    <div
      data-ui
      data-testid="road-sign"
      className="absolute left-[calc(var(--sx)+clamp(24px,3cqw,56px))] flex w-[min(calc(var(--sw)*0.62),calc(100cqw-48px))] items-center overflow-hidden text-white max-lg:left-5 max-lg:w-[calc(100cqw-40px)]"
      style={style}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${content.company}|${content.role}`}
          className="w-full min-w-0 origin-top"
          initial={reduce ? { opacity: 0 } : { rotateX: -88, opacity: 0 }}
          animate={reduce ? { opacity: 1 } : { rotateX: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { rotateX: 88, opacity: 0 }}
          transition={{ duration: reduce ? 0.15 : 0.28, ease: "easeInOut" }}
        >
          <p className="truncate text-[clamp(34px,4.3cqw,70px)] leading-[1.05] font-extrabold tracking-[-0.02em]">{content.company}</p>
          <p className="mt-[0.3em] line-clamp-2 text-[clamp(18px,2.2cqw,34px)] leading-[1.15] font-semibold text-white/90">{content.role}</p>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
