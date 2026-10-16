import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type ChipTone = "neutral" | "lane" | "signal" | "match" | "miss" | "info";

const tones: Record<ChipTone, string> = {
  neutral: "bg-ink/5 text-ink-2 border-line",
  lane: "bg-lane-50 text-lane border-lane-100",
  signal: "bg-signal-50 text-signal-ink border-signal/60",
  match: "bg-match/10 text-[#047857] border-match/30",
  miss: "bg-miss-50 text-[#b91c1c] border-miss/25",
  info: "bg-info/10 text-[#1d4ed8] border-info/25",
};

type Common = { tone?: ChipTone; icon?: ReactNode; className?: string; children: ReactNode };

/** Static label chip. */
export function Chip({ tone = "neutral", icon, className, children }: Common) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[13px] font-semibold leading-none tabular-nums",
        tones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** Toggle chip for filters: a button with aria-pressed and an optional count. */
export function ChipButton({
  selected = false,
  count,
  icon,
  className,
  children,
  type = "button",
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & Common & { selected?: boolean; count?: number }) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[14px] font-semibold leading-none tabular-nums",
        "transition-[background-color,color,border-color,box-shadow] duration-150 ease-out disabled:opacity-50",
        selected
          ? "border-lane bg-lane text-white shadow-control"
          : "border-line bg-surface text-ink-2 hover:border-lane/40 hover:bg-lane-50 hover:text-lane",
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
      {count !== undefined && (
        <span className={cn("text-[12px] font-bold", selected ? "text-white/75" : "text-ink-3")}>{count.toLocaleString("en-US")}</span>
      )}
    </button>
  );
}
