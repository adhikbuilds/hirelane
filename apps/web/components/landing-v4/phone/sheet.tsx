"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";
import { useReduced } from "../../landing-v3/stack/use-reduced";

const FOCUSABLE = "button:not([disabled]),a[href],input:not([disabled]),[tabindex]:not([tabindex='-1'])";

/**
 * A bottom sheet inside the phone screen. Not the shadcn Sheet: that portals to <body>, outside the phone.
 * Focus moves in, Tab stays inside, Escape closes and the caller restores focus.
 */
export function PhoneSheet({ title, subtitle, onClose, children, testId }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; testId: string }) {
  const reduce = useReduced();
  const ref = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === heading.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="absolute inset-0 z-30 flex items-end" onKeyDown={onKeyDown}>
      <motion.div aria-hidden className="absolute inset-0 bg-[#13201A]/45" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${testId}-title`}
        data-testid={testId}
        initial={reduce ? { opacity: 0 } : { y: "100%" }}
        animate={reduce ? { opacity: 1 } : { y: 0 }}
        exit={reduce ? { opacity: 0 } : { y: "100%" }}
        transition={reduce ? { duration: 0.15 } : { type: "spring", stiffness: 320, damping: 34 }}
        className="relative flex max-h-[92%] w-full flex-col gap-3 rounded-t-[28px] bg-white p-4 pb-5 shadow-[0_-12px_40px_rgb(19_32_26/0.25)]"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id={`${testId}-title`} ref={heading} tabIndex={-1} className="text-[18px] leading-6 font-extrabold tracking-[-0.01em] outline-none">
              {title}
            </h2>
            {subtitle && <p className="truncate text-[13px] leading-5 text-[#55625B]">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="-mt-1 -mr-1 grid size-11 shrink-0 place-items-center rounded-xl text-[#55625B] hover:bg-[#F0EFEA] focus-visible:outline-2 focus-visible:outline-[#0F5C45]">
            <X aria-hidden className="size-5" />
          </button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}
