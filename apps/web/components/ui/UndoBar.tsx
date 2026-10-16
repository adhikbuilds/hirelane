"use client";

import { useEffect, useRef, useState } from "react";
import { Undo2 } from "lucide-react";
import { cn } from "./cn";

export const UNDO_MS = 4000;

export type UndoBarProps = {
  /** Plain-language action in progress, for example "Sending to Razorpay". */
  label: string;
  durationMs?: number;
  /** Called once if the person undoes (button, U or Escape). */
  onUndo: () => void;
  /** Called once when the countdown reaches zero without an undo. */
  onComplete: () => void;
  className?: string;
};

const isEditable = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  if (!el || !("tagName" in el)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
};

/**
 * The four-second undo window. The bar drains linearly from a clock (not a CSS animation), so it keeps
 * working under reduced motion, where it is information rather than decoration. U or Escape undo, except that U is
 * ignored while typing in a field. The countdown text is aria-hidden; the label is announced once.
 */
export function UndoBar({ label, durationMs = UNDO_MS, onUndo, onComplete, className }: UndoBarProps) {
  const [remaining, setRemaining] = useState(durationMs);
  const barRef = useRef<HTMLDivElement>(null);
  const settled = useRef(false);
  const cbs = useRef({ onUndo, onComplete });
  cbs.current = { onUndo, onComplete };

  useEffect(() => {
    settled.current = false;
    const start = performance.now();
    let raf = 0;
    let lastShown = -1;
    const tick = () => {
      if (settled.current) return;
      const left = Math.max(0, durationMs - (performance.now() - start));
      if (barRef.current) barRef.current.style.transform = `scaleX(${left / durationMs})`;
      const tenth = Math.ceil(left / 100);
      if (tenth !== lastShown) {
        lastShown = tenth;
        setRemaining(left);
      }
      if (left <= 0) {
        settled.current = true;
        cbs.current.onComplete();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      settled.current = true;
      cancelAnimationFrame(raf);
    };
  }, [durationMs]);

  const undo = () => {
    if (settled.current) return;
    settled.current = true;
    cbs.current.onUndo();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" || ((e.key === "u" || e.key === "U") && !isEditable(e.target))) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className={cn("overflow-hidden rounded-[14px] border border-signal/70 bg-signal-50 text-ink shadow-card", className)}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <p role="status" className="min-w-0 flex-1 truncate text-[15px] font-bold">
          {label}
        </p>
        <span aria-hidden data-testid="undo-countdown" className="w-12 shrink-0 text-right text-[15px] font-extrabold tabular-nums">
          {(remaining / 1000).toFixed(1)}s
        </span>
        <button
          type="button"
          onClick={undo}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-ink px-3 text-[14px] font-bold text-white transition-colors hover:bg-lane focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <Undo2 aria-hidden className="size-4" />
          Undo
          <kbd className="ml-0.5 rounded bg-white/20 px-1.5 text-[11px] font-bold leading-5">U</kbd>
        </button>
      </div>
      <div className="h-1.5 bg-signal/30">
        <div ref={barRef} data-testid="undo-bar" className="h-full origin-left bg-ink" style={{ transform: "scaleX(1)" }} />
      </div>
    </div>
  );
}
