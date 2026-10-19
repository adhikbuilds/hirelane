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
export const LANDING_START = { href: "/#start", label: "Get early access" } as const;
export const SCROLL_SOLID_AT = 24;

/** `||` wordmark in white and lime. */
function Mark() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width="14" height="18" viewBox="0 0 14 18" aria-hidden="true">
        <rect x="0" y="0" width="4" height="18" rx="1" fill="#c6f19d" />
        <rect x="9" y="0" width="4" height="18" rx="1" fill="#c6f19d" />
      </svg>
      <span className="text-[22px] font-extrabold tracking-[-0.03em] text-white">hirelane</span>
    </span>
  );
}

const pill =
  "inline-flex h-11 items-center rounded-full px-4 text-[15px] font-bold outline-none transition-[background-color,color,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c6f19d] active:scale-95";

/**
 * Floating bar for "/". Transparent over the hero, then a translucent spatial panel once the page scrolls.
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
    <header data-landing="v3" data-site-header data-solid={scrolled} className="pointer-events-none fixed inset-x-0 top-0 z-40 px-3 pt-3 sm:px-6 sm:pt-4">
      <div
        className={cn(
          "pointer-events-auto mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-4 rounded-full px-3 pl-5 transition-[background-color,box-shadow,backdrop-filter] duration-300",
          scrolled
            ? "bg-[rgb(15_31_16/0.55)] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08),0_1px_2px_rgb(0_0_0/0.3),0_16px_32px_-12px_rgb(0_0_0/0.5)] backdrop-blur-[20px]"
            : "bg-transparent shadow-none",
        )}
      >
        <Link href="/" aria-label="hirelane home" className="rounded-full py-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#c6f19d]">
          <Mark />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {LANDING_NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cn(pill, "text-white/85 hover:bg-white/10 hover:text-white")}>
              {n.label}
            </Link>
          ))}
          <Link href={LANDING_START.href} className={cn(pill, "ml-1 bg-[#c6f19d] px-5 text-[#0f1f10] hover:bg-[#d6f6b4] hover:-translate-y-px")}>
            {LANDING_START.label}
          </Link>
        </nav>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              aria-label="Open menu"
              className="grid size-11 place-items-center rounded-full bg-white/10 text-white outline-none transition-[background-color,transform] duration-150 hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c6f19d] active:scale-95 md:hidden"
            >
              <Menu aria-hidden className="size-5" />
            </button>
          </DialogTrigger>
          <DialogContent
            showCloseButton={false}
            aria-describedby={undefined}
            className="top-3 right-3 left-3 bottom-auto w-auto max-w-none translate-x-0 translate-y-0 rounded-[28px] bg-[rgb(15_31_16/0.88)] p-5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08),0_40px_80px_-20px_rgb(0_0_0/0.7)] backdrop-blur-[20px] sm:left-auto sm:max-w-sm"
          >
            <div className="flex items-center justify-between">
              <DialogTitle className="sr-only">Menu</DialogTitle>
              <DialogDescription className="sr-only">Site navigation</DialogDescription>
              <Mark />
              <DialogClose
                aria-label="Close menu"
                className="grid size-11 cursor-pointer place-items-center rounded-full bg-white/10 text-white outline-none transition-[background-color,transform] hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c6f19d] active:scale-95"
              >
                <X aria-hidden className="size-5" />
              </DialogClose>
            </div>
            <nav aria-label="Mobile" className="mt-4 flex flex-col">
              {LANDING_NAV.map((n) => (
                <DialogClose key={n.href} asChild>
                  <Link href={n.href} className="flex h-14 items-center rounded-2xl px-3 text-[24px] font-extrabold tracking-[-0.02em] text-white outline-none transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#c6f19d]">
                    {n.label}
                  </Link>
                </DialogClose>
              ))}
            </nav>
            <DialogClose asChild>
              <Link href={LANDING_START.href} className="mt-3 flex h-14 items-center justify-center rounded-full bg-[#c6f19d] text-[18px] font-bold text-[#0f1f10] outline-none transition-transform hover:bg-[#d6f6b4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[0.98]">
                {LANDING_START.label}
              </Link>
            </DialogClose>
          </DialogContent>
        </Dialog>
      </div>
    </header>
  );
}
