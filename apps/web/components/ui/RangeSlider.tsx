"use client";

import { useId } from "react";
import * as Slider from "@radix-ui/react-slider";
import { cn } from "./cn";

export type RangeSliderProps = {
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Text for the current value shown at the top right; defaults to the number. */
  format?: (value: number) => string;
  disabled?: boolean;
  tone?: "light" | "dark";
  className?: string;
};

/** Single-thumb slider on Radix: keyboard (arrows, Home/End, PageUp/Down) and pointer, with the value shown live. */
export function RangeSlider({ label, value, onValueChange, min = 0, max = 100, step = 1, format, disabled, tone = "light", className }: RangeSliderProps) {
  const id = useId();
  const dark = tone === "dark";
  return (
    <div className={cn("w-full", className)}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <label id={`${id}-label`} className={cn("text-[13px] font-bold", dark ? "text-white/80" : "text-ink-2")}>
          {label}
        </label>
        <output htmlFor={id} className={cn("text-[20px] font-extrabold tabular-nums tracking-tight", dark ? "text-white" : "text-ink")}>
          {format ? format(value) : value}
        </output>
      </div>
      <Slider.Root
        value={[value]}
        onValueChange={([v]) => v !== undefined && onValueChange(v)}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className={cn("relative flex h-6 w-full touch-none select-none items-center", disabled && "opacity-50")}
      >
        <Slider.Track className={cn("relative h-2 grow overflow-hidden rounded-full", dark ? "bg-white/15" : "bg-line")}>
          <Slider.Range className={cn("absolute h-full rounded-full", dark ? "bg-match" : "bg-lane")} />
        </Slider.Track>
        <Slider.Thumb
          id={id}
          aria-labelledby={`${id}-label`}
          className={cn(
            "block size-6 rounded-full border-2 bg-surface shadow-[0_2px_8px_rgb(15_31_26/.3)] transition-transform duration-150 ease-out",
            "hover:scale-110 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2",
            dark ? "border-match focus-visible:outline-match" : "border-lane focus-visible:outline-lane",
          )}
        />
      </Slider.Root>
    </div>
  );
}
