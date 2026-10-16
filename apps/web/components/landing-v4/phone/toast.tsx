"use client";

import { motion } from "motion/react";
import { useReduced } from "../../landing-v3/stack/use-reduced";

export const TOAST_MS = 4000;

/** The dark toast with a 4 s drain. `id` re-keys it, so each decision restarts the drain. */
export function PhoneToast({ id, line, sub, onUndo }: { id: number; line: string; sub: string; onUndo: () => void }) {
  const reduce = useReduced();
  return (
    <motion.div
      key={id}
      role="status"
      data-testid="toast"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduce ? 0 : 8 }}
      transition={{ duration: 0.2 }}
      className="relative flex h-14 items-center gap-3 overflow-hidden rounded-2xl bg-[#13201A] pr-1.5 pl-4 text-white shadow-[0_14px_30px_-10px_rgb(19_32_26/0.6)]"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] leading-5 font-bold">{line}</p>
        <p className="truncate text-[12px] leading-4 text-white/65">{sub}</p>
      </div>
      <button type="button" onClick={onUndo} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[14px] font-extrabold text-[#FACC15] hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#FACC15]">
        Undo
        <kbd className="hidden rounded bg-white/15 px-1.5 text-[11px] leading-5 text-white sm:inline-block">U</kbd>
      </button>
      {!reduce && (
        <motion.span aria-hidden data-testid="toast-drain" className="absolute inset-x-0 bottom-0 h-[3px] origin-left bg-[#FACC15]" initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: TOAST_MS / 1000, ease: "linear" }} />
      )}
    </motion.div>
  );
}
