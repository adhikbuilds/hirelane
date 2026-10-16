"use client";

import { Check, Lock } from "lucide-react";
import { CompanyLogo } from "../../brand/CompanyLogo";
import { cn } from "@/lib/utils";
import type { V4Card } from "../card/model";
import { ASHA } from "../workflow/asha";
import { PhoneSheet } from "./sheet";

export const READY_FIELDS = [
  { id: "name", label: "Name", value: ASHA.name },
  { id: "email", label: "Email", value: ASHA.email },
  { id: "resume", label: "Resume", value: "Sample resume" },
] as const;

/** "Ready to send": fields filled from the sample resume, one Needs-you question, then Send. Nothing is transmitted. */
export function ReadySheet({ card, answer, onAnswer, onSend, onClose }: { card: V4Card; answer: string; onAnswer: (v: string) => void; onSend: () => void; onClose: () => void }) {
  const needs = card.needs;
  const blocked = !!needs && !answer;
  return (
    <PhoneSheet testId="ready-sheet" title="Ready to send" subtitle={`${card.company} · ${card.title}`} onClose={onClose}>
      <div className="flex items-center gap-2 text-[12px] leading-4 font-semibold text-[#55625B]">
        <CompanyLogo name={card.company} src={card.logoPath} size={24} />
        Filled from the sample resume
      </div>
      <dl className="m-0 divide-y divide-[#E4EBE6] rounded-2xl bg-[#F7F6F2] px-3">
        {READY_FIELDS.map((f) => (
          <div key={f.id} data-field={f.id} className="flex items-center gap-3 py-2">
            <dt className="w-14 shrink-0 text-[12px] leading-4 font-bold text-[#55625B]">{f.label}</dt>
            <dd className="m-0 min-w-0 flex-1 truncate text-[14px] leading-5 font-semibold">{f.value}</dd>
            <Check aria-hidden className="size-4 shrink-0 text-[#0F5C45]" strokeWidth={3} />
          </div>
        ))}
      </dl>

      {needs ? (
        <div data-testid="ready-needs" className="rounded-2xl bg-[#FEF3C7] p-3 ring-1 ring-[#FACC15]/60">
          <p id="ready-needs-label" className="flex items-center gap-1.5 text-[13px] leading-4 font-bold text-[#5B4300]">
            <span aria-hidden className="size-1.5 rounded-full bg-[#FACC15]" />
            Needs you: {needs.label.toLowerCase()}
          </p>
          <div role="radiogroup" aria-labelledby="ready-needs-label" className="mt-2 flex flex-wrap gap-1.5">
            {needs.answers.map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={answer === a}
                onClick={() => onAnswer(a)}
                className={cn(
                  "h-11 rounded-full px-4 text-[14px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F5C45]",
                  answer === a ? "bg-[#13201A] text-white" : "bg-white text-[#13201A] ring-1 ring-[#13201A]/15 hover:bg-[#FFFBEB]",
                )}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p data-testid="ready-nothing" className="flex items-center gap-2 rounded-2xl bg-[#EAF3EC] px-3 py-2.5 text-[13px] leading-5 font-semibold">
          <Check aria-hidden className="size-4 text-[#0F5C45]" strokeWidth={3} />
          Nothing to ask. Ready to send.
        </p>
      )}

      <button
        type="button"
        onClick={onSend}
        disabled={blocked}
        className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#0F5C45] text-[16px] font-extrabold text-white transition-colors hover:bg-[#0c4d3a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F5C45] disabled:bg-[#0F5C45]/35"
      >
        Send
      </button>
      <p className="flex items-center justify-center gap-1.5 text-center text-[12px] leading-4 text-[#55625B]">
        <Lock aria-hidden className="size-3" />
        {blocked ? "Hirelane never guesses. Pick an answer to send." : "Demo: nothing leaves your browser."}
      </p>
    </PhoneSheet>
  );
}
