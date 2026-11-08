"use client";

import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useDragControls,
  useIsPresent,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
  type MotionValue,
  type PanInfo,
} from "motion/react";
import { Check, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/shadcn/sheet";
import { cn } from "@/lib/utils";
import { CardDetails } from "./card-details";
import { CARD_HEIGHT, CardFace, PANEL_SURFACE, type NeedsProps } from "./card-face";
import type { StackCardModel } from "./cards";
import {
  COMMIT_RATIO,
  dragProgress,
  flyOutVector,
  isMostlyVertical,
  restingPose,
  rotationFor,
  shadowFor,
  shouldCommit,
  stampOpacity,
  stampScale,
  tintOpacity,
  type Decision,
  type FlyOut,
} from "./physics";
import { announce, endLine, initialQueue, isDone, reduceQueue, undoLabel } from "./queue";
import { useReduced } from "./use-reduced";

export const UNDO_MS = 4000;
const HINT_KEY = "hirelane:swipe-hint";
const SPRING = { type: "spring", stiffness: 300, damping: 30 } as const;

/** Keystrokes aimed at a text field, slider or menu belong to that control, never to the stack. */
function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !("tagName" in el)) return false;
  if (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return true;
  const role = el.getAttribute("role");
  return role === "slider" || role === "combobox" || role === "radio" || role === "textbox" || role === "switch";
}

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

function useInView(ref: React.RefObject<Element | null>, threshold: number): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => setInView(entries.some((e) => e.isIntersecting)), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, threshold]);
  return inView;
}

type Exit = FlyOut & { reduce: boolean };

type CardProps = {
  card: StackCardModel;
  depth: number;
  getWidth: () => number;
  exit: Exit;
  enterFrom: Decision | null;
  reduce: boolean;
  nudgeKey: number;
  needs: NeedsProps;
  needsRef: React.Ref<HTMLInputElement>;
  onCommit: (kind: Decision, vx: number) => boolean;
  onOpen: () => void;
  /** 0 at rest, 1 when the top card is at the commit threshold: cards behind lean forward as it goes. */
  progress: MotionValue<number>;
};

function StackCard({ card, depth, getWidth, exit, enterFrom, reduce, nudgeKey, needs, needsRef, onCommit, onOpen, progress }: CardProps) {
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
    if (isTop) progress.set(dragProgress(v, getWidth()));
    rot.set(reduce ? 0 : rotationFor(v, getWidth()));
    const past = Math.abs(v) >= getWidth() * COMMIT_RATIO;
    if (past && !crossed.current && !reduce && typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(10);
    crossed.current = past;
  });

  useEffect(() => {
    if (enterFrom && !reduce) animate(x, 0, SPRING);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isTop || nudgeKey === 0 || reduce) return;
    const c = animate(x, [0, 24, -24, 0], { duration: 1.6, ease: "easeInOut" });
    return () => c.stop();
  }, [nudgeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const approveStamp = useTransform(x, (v) => stampOpacity(v, getWidth(), "approve"));
  const passStamp = useTransform(x, (v) => stampOpacity(v, getWidth(), "pass"));
  const approveScale = useTransform(x, (v) => (v > 0 ? stampScale(v, getWidth()) : 0.8));
  const passScale = useTransform(x, (v) => (v < 0 ? stampScale(v, getWidth()) : 0.8));
  const approveTint = useTransform(x, (v) => (v > 0 ? tintOpacity(v, getWidth()) : 0));
  const passTint = useTransform(x, (v) => (v < 0 ? tintOpacity(v, getWidth()) : 0));
  const liftShadow = lift;
  const restShadow = useTransform(lift, (l) => 1 - l);

  const pose = restingPose(depth);
  // Read once at mount: motion treats `initial` as mount-only, and a prop that changes later must not be mistaken for an update.
  const initialPose = useRef<false | { scale: number; y: number; opacity: number }>(
    enterFrom ? { ...pose, opacity: reduce ? 0 : 1 } : depth >= 2 ? { ...pose, opacity: 0, y: pose.y + 24 } : false,
  );
  const dragOn = isTop && !reduce;
  const boost = useTransform(progress, [0, 1], [1, depth === 1 ? 1.045 : 1.02]);
  const boostY = useTransform(progress, [0, 1], [0, depth === 1 ? -6 : -3]);

  const springBack = () => animate(x, 0, SPRING);
  const onDragEnd = (_: unknown, info: PanInfo) => {
    setDragging(false);
    animate(lift, 0, { duration: 0.2 });
    window.setTimeout(() => (suppressClick.current = false), 0);
    const kind = isMostlyVertical(info.offset.x, info.offset.y) ? null : shouldCommit(info.offset.x, info.velocity.x, getWidth());
    if (kind && onCommit(kind, info.velocity.x)) return;
    springBack();
  };

  return (
    <motion.li
      data-testid={!present ? "exiting-card" : isTop ? "top-card" : "behind-card"}
      data-slug={card.slug}
      data-depth={depth}
      data-needs={card.needs ? "true" : "false"}
      aria-hidden={isTop ? undefined : true}
      inert={!isTop}
      className="relative col-start-1 row-start-1 list-none"
      style={{
        x,
        rotate: rot,
        zIndex: 10 - depth,
        transformOrigin: "50% 140%",
        touchAction: "pan-y",
        willChange: dragging ? "transform" : undefined,
        cursor: dragOn ? (dragging ? "grabbing" : "grab") : undefined,
      }}
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
      drag={dragOn ? "x" : false}
      dragListener={false}
      dragControls={controls}
      dragMomentum={false}
      dragElastic={1}
      onPointerDown={(e) => {
        if (!dragOn || e.button !== 0) return;
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
        if (!isTop || suppressClick.current) return;
        if ((e.target as HTMLElement).closest("button,input,a,textarea,select,[data-nodrag]")) return;
        onOpen();
      }}
    >
      {/* Two shadow layers that cross-fade as the card is lifted: tight contact + wide ambient. Opacity only. */}
      <motion.div aria-hidden className="pointer-events-none absolute inset-0 rounded-[28px]" style={{ boxShadow: shadowFor(0), opacity: restShadow }} />
      <motion.div aria-hidden className="pointer-events-none absolute inset-0 rounded-[28px]" style={{ boxShadow: shadowFor(1), opacity: liftShadow }} />

      <div className={cn(PANEL_SURFACE, CARD_HEIGHT, isTop ? "bg-[rgb(15_31_16/0.66)]" : "bg-[rgb(15_31_16/0.93)]")}>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-white/[0.07] to-transparent" />

        {depth <= 1 && (
          <motion.div
            style={isTop ? undefined : { scale: boost, y: boostY, transformOrigin: "50% 100%" }}
            animate={{ opacity: isTop ? 1 : 0.45 }}
            transition={{ duration: 0.25 }}
            className="h-full"
          >
            <CardFace card={card} needs={needs} needsRef={isTop ? needsRef : undefined} onDetails={isTop ? onOpen : undefined} tabIndex={isTop ? 0 : -1} />
          </motion.div>
        )}

        {/* Behind the top card: dimmed, with a label bar so the strip that shows reads as "next: company, role". */}
        {!isTop && (
          <>
            <div aria-hidden className="absolute inset-0 bg-black/20" />
            <div aria-hidden className="absolute inset-x-0 bottom-0 h-9 bg-gradient-to-t from-[#0f1f10] via-[#0f1f10]/85 to-transparent" />
            <div className="absolute inset-x-5 bottom-1 flex items-center gap-2 text-[13px] leading-6 font-bold text-white">
              <span className="truncate">{card.company}</span>
              <span aria-hidden className="text-white/40">
                ·
              </span>
              <span className="truncate font-semibold text-[#c3cbc3]">{card.title}</span>
            </div>
          </>
        )}

        <motion.div aria-hidden className="pointer-events-none absolute inset-0 bg-[#0F5C45]" style={{ opacity: approveTint }} />
        <motion.div aria-hidden className="pointer-events-none absolute inset-0 bg-[#050805]" style={{ opacity: passTint }} />
        <motion.div
          aria-hidden
          data-testid="stamp-approve"
          className="pointer-events-none absolute top-8 left-5 -rotate-12 rounded-xl border-[3px] border-[#c6f19d] px-3 py-1 text-[28px] leading-none font-extrabold tracking-[0.04em] text-[#c6f19d]"
          style={{ opacity: approveStamp, scale: approveScale }}
        >
          APPROVE
        </motion.div>
        <motion.div
          aria-hidden
          data-testid="stamp-pass"
          className="pointer-events-none absolute top-8 right-5 rotate-12 rounded-xl border-[3px] border-[#ff6b5e] px-3 py-1 text-[28px] leading-none font-extrabold tracking-[0.04em] text-[#ff6b5e]"
          style={{ opacity: passStamp, scale: passScale }}
        >
          PASS
        </motion.div>
      </div>
    </motion.li>
  );
}

export type SwipeStackProps = {
  cards: StackCardModel[];
  /** Called with the card now on top (null when the queue is done), so the road sign can follow. */
  onTopChange?: (card: StackCardModel | null) => void;
  /** Where "Start with your resume" goes. */
  startHref?: string;
  className?: string;
};

export function SwipeStack({ cards, onTopChange, startHref = "#start", className }: SwipeStackProps) {
  const reduce = useReduced();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const slugs = useMemo(() => cards.map((c) => c.slug), [cards]);
  const [state, dispatch] = useReducer((s: ReturnType<typeof initialQueue>, a: Parameters<typeof reduceQueue>[1]) => reduceQueue(s, a, slugs), cards.length, initialQueue);
  const stateRef = useRef(state);
  stateRef.current = state;

  const rootRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLUListElement>(null);
  const widthRef = useRef(420);
  const needsRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const uid = useId();
  const inView = useInView(rootRef, 0.2);

  const progress = useMotionValue(0);
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState("");
  const [exit, setExit] = useState<Exit>({ ...flyOutVector("approve", 0, 420), reduce });
  const [entry, setEntry] = useState<{ slug: string; from: Decision } | null>(null);
  const [nudge, setNudge] = useState(0);
  const [hint, setHint] = useState(false);
  const [left, setLeft] = useState(UNDO_MS);

  const top = cards[state.index] ?? null;
  const done = isDone(state);

  useEffect(() => onTopChange?.(top), [top, onTopChange]);

  // Measure the card width once and on resize; the physics need it.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => (widthRef.current = el.getBoundingClientRect().width || 420);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((id) => clearTimeout(id));
  }, []);

  // First-visit nudge: once, when the stack scrolls into view.
  useEffect(() => {
    if (!inView || reduce || nudge !== 0) return;
    let seen = false;
    try {
      seen = localStorage.getItem(HINT_KEY) === "1";
    } catch {}
    if (seen) return;
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {}
    setHint(true);
    setNudge(1);
    const t = setTimeout(() => setHint(false), 9000);
    return () => clearTimeout(t);
  }, [inView, reduce, nudge]);

  // Undo countdown text. The bar itself drains with a transform animation.
  const undoId = state.undoable?.id ?? 0;
  useEffect(() => {
    if (!undoId) return;
    setLeft(UNDO_MS);
    const t0 = performance.now();
    const iv = setInterval(() => setLeft(Math.max(0, UNDO_MS - (performance.now() - t0))), 100);
    return () => clearInterval(iv);
  }, [undoId]);

  /** When focus sits on something that is about to leave with the card, park it on the stack so keys keep working. */
  const keepFocus = useCallback(() => {
    const root = rootRef.current;
    if (root && document.activeElement && document.activeElement !== root && root.contains(document.activeElement)) root.focus({ preventScroll: true });
  }, []);

  const decide = useCallback(
    (kind: Decision, vx = 0): boolean => {
      const s = stateRef.current;
      const card = cards[s.index];
      if (!card) return false;
      if (kind === "approve" && card.needs && !s.answers[card.slug]) {
        dispatch({ type: "decide", kind, needsAnswer: true });
        setOpen(false);
        setLive("Answer the Needs-you field first. Hirelane never guesses.");
        return false;
      }
      const id = s.nextId;
      setExit({ ...flyOutVector(kind, vx, widthRef.current), reduce });
      progress.set(0);
      setEntry(null);
      setHint(false);
      dispatch({ type: "decide", kind, needsAnswer: !!card.needs });
      setOpen(false);
      keepFocus();
      setLive(announce(kind, card.title, card.company));
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          dispatch({ type: "expire", id });
          if (kind === "approve") toast(`Handed off to ${card.company}'s site`);
        }, UNDO_MS),
      );
      return true;
    },
    [cards, reduce, progress, keepFocus],
  );

  const undo = useCallback(() => {
    const u = stateRef.current.undoable;
    if (!u) return;
    const t = timers.current.get(u.id);
    if (t) clearTimeout(t);
    timers.current.delete(u.id);
    setEntry({ slug: u.slug, from: u.kind });
    dispatch({ type: "undo" });
    const c = cards[u.index];
    setLive(c ? `Undone. Back to ${c.title} at ${c.company}.` : "Undone.");
  }, [cards]);

  // Gate: when an approve is refused, shake is replayed by the nonce; here we move focus to the field.
  const gateNonce = state.gate?.nonce ?? 0;
  useEffect(() => {
    if (gateNonce > 0) needsRef.current?.focus();
  }, [gateNonce]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || done) return;
      const k = e.key;
      const within = rootRef.current?.contains(e.target as Node) ?? false;
      const global = inView && !open;
      const lower = k.toLowerCase();
      if (k === " " || k === "Enter") {
        // Space and Enter open details only while focus is on the stack itself; elsewhere Space scrolls the page.
        const el = e.target as HTMLElement;
        if (!within || el.closest("button,a,input") || e.repeat) return;
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (e.repeat || !(global || within)) return;
      if (lower === "a" || k === "ArrowRight") {
        e.preventDefault();
        decide("approve");
      } else if (lower === "p" || k === "ArrowLeft") {
        e.preventDefault();
        decide("pass");
      } else if (lower === "u") {
        e.preventDefault();
        undo();
      }
    };
    const onKeyUndoOnly = (e: KeyboardEvent) => {
      // Undo must also work when the stack is out of view but its undo bar is still open.
      if (e.key.toLowerCase() === "u" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target) && !inView) undo();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onKeyUndoOnly);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onKeyUndoOnly);
    };
  }, [decide, undo, inView, open, done]);

  const needsOf = (card: StackCardModel, isTop: boolean): NeedsProps => ({
    value: state.answers[card.slug] ?? "",
    onChange: (v) => dispatch({ type: "answer", slug: card.slug, value: v }),
    invalid: isTop && !!state.gate && state.gate.slug === card.slug,
    shakeKey: isTop ? (state.gate?.nonce ?? 0) : 0,
    inputId: `${uid}-needs-${isTop ? "top" : card.slug}`,
  });

  const visible = cards.slice(state.index, state.index + 3);
  const u = state.undoable;
  const uCard = u ? cards[u.index] : null;
  const secs = left / 1000;

  const openDetails = useCallback(() => setOpen(true), []);
  const closeDetails = useCallback(() => {
    setOpen(false);
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className={cn("relative mx-auto flex w-full max-w-[420px] flex-col items-stretch", className)} data-ui data-testid="swipe-stack">
      <div
        ref={rootRef}
        tabIndex={0}
        role="group"
        aria-roledescription="card stack"
        aria-label="Jobs waiting for your decision. Arrow right or A approves, arrow left or P passes, U undoes, Space opens details."
        data-testid="demo"
        data-current-slug={top?.slug ?? ""}
        data-done={done}
        className="relative rounded-[32px] pb-[52px] outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#c6f19d]"
      >
        {done ? (
          <div data-testid="end-of-queue" className="grid h-[448px] place-content-center gap-5 rounded-[28px] bg-[rgb(15_31_16/0.62)] p-8 text-center text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.1),0_30px_80px_rgb(0_0_0/0.45)] backdrop-blur-[20px]">
            <p className="text-[22px] leading-tight font-extrabold tracking-[-0.02em]">{endLine(state)}</p>
            <div className="flex flex-col items-center gap-2">
              <a
                href={startHref}
                className="inline-flex h-12 items-center justify-center rounded-2xl bg-[#c6f19d] px-6 text-[16px] font-extrabold text-[#0f1f10] hover:bg-[#d4f6b3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                Start with your resume
              </a>
              <button
                type="button"
                onClick={() => {
                  setEntry(null);
                  dispatch({ type: "restart" });
                }}
                className="inline-flex h-11 items-center gap-1.5 rounded-xl px-3 text-[14px] font-bold text-[#a3ada3] hover:text-white focus-visible:outline-2 focus-visible:outline-[#c6f19d]"
              >
                <RotateCcw aria-hidden className="size-4" />
                Start over
              </button>
            </div>
          </div>
        ) : (
          <ul ref={boxRef} className="relative m-0 grid w-full grid-cols-[minmax(0,1fr)] list-none p-0" style={{ perspective: 1200 }}>
            <AnimatePresence custom={exit}>
              {visible
                .map((card, depth) => ({ card, depth }))
                .reverse()
                .map(({ card, depth }) => (
                  <StackCard
                    key={card.slug}
                    card={card}
                    depth={depth}
                    getWidth={() => widthRef.current}
                    exit={exit}
                    enterFrom={entry?.slug === card.slug ? entry.from : null}
                    reduce={reduce}
                    nudgeKey={nudge}
                    needs={needsOf(card, depth === 0)}
                    progress={progress}
                    needsRef={needsRef}
                    onCommit={decide}
                    onOpen={openDetails}
                  />
                ))}
            </AnimatePresence>
          </ul>
        )}

        {/* Details: an expanding panel on desktop, a bottom sheet on phones. */}
        <AnimatePresence>
          {open && top && isDesktop && (
            <motion.div
              role="dialog"
              aria-label={`Details: ${top.title} at ${top.company}`}
              data-testid="details-panel"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
              transition={reduce ? { duration: 0.15 } : SPRING}
              onKeyDown={(e) => e.key === "Escape" && closeDetails()}
              ref={(el) => el?.querySelector<HTMLElement>("h2, h3")?.focus({ preventScroll: true })}
              className="absolute inset-x-0 bottom-[52px] z-30 flex h-[560px] flex-col rounded-[28px] bg-[rgb(10_22_11/0.9)] p-5 shadow-[inset_0_1px_0_rgb(255_255_255/0.1),0_30px_80px_rgb(0_0_0/0.5)] backdrop-blur-[24px]"
              style={{ transformOrigin: "50% 100%" }}
            >
              <CardDetails card={top} onApprove={() => decide("approve")} onPass={() => decide("pass")} onClose={closeDetails} headingRef={headingRef} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {!isDesktop && (
        <Sheet open={open && !!top} onOpenChange={(v) => (v ? setOpen(true) : closeDetails())}>
          <SheetContent side="bottom" className="max-h-[88svh] rounded-t-3xl border-0 bg-[#0c190d] p-5 pb-8 text-white" data-ui>
            {top && (
              <>
                <SheetHeader className="p-0 pr-10">
                  <p className="text-[13px] leading-5 font-semibold text-[#a3ada3]">{top.company}</p>
                  <SheetTitle className="text-[20px] leading-tight font-extrabold tracking-[-0.02em]">{top.title}</SheetTitle>
                  <SheetDescription className="sr-only">Every requirement with its evidence, and the pay trace.</SheetDescription>
                </SheetHeader>
                <CardDetails card={top} inSheet onApprove={() => decide("approve")} onPass={() => decide("pass")} />
              </>
            )}
          </SheetContent>
        </Sheet>
      )}

      {/* Under-stack: undo bar, buttons, hint. */}
      <div className="-mt-6 flex flex-col items-center gap-3">
        <div className="flex h-12 w-full items-center" aria-live="off">
          <AnimatePresence mode="wait">
            {u && uCard && (
              <motion.div
                key={u.id}
                data-testid="undo-bar"
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className={cn(
                  "relative flex h-12 w-full items-center justify-between overflow-hidden rounded-2xl px-4 text-[14px] font-bold",
                  u.kind === "approve" ? "bg-[#FACC15] text-[#1b1500]" : "bg-white/12 text-white backdrop-blur-xl",
                )}
              >
                <span>{u.kind === "approve" ? undoLabel("approve", uCard.company, secs) : "Passed"}</span>
                <button
                  type="button"
                  onClick={undo}
                  className={cn(
                    "inline-flex h-11 items-center gap-2 rounded-xl px-3 font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2",
                    u.kind === "approve" ? "hover:bg-black/10 focus-visible:outline-[#1b1500]" : "hover:bg-white/10 focus-visible:outline-[#c6f19d]",
                  )}
                >
                  Undo
                  <kbd className="hidden rounded bg-black/15 px-1.5 text-[12px] leading-5 sm:inline-block">U</kbd>
                </button>
                {!reduce && (
                  <motion.span
                    aria-hidden
                    className={cn("absolute inset-x-0 bottom-0 h-1 origin-left", u.kind === "approve" ? "bg-[#1b1500]/40" : "bg-white/30")}
                    initial={{ scaleX: 1 }}
                    animate={{ scaleX: 0 }}
                    transition={{ duration: UNDO_MS / 1000, ease: "linear" }}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-center gap-6">
          <RoundButton label="Pass" hint="←" disabled={done} onClick={() => decide("pass")} tone="pass">
            <X aria-hidden className="size-6" strokeWidth={3} />
          </RoundButton>
          <RoundButton label="Approve" hint="→" disabled={done} onClick={() => decide("approve")} tone="approve">
            <Check aria-hidden className="size-6" strokeWidth={3} />
          </RoundButton>
        </div>

        <p className="min-h-5 text-center text-[13px] leading-5 text-[#a3ada3]" data-testid="stack-caption">
          {hint ? "Swipe right to approve, left to pass. Or use A and P." : "Demo: nothing is sent."}
        </p>
      </div>

      <div role="status" aria-live="polite" data-testid="live-region" className="sr-only">
        {live}
      </div>
    </div>
  );
}

function RoundButton({
  label,
  hint,
  tone,
  children,
  ...rest
}: { label: string; hint: string; tone: "pass" | "approve"; children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        aria-label={label}
        {...rest}
        className={cn(
          "grid size-14 place-items-center rounded-full backdrop-blur-xl transition-transform duration-150 hover:scale-105 active:scale-95 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-white",
          tone === "approve" ? "bg-[#c6f19d] text-[#0f1f10] shadow-[0_10px_30px_rgb(0_0_0/0.35)]" : "bg-[rgb(15_31_16/0.62)] text-[#ff6b5e] shadow-[inset_0_0_0_1.5px_rgb(255_107_94/0.7),0_10px_30px_rgb(0_0_0/0.35)]",
        )}
      >
        {children}
      </button>
      <kbd aria-hidden className="hidden text-[12px] leading-4 font-bold text-[#a3ada3] sm:block">
        {hint}
      </kbd>
    </div>
  );
}
