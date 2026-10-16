"use client";

import { useState } from "react";
import { Info, Sparkles } from "lucide-react";
import { CompanyLogo } from "../../brand/CompanyLogo";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/shadcn/tooltip";
import { cn } from "@/lib/utils";
import { MatchRing } from "./match-ring";
import type { V4Card } from "./model";

/** "from posting": the words the pay was read from. Click or tap toggles it, so it works without hover. */
function FromPosting({ card }: { card: V4Card }) {
  const [open, setOpen] = useState(false);
  if (!card.pay) return null;
  const said = card.paySource ? `The posting says ${card.paySource}.` : "Read from the posting.";
  return (
    <TooltipProvider>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-nodrag
            onClick={() => setOpen((v) => !v)}
            aria-label={`Pay source: ${said}`}
            className="inline-flex h-6 items-center gap-1 rounded-full px-1.5 text-[12px] leading-none font-semibold text-[#55625B] outline-none hover:bg-[#EEF3EF] focus-visible:outline-2 focus-visible:outline-[#0F5C45] pointer-coarse:h-9 pointer-coarse:px-2.5"
          >
            <Info aria-hidden className="size-3" />
            from posting
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[240px] bg-[#13201A] text-[13px] leading-5 text-white">
          {said}
          {card.pay.converted && <span className="block text-white/70">Shown as a yearly figure.</span>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * The v4 job card (docs/design/landing-v4.md, "The job card"): logo and company, match ring, role, pay, at most three
 * chips, one "why it fits" line and an optional Needs-you row. Nothing else.
 */
export function JobCard({ card, className, interactive = true }: { card: V4Card; className?: string; interactive?: boolean }) {
  const meta = [card.where, card.posted].filter(Boolean).join(" · ");
  return (
    <article
      data-testid="job-card"
      data-slug={card.slug}
      aria-label={`${card.title} at ${card.company}`}
      className={cn("flex w-full flex-col gap-3 rounded-[20px] bg-white p-4 text-[#13201A] select-none", className)}
    >
      <header className="flex items-center gap-3">
        <CompanyLogo name={card.company} src={card.logoPath} size={40} />
        <div className="min-w-0 flex-1">
          <p data-testid="card-company" className="truncate text-[15px] leading-5 font-semibold">
            {card.company}
          </p>
          <p data-testid="card-meta" className="truncate text-[13px] leading-5 text-[#55625B]">
            {meta}
          </p>
        </div>
        <MatchRing score={card.score} />
      </header>

      <h3 data-testid="card-role" className="line-clamp-2 text-[20px] leading-[1.2] font-bold tracking-[-0.01em] text-balance">
        {card.title}
      </h3>

      <div className="flex min-h-6 flex-wrap items-center gap-x-1.5">
        {card.pay ? (
          <>
            <span data-testid="card-pay" className="text-[16px] leading-6 font-bold text-[#0F5C45] tabular-nums">
              {card.pay.text}
            </span>
            {interactive && <FromPosting card={card} />}
          </>
        ) : (
          <span data-testid="card-pay" className="text-[14px] leading-6 text-[#55625B]">
            Pay not stated
          </span>
        )}
      </div>

      {card.chips.length > 0 && (
        <ul data-testid="card-chips" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {card.chips.map((c) => (
            <li key={c} className="max-w-[140px] truncate rounded-full bg-[#F0EFEA] px-2.5 py-1 text-[13px] leading-4 text-[#3C4A43]">
              {c}
            </li>
          ))}
        </ul>
      )}

      <p data-testid="card-why" className="flex items-center gap-2 truncate rounded-xl bg-[#EAF3EC] px-3 py-2 text-[14px] leading-5 text-[#13201A]">
        <Sparkles aria-hidden className="size-3.5 shrink-0 text-[#0F5C45]" />
        <span className="truncate">{card.why}</span>
      </p>

      {card.needs && (
        <p data-testid="card-needs" className="flex items-center gap-2 rounded-xl bg-[#FEF3C7] px-3 py-1.5 text-[13px] leading-5 font-semibold text-[#5B4300]">
          <span aria-hidden className="size-1.5 rounded-full bg-[#FACC15] ring-2 ring-[#FACC15]/40" />
          Needs you: {card.needs.label.toLowerCase()}
        </p>
      )}
    </article>
  );
}
