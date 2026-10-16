"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useDragControls, useIsPresent, useMotionValue, useMotionValueEvent, useTransform, type PanInfo } from "motion/react";
import { cn } from "@/lib/utils";
import { COMMIT_RATIO, flyOutVector, isMostlyVertical, restingPose, rotationFor, shouldCommit, stampOpacity, stampScale, tintOpacity, type Decision, type FlyOut } from "../../landing-v3/stack/physics";
import { useReduced } from "../../landing-v3/stack/use-reduced";
import { JobCard } from "./job-card";
import type { V4Card } from "./model";
import { useDeckKeys } from "./use-deck-keys";

const SPRING = { type: "spring", stiffness: 300, damping: 30 } as const;

/** Light-theme card shadows: a tight contact layer and a wide ambient one, cross-faded as the card lifts. */
const SHADOW_REST = "0 1px 2px rgb(19 32 26 / 0.10), 0 10px 22px -10px rgb(19 32 26 / 0.28)";
const SHADOW_LIFT = "0 2px 4px rgb(19 32 26 / 0.12), 0 28px 48px -14px rgb(19 32 26 / 0.38)";

export type DeckExit = { kind: Decision; vx: number };
type Exit = FlyOut & { reduce: boolean };

export type SwipeDeckHandle = { focus: () => void };

export type SwipeDeckProps = {
  /** Remaining cards, top first. Three are drawn. */
  cards: V4Card[];
  /** Which way the card that just left went, and how fast. */
  exit: DeckExit;
  /** A card coming back (undo): where from. */
  entry: { slug: string; from: Decision } | null;
  /** Called on a swipe, a key or a button. Return true when the card should leave now; false springs it back. */
  onRequest: (kind: Decision, card: V4Card, vx: number) => boolean;
  onUndo: () => void;
  onOpen: (card: V4Card) => void;
  /** False while a sheet is open: the deck then ignores keys and drags. */
  active?: boolean;
  label?: string;
  emptyState?: React.ReactNode;
  className?: string;
  testId?: string;
};

type CardProps = {
  card: V4Card;
  depth: number;
  getWidth: () => number;
  exit: Exit;
  enterFrom: Decision | null;
  reduce: boolean;
  dragOn: boolean;
  onCommit: (kind: Decision, vx: number) => boolean;
  onOpen: () => void;
};

function DeckCard({ card, depth, getWidth, exit, enterFrom, reduce, dragOn, onCommit, onOpen }: CardProps) {
  const isTop = depth === 0;
  const present = useIsPresent();
  const presentRef = useRef(true);
  presentRef.current = present;
  const x = useMotionValue(enterFrom && !reduce ? (enterFrom === "approve" ? 1 : -1) * getWidth() * 1.3 : 0);
  const rot = useMotionValue(0);
  const lift = useMotionValue(0);
  const controls = useDragControls();
  const [dragging, setDragging] = useState(false);
  const suppressClick = useRef(false);
  const crossed = useRef(false);

  useMotionValueEvent(x, "change", (v) => {
    if (!presentRef.current) return;
    rot.set(reduce ? 0 : rotationFor(v, getWidth()));
    const past = Math.abs(v) >= getWidth() * COMMIT_RATIO;
    if (past && !crossed.current && !reduce && typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(10);
    crossed.current = past;
  });
  useEffect(() => {
    if (enterFrom && !reduce) animate(x, 0, SPRING);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const approveStamp = useTransform(x, (v) => stampOpacity(v, getWidth(), "approve"));
  const passStamp = useTransform(x, (v) => stampOpacity(v, getWidth(), "pass"));
  const approveScale = useTransform(x, (v) => (v > 0 ? stampScale(v, getWidth()) : 0.8));
  const passScale = useTransform(x, (v) => (v < 0 ? stampScale(v, getWidth()) : 0.8));
  const approveTint = useTransform(x, (v) => (v > 0 ? tintOpacity(v, getWidth()) * 0.35 : 0));
  const passTint = useTransform(x, (v) => (v < 0 ? tintOpacity(v, getWidth()) * 0.3 : 0));
  const restShadow = useTransform(lift, (l) => 1 - l);

  const pose = restingPose(depth);
  const initialPose = useRef<false | { scale: number; y: number; opacity: number }>(
    enterFrom ? { ...pose, opacity: reduce ? 0 : 1 } : depth >= 2 ? { ...pose, opacity: 0, y: pose.y + 24 } : false,
  );
  const canDrag = isTop && dragOn && !reduce;

  const onDragEnd = (_: unknown, info: PanInfo) => {
    setDragging(false);
    animate(lift, 0, { duration: 0.2 });
    window.setTimeout(() => (suppressClick.current = false), 0);
    const kind = isMostlyVertical(info.offset.x, info.offset.y) ? null : shouldCommit(info.offset.x, info.velocity.x, getWidth());
    if (kind && onCommit(kind, info.velocity.x)) return;
    animate(x, 0, SPRING);
  };

  return (
    <motion.li
      data-testid={!present ? "exiting-card" : isTop ? "top-card" : "behind-card"}
      data-slug={card.slug}
      data-depth={depth}
      aria-hidden={isTop ? undefined : true}
      inert={!isTop}
      className="relative col-start-1 row-start-1 list-none"
      style={{ x, rotate: rot, zIndex: 10 - depth, transformOrigin: "50% 140%", touchAction: "pan-y", cursor: canDrag ? (dragging ? "grabbing" : "grab") : undefined }}
      initial={initialPose.current}
      animate={reduce ? { ...pose, y: 0, scale: 1, opacity: isTop ? 1 : 0 } : pose}
      transition={reduce ? { duration: 0.2 } : SPRING}
      custom={exit}
      variants={{
        leave: (c: Exit) => ({
          opacity: 0,
          ...(c.reduce ? {} : { x: c.x, y: c.y, rotate: c.rotate }),
          transition: c.reduce
            ? { duration: 0.2 }
            : { x: { duration: c.duration, ease: [0.4, 0, 0.9, 0.6] }, y: { duration: c.duration }, rotate: { duration: c.duration }, opacity: { duration: c.duration * 0.7, delay: c.duration * 0.3 } },
        }),
      }}
      exit="leave"
      drag={canDrag ? "x" : false}
      dragListener={false}
      dragControls={controls}
      dragMomentum={false}
      dragElastic={1}
      onPointerDown={(e) => {
        if (!canDrag || e.button !== 0) return;
        if ((e.target as HTMLElement).closest("button,input,a,textarea,select,[data-nodrag]")) return;
        crossed.current = false;
        controls.start(e);
      }}
      onDragStart={() => {
        setDragging(true);
        suppressClick.current = true;
        animate(lift, 1, { duration: 0.15 });
      }}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        if (!isTop || suppressClick.current || !dragOn) return;
        if ((e.target as HTMLElement).closest("button,input,a,textarea,select,[data-nodrag]")) return;
        onOpen();
      }}
    >
      <motion.div aria-hidden className="pointer-events-none absolute inset-0 rounded-[20px]" style={{ boxShadow: SHADOW_REST, opacity: restShadow }} />
      <motion.div aria-hidden className="pointer-events-none absolute inset-0 rounded-[20px]" style={{ boxShadow: SHADOW_LIFT, opacity: lift }} />
      {isTop ? (
        <div className="relative">
          <JobCard card={card} />
          <motion.div aria-hidden className="pointer-events-none absolute inset-0 rounded-[20px] bg-[#0F5C45]" style={{ opacity: approveTint }} />
          <motion.div aria-hidden className="pointer-events-none absolute inset-0 rounded-[20px] bg-[#13201A]" style={{ opacity: passTint }} />
          <motion.div
            aria-hidden
            data-testid="stamp-approve"
            className="pointer-events-none absolute top-12 left-4 -rotate-12 rounded-xl border-[3px] border-[#0F5C45] bg-white/90 px-3 py-1 text-[24px] leading-none font-extrabold tracking-[0.04em] text-[#0F5C45]"
            style={{ opacity: approveStamp, scale: approveScale }}
          >
            APPROVE
          </motion.div>
          <motion.div
            aria-hidden
            data-testid="stamp-pass"
            className="pointer-events-none absolute top-12 right-4 rotate-12 rounded-xl border-[3px] border-[#E5484D] bg-white/90 px-3 py-1 text-[24px] leading-none font-extrabold tracking-[0.04em] text-[#E5484D]"
            style={{ opacity: passStamp, scale: passScale }}
          >
            PASS
          </motion.div>
        </div>
      ) : (
        // Behind the top card only the edge shows, so a plain white card with a hairline is all it needs.
        <div className="h-full min-h-[120px] rounded-[20px] bg-white ring-1 ring-[#13201A]/5" />
      )}
    </motion.li>
  );
}

/**
 * The v4 swipe deck: v3's physics (drag, commit by distance or flick, spring back, fly-out, rotation, stamps) on the
 * light v4 card. It is controlled: the parent owns the queue, so approve can open a "Ready to send" sheet first.
 */
export const SwipeDeck = forwardRef<SwipeDeckHandle, SwipeDeckProps>(function SwipeDeck(
  { cards, exit, entry, onRequest, onUndo, onOpen, active = true, label = "Jobs waiting for your decision", emptyState, className, testId = "deck" },
  ref,
) {
  const reduce = useReduced();
  const rootRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLUListElement>(null);
  const widthRef = useRef(320);
  const top = cards[0] ?? null;
  const topRef = useRef(top);
  topRef.current = top;

  useImperativeHandle(ref, () => ({ focus: () => rootRef.current?.focus({ preventScroll: true }) }), []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => (widthRef.current = el.getBoundingClientRect().width || 320);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [top === null]);

  const request = useCallback(
    (kind: Decision, vx = 0): boolean => {
      const c = topRef.current;
      if (!c || !active) return false;
      return onRequest(kind, c, vx);
    },
    [active, onRequest],
  );

  useDeckKeys(rootRef, active && top !== null, {
    approve: () => request("approve"),
    pass: () => request("pass"),
    undo: onUndo,
    open: () => topRef.current && onOpen(topRef.current),
  });

  const flyOut = useMemo<Exit>(() => ({ ...flyOutVector(exit.kind, exit.vx, widthRef.current), reduce }), [exit, reduce]);
  const visible = cards.slice(0, 3);

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      role="group"
      aria-roledescription="card stack"
      aria-label={`${label}. Arrow right or A approves, arrow left or P passes, U undoes, Space opens details.`}
      data-testid={testId}
      data-current-slug={top?.slug ?? ""}
      data-count={cards.length}
      className={cn("relative rounded-[24px] outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0F5C45]", className)}
    >
      {top === null ? (
        emptyState
      ) : (
        <ul ref={boxRef} className="relative m-0 grid w-full grid-cols-[minmax(0,1fr)] list-none p-0 pb-4" style={{ perspective: 1200 }}>
          <AnimatePresence custom={flyOut}>
            {visible
              .map((card, depth) => ({ card, depth }))
              .reverse()
              .map(({ card, depth }) => (
                <DeckCard
                  key={card.slug}
                  card={card}
                  depth={depth}
                  getWidth={() => widthRef.current}
                  exit={flyOut}
                  enterFrom={entry?.slug === card.slug ? entry.from : null}
                  reduce={reduce}
                  dragOn={active}
                  onCommit={request}
                  onOpen={() => onOpen(card)}
                />
              ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
});
