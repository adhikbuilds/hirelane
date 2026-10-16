"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/shadcn/dialog";
import { cn } from "@/lib/utils";

export const LANDING_NAV = [
  { href: "/jobs", label: "Jobs" },
  { href: "/#pricing", label: "Pricing" },
] as const;
export const LANDING_START = { href: "/#start", label: "Start free" } as const;
export const SCROLL_SOLID_AT = 24;

/** `||` wordmark in lane green and ink. */
function Mark() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width="14" height="18" viewBox="0 0 14 18" aria-hidden="true">
        <rect x="0" y="0" width="4" height="18" rx="1" fill="#0f5c45" />
        <rect x="9" y="0" width="4" height="18" rx="1" fill="#0f5c45" />
      </svg>
      <span className="text-[22px] font-extrabold tracking-[-0.03em] text-[#13201a]">hirelane</span>
    </span>
  );
}

const pill =
  "inline-flex h-11 items-center rounded-full px-4 text-[15px] font-bold outline-none transition-[background-color,color,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f5c45] active:scale-95";

/**
 * Floating bar for "/". Light theme (landing v4). Transparent over the hero, then a translucent white bar once the page scrolls.
 * Keeps `data-site-header` / `data-solid` so the shell contract (and its e2e) stay the same as v2's.
 */
export function LandingHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > SCROLL_SOLID_AT);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header data-landing="v4" data-site-header data-solid={scrolled} className="pointer-events-none fixed inset-x-0 top-0 z-40 px-3 pt-3 sm:px-6 sm:pt-4">
      <div
        className={cn(
          "pointer-events-auto mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-4 rounded-full px-3 pl-5 transition-[background-color,box-shadow,backdrop-filter] duration-300",
          scrolled
            ? "bg-[rgb(255_255_255/0.82)] shadow-[0_0_0_1px_rgb(19_32_26/0.08),0_1px_2px_rgb(19_32_26/0.06),0_16px_32px_-16px_rgb(19_32_26/0.25)] backdrop-blur-[18px]"
            : "bg-transparent shadow-none",
        )}
      >
        <Link href="/" aria-label="hirelane home" className="rounded-full py-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0f5c45]">
          <Mark />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {LANDING_NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cn(pill, "text-[#13201a]/80 hover:bg-[#13201a]/6 hover:text-[#13201a]")}>
              {n.label}
            </Link>
          ))}
          <Link href={LANDING_START.href} className={cn(pill, "ml-1 bg-[#0f5c45] px-5 text-white hover:bg-[#0b4a37] hover:-translate-y-px")}>
            {LANDING_START.label}
          </Link>
        </nav>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              aria-label="Open menu"
              className="grid size-11 place-items-center rounded-full bg-[#13201a]/8 text-[#13201a] outline-none transition-[background-color,transform] duration-150 hover:bg-[#13201a]/14 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f5c45] active:scale-95 md:hidden"
            >
              <Menu aria-hidden className="size-5" />
            </button>
          </DialogTrigger>
          <DialogContent
            data-landing="v4"
            showCloseButton={false}
            aria-describedby={undefined}
            className="top-3 right-3 left-3 bottom-auto w-auto max-w-none translate-x-0 translate-y-0 rounded-[28px] bg-white p-5 text-[#13201a] shadow-[0_0_0_1px_rgb(19_32_26/0.08),0_40px_80px_-20px_rgb(19_32_26/0.4)] sm:left-auto sm:max-w-sm"
          >
            <div className="flex items-center justify-between">
              <DialogTitle className="sr-only">Menu</DialogTitle>
              <DialogDescription className="sr-only">Site navigation</DialogDescription>
              <Mark />
              <DialogClose
                aria-label="Close menu"
                className="grid size-11 cursor-pointer place-items-center rounded-full bg-[#13201a]/8 text-[#13201a] outline-none transition-[background-color,transform] hover:bg-[#13201a]/14 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f5c45] active:scale-95"
              >
                <X aria-hidden className="size-5" />
              </DialogClose>
            </div>
            <nav aria-label="Mobile" className="mt-4 flex flex-col">
              {LANDING_NAV.map((n) => (
                <DialogClose key={n.href} asChild>
                  <Link href={n.href} className="flex h-14 items-center rounded-2xl px-3 text-[24px] font-extrabold tracking-[-0.02em] text-[#13201a] outline-none transition-colors hover:bg-[#13201a]/6 focus-visible:outline-2 focus-visible:outline-[#0f5c45]">
                    {n.label}
                  </Link>
                </DialogClose>
              ))}
            </nav>
            <DialogClose asChild>
              <Link href={LANDING_START.href} className="mt-3 flex h-14 items-center justify-center rounded-full bg-[#0f5c45] text-[18px] font-bold text-white outline-none transition-transform hover:bg-[#0b4a37] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#13201a] active:scale-[0.98]">
                {LANDING_START.label}
              </Link>
            </DialogClose>
          </DialogContent>
        </Dialog>
      </div>
    </header>
  );
}
