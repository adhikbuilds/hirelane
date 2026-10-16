"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { Toaster } from "@/components/shadcn/sonner";
import { Button } from "@/components/shadcn/button";
import type { StackCardModel } from "../stack/cards";
import { SwipeStack } from "../stack/swipe-stack";
import { Backdrop } from "./backdrop";
import type { RoadShot } from "./road";
import { useReduced } from "../stack/use-reduced";

export type HeroCounts = { roles: string; companies: string; updated: string | null };

/** Max parallax in px: the photo moves 12, the cards 24. */
export const PHOTO_PARALLAX = 12;
export const CARD_PARALLAX = 24;

const IDLE_SIGN = { company: "Hirelane", role: "Queue clear" };

export function Hero({ cards, shots, start, counts }: { cards: StackCardModel[]; shots: RoadShot[]; start: number; counts: HeroCounts }) {
  const reduce = useReduced();
  const ref = useRef<HTMLElement>(null);
  const [top, setTop] = useState<StackCardModel | null>(cards[0] ?? null);
  const onTop = useCallback((c: StackCardModel | null) => setTop(c), []);

  // Parallax input in [-1, 1], from the pointer or (where allowed without a prompt) device tilt.
  const nx = useMotionValue(0);
  const ny = useMotionValue(0);
  const sx = useSpring(nx, { stiffness: 120, damping: 20, mass: 0.6 });
  const sy = useSpring(ny, { stiffness: 120, damping: 20, mass: 0.6 });
  const photoX = useTransform(sx, (v) => -v * PHOTO_PARALLAX);
  const photoY = useTransform(sy, (v) => -v * PHOTO_PARALLAX * 0.5);
  const cardX = useTransform(sx, (v) => v * CARD_PARALLAX);
  const cardY = useTransform(sy, (v) => v * CARD_PARALLAX * 0.5);

  useEffect(() => {
    if (reduce) return;
    const el = ref.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.buttons !== 0) return; // hold the parallax still while a card is being dragged
      const r = el.getBoundingClientRect();
      nx.set(Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1)));
      ny.set(Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1)));
    };
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma === null || e.beta === null) return;
      nx.set(Math.max(-1, Math.min(1, e.gamma / 25)));
      ny.set(Math.max(-1, Math.min(1, (e.beta - 45) / 25)));
    };
    const needsPermission = typeof DeviceOrientationEvent !== "undefined" && "requestPermission" in DeviceOrientationEvent;
    el.addEventListener("pointermove", onMove);
    if (!needsPermission && window.matchMedia("(pointer: coarse)").matches) window.addEventListener("deviceorientation", onTilt);
    return () => {
      el.removeEventListener("pointermove", onMove);
      window.removeEventListener("deviceorientation", onTilt);
    };
  }, [reduce, nx, ny]);

  const sign = top ? { company: top.company, role: top.title } : IDLE_SIGN;

  return (
    <section ref={ref} aria-label="Swipe right. We fill it in." data-testid="hero" className="relative isolate min-h-svh overflow-hidden text-white">
      <Backdrop shots={shots} start={start} sign={sign} x={reduce ? nx : photoX} y={reduce ? ny : photoY} />

      <div className="relative mx-auto grid min-h-svh w-full max-w-[1320px] grid-cols-[minmax(0,1fr)] content-end items-end gap-8 px-5 pt-[256px] md:pt-[340px] pb-8 max-lg:gap-5 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-16 md:px-10 lg:pt-24">
        <div className="flex flex-col gap-4 lg:gap-5">
          <h1 className="t-display max-lg:text-[42px]" data-testid="hero-h1">
            Swipe right.
            <br />
            We fill it in.
          </h1>
          <p className="t-statement text-white/90 max-lg:text-[16px]" data-testid="hero-subline">
            You approve every application. 4 seconds to undo.
          </p>
          <div className="flex flex-col gap-3 lg:gap-4">
            <Button asChild size="lg" className="self-start">
              <a href="#start" data-testid="hero-start">
                Start free
              </a>
            </Button>
            <p className="t-small flex flex-wrap gap-x-2 text-[#c4cdc4]" data-testid="live-counts">
              <span>{counts.roles} live roles</span>
              <span aria-hidden>·</span>
              <span>{counts.companies} companies</span>
              {counts.updated && (
                <>
                  <span aria-hidden>·</span>
                  <span>updated {counts.updated}</span>
                </>
              )}
            </p>
          </div>
        </div>

        <motion.div style={reduce ? undefined : { x: cardX, y: cardY }} className="w-full">
          <SwipeStack cards={cards} onTopChange={onTop} />
        </motion.div>
      </div>

      <Toaster position="bottom-center" />
    </section>
  );
}
