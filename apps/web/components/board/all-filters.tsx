"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { cn } from "../ui/cn";

/**
 * The "All filters" panel: a native <details> so it works before hydration, with outside click, Escape and
 * choose-an-option closing layered on. The panel drops over the results from the filter bar's edge.
 */
export function AllFilters({ active, children }: { active: number; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const away = (e: PointerEvent) => {
      if (el.open && !el.contains(e.target as Node)) el.open = false;
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && el.open) {
        el.open = false;
        el.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, []);
  return (
    <details ref={ref} className="group/filters shrink-0" data-testid="all-filters">
      <summary
        className={cn(
          "inline-flex h-9 cursor-pointer list-none items-center gap-2 rounded-full border px-3.5 text-[14px] font-bold select-none [&::-webkit-details-marker]:hidden",
          "border-line bg-surface text-ink shadow-control hover:border-lane/40 hover:bg-lane-50 group-open/filters:border-lane group-open/filters:bg-lane-50",
        )}
      >
        <SlidersHorizontal aria-hidden className="size-4" />
        All filters
        {active > 0 ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-lane px-1 text-[12px] font-bold text-white">{active}</span> : null}
        <ChevronDown aria-hidden className="size-4 transition-transform group-open/filters:rotate-180" />
      </summary>
      <div
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a") && ref.current) ref.current.open = false;
        }}
        className="absolute inset-x-0 top-full z-30 mt-2 max-h-[min(34rem,72vh)] overflow-auto rounded-[16px] border border-line bg-surface p-5 shadow-pop"
      >
        {children}
      </div>
    </details>
  );
}
