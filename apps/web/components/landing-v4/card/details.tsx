"use client";

import { ArrowUpRight, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MatchRing } from "./match-ring";
import type { V4Card } from "./model";

/** What opens when a card is tapped: every requirement with its evidence, the pay words, the way out to the posting. */
export function CardDetails({ card, onApprove, onPass }: { card: V4Card; onApprove: () => void; onPass: () => void }) {
  return (
    <div data-testid="card-details" className="flex min-h-0 flex-1 flex-col gap-3 text-[#13201A]">
      <div className="flex items-center gap-3">
        <MatchRing score={card.score} size={48} />
        <p className="text-[14px] leading-5 font-semibold">
          {card.total === 0 ? "No requirements listed" : `Matches ${card.matched} of ${card.total} requirements`}
          {card.aboveFloor !== null && <span className="block font-normal text-[#55625B]">Pay {card.aboveFloor ? "above" : "below"} your floor</span>}
        </p>
      </div>

      <ul aria-label="Requirements" className="m-0 min-h-0 flex-1 list-none divide-y divide-[#E4EBE6] overflow-y-auto p-0">
        {card.reqs.map((r) => (
          <li key={r.label} data-met={r.met} className="flex items-start gap-2.5 py-2">
            <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full", r.met ? "bg-[#0F5C45] text-white" : "bg-[#F0EFEA] text-[#55625B]")}>
              {r.met ? <Check aria-hidden className="size-3" strokeWidth={3.5} /> : <X aria-hidden className="size-3" strokeWidth={3.5} />}
            </span>
            <p className="text-[14px] leading-5">
              <span className="sr-only">{r.met ? "Met: " : "Missing: "}</span>
              <span className="font-semibold">{r.label}</span>
              <span className="block text-[13px] text-[#55625B]">{r.met ? "On the sample profile" : "Not on the sample profile"}</span>
            </p>
          </li>
        ))}
      </ul>

      <section aria-label="Pay trace" className="rounded-xl bg-[#F7F6F2] p-3 text-[13px] leading-5">
        {card.pay ? (
          <>
            <p>
              <span className="font-bold text-[#55625B]">Posting says </span>
              <mark className="rounded bg-[#FACC15]/70 px-1 font-semibold text-[#13201A]">{card.paySource ?? card.pay.text}</mark>
            </p>
            <p>
              <span className="font-bold text-[#55625B]">Shown as </span>
              <span className="font-semibold text-[#0F5C45]">{card.pay.text}</span>
            </p>
          </>
        ) : (
          <p className="text-[#55625B]">The posting states no pay, so there is nothing to convert.</p>
        )}
      </section>

      {card.postingUrl && (
        <a
          href={card.postingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 items-center gap-1 self-start rounded-lg text-[14px] font-bold text-[#0F5C45] hover:underline focus-visible:outline-2 focus-visible:outline-[#0F5C45]"
        >
          Open the posting
          <ArrowUpRight aria-hidden className="size-4" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onPass} className="h-12 rounded-2xl bg-[#F0EFEA] text-[15px] font-bold text-[#13201A] hover:bg-[#E7E5DD] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F5C45]">
          Pass
        </button>
        <button type="button" onClick={onApprove} className="h-12 rounded-2xl bg-[#0F5C45] text-[15px] font-extrabold text-white hover:bg-[#0c4d3a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F5C45]">
          Approve
        </button>
      </div>
    </div>
  );
}
