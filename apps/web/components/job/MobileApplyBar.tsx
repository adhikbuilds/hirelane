"use client";

import { ArrowUpRight } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { SaveButton } from "./SaveButton";

/** Fixed bottom bar for small screens, where the sticky side card does not exist. */
export function MobileApplyBar({ slug, apply, title }: { slug: string; apply: string; title: string }) {
  return (
    <div
      data-testid="mobile-apply-bar"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/92 px-4 py-3 shadow-[0_-8px_24px_rgb(15_31_26/.08)] backdrop-blur-xl lg:hidden"
    >
      <div className="mx-auto flex max-w-xl items-center gap-2.5">
        <SaveButton slug={slug} compact className="shrink-0" />
        <a
          href={apply}
          target="_blank"
          rel="noopener noreferrer nofollow"
          aria-label={`Apply on employer site for ${title}`}
          className={cn(buttonClasses("primary", "md"), "min-w-0 flex-1")}
        >
          Apply on employer site
          <ArrowUpRight aria-hidden className="size-4" />
        </a>
      </div>
    </div>
  );
}
