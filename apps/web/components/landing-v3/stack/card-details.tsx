"use client";

import { ArrowUpRight, Check, X } from "lucide-react";
import { CompanyLogo } from "../../brand/CompanyLogo";
import { cn } from "@/lib/utils";
import type { StackCardModel } from "./cards";
import { Ring } from "./card-face";

/** The pay words as the posting states them are lit; the normalised figure follows. Both come from the job row. */
export function MiniPayTrace({ card, lit = true }: { card: StackCardModel; lit?: boolean }) {
  const t = card.payTrace;
  if (!t) return <p className="text-[13px] leading-5 text-[#a3ada3]">The posting states no pay, so there is nothing to convert.</p>;
  return (
    <ol data-testid="pay-trace" className="flex flex-col gap-1.5 text-[13px] leading-5">
      <li className="flex flex-wrap items-baseline gap-x-2">
        <span className="w-14 shrink-0 font-bold text-[#a3ada3]">Stated</span>
        <mark className={cn("rounded px-1 py-0.5 font-bold transition-colors duration-500", lit ? "bg-[#FACC15] text-[#1b1500]" : "bg-white/10 text-white")}>{t.stated}</mark>
      </li>
      <li className="flex flex-wrap items-baseline gap-x-2">
        <span className="w-14 shrink-0 font-bold text-[#a3ada3]">{t.converted ? "Convert" : "Check"}</span>
        <span className="font-semibold text-white">{t.converted ? `${t.normalised} a year, in USD` : "already a yearly USD figure"}</span>
      </li>
      <li className="flex flex-wrap items-baseline gap-x-2">
        <span className="w-14 shrink-0 font-bold text-[#a3ada3]">Floor</span>
        <span className="font-semibold text-white">
          {card.match.salaryAboveFloor === null ? "no pay to compare" : card.match.salaryAboveFloor ? "above your floor" : "below your floor"}
        </span>
      </li>
    </ol>
  );
}

/** Every requirement with its evidence, the pay trace, the company's other roles, and the way out to the posting. */
export function CardDetails({
  card,
  onApprove,
  onPass,
  onClose,
  headingRef,
  inSheet = false,
}: {
  card: StackCardModel;
  onApprove: () => void;
  onPass: () => void;
  onClose?: () => void;
  headingRef?: React.Ref<HTMLHeadingElement>;
  inSheet?: boolean;
}) {
  const others = card.openRoles !== null ? Math.max(0, card.openRoles - 1) : null;
  return (
    <div data-testid="card-details" className="flex min-h-0 flex-1 flex-col gap-4 text-white">
      {!inSheet && (
        <div className="flex items-start gap-3">
          <CompanyLogo name={card.company} src={card.logoPath} size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] leading-5 font-semibold text-[#a3ada3]">{card.company}</p>
            <h3 ref={headingRef} tabIndex={-1} className="text-[18px] leading-tight font-extrabold tracking-[-0.02em] outline-none focus-visible:outline-none" style={{ outline: "none" }}>
              {card.title}
            </h3>
          </div>
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close details" className="grid size-11 shrink-0 place-items-center rounded-xl text-[#a3ada3] hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-[#c6f19d]">
              <X aria-hidden className="size-5" />
            </button>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Ring score={card.match.score} size={48} />
        <p className="text-[13px] leading-5 font-semibold">{card.match.maths}</p>
      </div>

      <section aria-label="Requirements" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto rounded-lg pr-1 outline-none focus-visible:outline-2 focus-visible:outline-[#c6f19d]">
        <ul className="flex flex-col divide-y divide-white/8">
          {card.match.chips.map((c) => (
            <li key={c.label} data-met={c.met} className="flex items-start gap-2.5 py-2">
              <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full", c.met ? "bg-[#c6f19d] text-[#0f1f10]" : "bg-white/12 text-[#a3ada3]")}>
                {c.met ? <Check aria-hidden className="size-3.5" strokeWidth={3.5} /> : <X aria-hidden className="size-3.5" strokeWidth={3.5} />}
              </span>
              <div className="min-w-0">
                <p className="text-[14px] leading-5 font-bold">
                  <span className="sr-only">{c.met ? "Met: " : "Missed: "}</span>
                  {c.label}
                </p>
                <p className="text-[13px] leading-5 text-[#a3ada3]">
                  {c.met ? `Posting lists "${c.label}". Found on the demo resume.` : `Posting lists "${c.label}". Not found on the demo resume.`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Pay trace" className="rounded-2xl bg-black/25 p-3">
        <MiniPayTrace card={card} />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px] leading-5 text-[#a3ada3]">
        {others !== null ? (
          <span>
            {others} other open {others === 1 ? "role" : "roles"} at {card.company}
          </span>
        ) : (
          <span />
        )}
        {card.postingUrl && (
          <a
            href={card.postingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center gap-1 rounded-lg px-1 font-bold text-[#c6f19d] hover:underline focus-visible:outline-2 focus-visible:outline-[#c6f19d]"
          >
            Open the posting
            <ArrowUpRight aria-hidden className="size-4" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onPass} className="h-12 rounded-2xl bg-white/10 text-[15px] font-bold text-white hover:bg-white/16 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c6f19d]">
          Pass
        </button>
        <button type="button" onClick={onApprove} className="h-12 rounded-2xl bg-[#c6f19d] text-[15px] font-extrabold text-[#0f1f10] hover:bg-[#d4f6b3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          Approve
        </button>
      </div>
    </div>
  );
}
