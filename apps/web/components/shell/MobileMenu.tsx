"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Menu, X } from "lucide-react";
import { buttonClasses } from "../ui/Button";
import { cn } from "../ui/cn";
import { trapTab } from "./focus-trap";
import { isActive, NAV, START_FREE } from "./nav";

/** Hamburger plus a right-hand sheet. Esc and the backdrop close it, Tab stays inside it, focus returns to the button. */
export function MobileMenu({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const button = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  // Navigating closes the sheet.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const trigger = button.current;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sheet.current?.querySelector<HTMLElement>("[data-menu-close]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (sheet.current) trapTab(e, sheet.current);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      trigger?.focus();
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        ref={button}
        type="button"
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="grid size-11 place-items-center rounded-[12px] border border-line bg-surface text-ink shadow-control hover:bg-lane-50"
      >
        <Menu aria-hidden className="size-5" />
      </button>

      {open
        ? createPortal(
            <div className="fixed inset-0 z-50" data-testid="mobile-menu-root">
              <motion.div
                aria-hidden
                onClick={close}
                className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
              />
              <motion.div
                ref={sheet}
                id="mobile-menu"
                role="dialog"
                aria-modal="true"
                aria-label="Menu"
                className="absolute inset-y-0 right-0 flex w-[min(86vw,360px)] flex-col bg-surface p-5 shadow-pop"
                initial={reduce ? false : { x: "100%" }}
                animate={{ x: 0 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-bold uppercase tracking-[0.08em] text-ink-3">
                    Menu
                  </span>
                  <button
                    type="button"
                    data-menu-close
                    aria-label="Close menu"
                    onClick={close}
                    className="grid size-11 place-items-center rounded-[12px] text-ink hover:bg-ink/5"
                  >
                    <X aria-hidden className="size-5" />
                  </button>
                </div>
                <nav aria-label="Mobile" className="mt-4">
                  <ul className="divide-y divide-line">
                    {NAV.map((n) => (
                      <li key={n.href}>
                        <Link
                          href={n.href}
                          onClick={close}
                          aria-current={
                            isActive(pathname, n.href) ? "page" : undefined
                          }
                          className={cn(
                            "flex h-14 items-center text-[20px] font-extrabold tracking-[-0.02em] text-ink",
                            isActive(pathname, n.href) && "text-lane",
                          )}
                        >
                          {n.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
                <div className="mt-auto pt-6">
                  <Link
                    href={START_FREE.href}
                    onClick={close}
                    className={cn(buttonClasses("primary", "lg"), "w-full")}
                  >
                    {START_FREE.label}
                  </Link>
                  <p className="mt-3 text-center text-[13px] text-ink-3">
                    Early access opens soon. Nothing is sent without you.
                  </p>
                </div>
              </motion.div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
