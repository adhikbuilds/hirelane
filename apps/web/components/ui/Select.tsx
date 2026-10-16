import { forwardRef, useId, type ReactNode, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "./cn";

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & {
  label: string;
  options: SelectOption[];
  /** Visually hide the label (it stays in the accessibility tree). */
  hideLabel?: boolean;
  error?: string;
  hint?: ReactNode;
  tone?: "light" | "dark";
};

/** A labelled native select: full keyboard and screen-reader support for free, styled to the v2 controls. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, options, hideLabel, error, hint, tone = "light", className, id, ...rest },
  ref,
) {
  const auto = useId();
  const sid = id ?? auto;
  const descId = `${sid}-desc`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={sid} className={cn("text-[13px] font-bold", tone === "dark" ? "text-white/80" : "text-ink-2", hideLabel && "sr-only")}>
        {label}
      </label>
      <div className="relative">
        <select
          ref={ref}
          id={sid}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? descId : undefined}
          className={cn(
            "h-11 w-full appearance-none rounded-[12px] border pl-3.5 pr-10 text-[15px] font-semibold shadow-control",
            "transition-[border-color,box-shadow] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lane",
            "disabled:cursor-not-allowed disabled:opacity-50",
            tone === "dark"
              ? "border-white/15 bg-white/10 text-white hover:border-white/30 [&>option]:text-ink"
              : "border-line bg-surface text-ink hover:border-lane/40",
            error && "border-miss",
          )}
          {...rest}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden className={cn("pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2", tone === "dark" ? "text-white/70" : "text-ink-3")} />
      </div>
      {(error || hint) && (
        <p id={descId} className={cn("text-[13px]", error ? "font-semibold text-[#b91c1c]" : "text-ink-3")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
});
