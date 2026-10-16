import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const H2 = "text-[clamp(34px,4.6vw,56px)] font-extrabold leading-[1.02] tracking-[-0.03em] text-balance text-foreground";
export const LEAD = "text-[17px] leading-[26px] text-muted-foreground";
export const SECTION_PAD = "px-7 py-20 md:px-12 md:py-28";

/**
 * One chapter of the story. `data-chapter` is read by LaneLine to place the signpost on the lane,
 * so every chapter needs one. The signpost sits in the top padding, level with the heading.
 */
export function Chapter({ id, chapter, children, className, label }: { id?: string; chapter: string; children: ReactNode; className?: string; label?: string }) {
  return (
    <section id={id} data-chapter={chapter} aria-label={label ?? chapter} className={cn("relative scroll-mt-16", SECTION_PAD, className)}>
      <div className="mx-auto w-full max-w-[1120px]">{children}</div>
    </section>
  );
}
