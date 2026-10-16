"use client";

import { forwardRef, type Ref } from "react";
import { motion } from "motion/react";
import { Check, ChevronUp, X } from "lucide-react";
import { CompanyLogo } from "../../brand/CompanyLogo";
import { cn } from "@/lib/utils";
import type { StackCardModel } from "./cards";
import { useReduced } from "./use-reduced";

/** The spatial panel material: translucent forest, 20px blur, a 1px inner highlight. Shared by the live stack and the tour. */
export const PANEL_SURFACE =
  "relative overflow-hidden rounded-[28px] bg-[rgb(15_31_16/0.62)] shadow-[inset_0_1px_0_rgb(255_255_255/0.1),inset_0_0_0_1px_rgb(255_255_255/0.05)] backdrop-blur-[20px] backdrop-saturate-150 select-none";
export const CARD_HEIGHT = "h-[448px]";

/** Match ring, drawn as SVG. Lime on forest; the number sits in the middle. */
export function Ring({ score, size = 56 }: { score: number; size?: number }) {
  const sw = 5;
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const s = Math.min(100, Math.max(0, score));
  return (
    <div role="img" aria-label={`Match ${s} out of 100`} className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / 0.14)" strokeWidth={sw} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#c6f19d" strokeWidth={sw} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - s / 100)} />
      </svg>
      <span aria-hidden className="absolute text-[17px] leading-none font-extrabold tracking-tight text-white">
        {s}
      </span>
    </div>
  );
}

export function ReqChip({ label, met }: { label: string; met: boolean }) {
  return (
    <span
      data-met={met}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-full pr-2.5 pl-2 text-[13px] leading-none font-semibold",
        met ? "bg-[#c6f19d]/14 text-[#c6f19d]" : "bg-white/8 text-[#a3ada3]",
      )}
    >
      {met ? <Check aria-hidden className="size-3.5" strokeWidth={3} /> : <X aria-hidden className="size-3.5" strokeWidth={3} />}
      <span className="sr-only">{met ? "Met: " : "Missed: "}</span>
      <span className={cn("max-w-[11ch] truncate", !met && "line-through decoration-white/30")}>{label}</span>
    </span>
  );
}

export type NeedsProps = {
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
  /** Bumps to replay the 3-cycle shake. */
  shakeKey: number;
  /** Pulses the field in signal yellow (tour). */
  pulse?: boolean;
  inputId: string;
};

/** The one Needs-you field: label, free text, quick answers. Hirelane never guesses, so approve waits for it. */
export const NeedsField = forwardRef(function NeedsField(
  { card, needs, tabIndex }: { card: StackCardModel; needs: NeedsProps; tabIndex?: number },
  ref: Ref<HTMLInputElement>,
) {
  const reduce = useReduced();
  const n = card.needs;
  if (!n) {
    return (
      <div data-testid="needs-none" className="flex items-center gap-3 rounded-2xl bg-[#c6f19d]/10 p-3 ring-1 ring-[#c6f19d]/25">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#c6f19d] text-[#0f1f10]">
          <Check aria-hidden className="size-4" strokeWidth={3.5} />
        </span>
        <p className="text-[13px] leading-5 font-bold text-white">Nothing to ask. Ready to approve.</p>
      </div>
    );
  }
  const shake = !reduce && needs.shakeKey > 0;
  return (
    <motion.div
      key={needs.shakeKey}
      data-testid="needs-field"
      data-nodrag
      initial={false}
      animate={shake ? { x: [0, -6, 6, -6, 6, -6, 6, 0] } : { x: 0 }}
      transition={{ duration: 0.45, ease: "easeInOut" }}
      className={cn(
        "relative rounded-2xl bg-[#FACC15]/10 p-3 ring-1 transition-colors",
        needs.invalid ? "ring-[#FACC15]" : "ring-[#FACC15]/30",
      )}
    >
      {needs.pulse && !reduce && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute -inset-px rounded-2xl ring-2 ring-[#FACC15]"
          animate={{ opacity: [0.15, 1, 0.15] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      <label htmlFor={needs.inputId} className="flex items-center gap-1.5 text-[13px] leading-none font-bold text-[#FACC15]">
        <span aria-hidden className="size-1.5 rounded-full bg-[#FACC15]" />
        Needs you: {n.label}
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <input
          ref={ref}
          id={needs.inputId}
          tabIndex={tabIndex}
          value={needs.value}
          onChange={(e) => needs.onChange(e.target.value)}
          placeholder="Type or pick"
          aria-invalid={needs.invalid}
          aria-describedby={needs.invalid ? `${needs.inputId}-err` : undefined}
          autoComplete="off"
          className="h-10 w-full min-w-0 rounded-xl bg-black/30 px-3 text-[15px] font-semibold text-white outline-none ring-1 ring-white/10 placeholder:text-white/40 focus-visible:ring-2 focus-visible:ring-[#c6f19d]"
        />
        {n.answers.map((a) => (
          <button
            key={a}
            type="button"
            tabIndex={tabIndex}
            onClick={() => needs.onChange(a)}
            aria-pressed={needs.value === a}
            className={cn(
              "h-10 rounded-xl px-3 text-[13px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c6f19d]",
              needs.value === a ? "bg-[#FACC15] text-[#1b1500]" : "bg-white/10 text-white hover:bg-white/16",
            )}
          >
            {a}
          </button>
        ))}
      </div>
      {needs.invalid && (
        <p id={`${needs.inputId}-err`} role="alert" className="mt-2 text-[13px] leading-5 font-semibold text-[#FACC15]">
          Answer this first. Hirelane never guesses.
        </p>
      )}
    </motion.div>
  );
});

/** The face of a card: everything worth a decision, at true interface size. Shared by the live stack and the tour. */
export function CardFace({
  card,
  needs,
  needsRef,
  chipsOpen = true,
  onDetails,
  tabIndex,
  focus = null,
}: {
  card: StackCardModel;
  needs: NeedsProps;
  needsRef?: Ref<HTMLInputElement>;
  chipsOpen?: boolean;
  onDetails?: () => void;
  tabIndex?: number;
  /** Tour only: dims everything but one part of the card. */
  focus?: "maths" | "needs" | null;
}) {
  const m = card.match;
  const dim = (part: "maths" | "needs" | "rest") => ({ opacity: focus === null || focus === part ? 1 : 0.32, transition: "opacity 400ms ease" });
  const chips = m.chips.slice(0, 6);
  return (
    <div className="flex h-full flex-col justify-between gap-3 p-5 text-white">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3" style={dim("rest")}>
        <CompanyLogo name={card.company} src={card.logoPath} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] leading-5 font-semibold text-[#a3ada3]">{card.company}</p>
          <h2 className="line-clamp-2 text-[20px] leading-[1.15] font-extrabold tracking-[-0.02em]">{card.title}</h2>
        </div>
        </div>
        <div style={dim("maths")}>
          <Ring score={m.score} />
        </div>
      </div>

      <p className="truncate text-[13px] leading-5 text-[#a3ada3]" style={dim("rest")}>
        {card.where}
        {card.posted ? ` · posted ${card.posted}` : ""}
      </p>

      <div style={dim("rest")}>
        <p className="text-[30px] leading-none font-extrabold tracking-[-0.03em]">{card.payAnnual}</p>
        {card.payStated && <p className="mt-1 text-[13px] leading-5 text-[#a3ada3]">Posting says {card.payStated}</p>}
      </div>

      <div style={dim("maths")}>
        <p className="text-[13px] leading-5 font-semibold text-white/90" data-testid="maths">
          {m.maths}
        </p>
        {chipsOpen && chips.length > 0 && (
          <motion.ul
            aria-label="Requirements"
            className="mt-2 flex flex-wrap gap-1.5"
            initial="closed"
            animate="open"
            variants={{ open: { transition: { staggerChildren: 0.04 } }, closed: {} }}
          >
            {chips.map((c) => (
              <motion.li key={c.label} variants={{ closed: { opacity: 0, scale: 0.85 }, open: { opacity: 1, scale: 1 } }}>
                <ReqChip label={c.label} met={c.met} />
              </motion.li>
            ))}
          </motion.ul>
        )}
      </div>

      <div className="flex flex-col gap-1.5" style={dim("needs")}>
        <NeedsField ref={needsRef} card={card} needs={needs} tabIndex={tabIndex} />
        {onDetails && (
          <button
            type="button"
            data-nodrag
            tabIndex={tabIndex}
            onClick={onDetails}
            className="inline-flex h-8 items-center gap-1 self-start rounded-lg px-1 text-[13px] font-bold text-[#a3ada3] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c6f19d]"
          >
            <ChevronUp aria-hidden className="size-4" />
            Details
          </button>
        )}
      </div>
    </div>
  );
}
