"use client";

import Link from "next/link";
import { useState } from "react";
import type { TraceDemo } from "../../landing/types";
import { cn } from "@/lib/utils";

/** Splits the excerpt around the active span. Spans are clamped, so a bad range can never throw. */
export function splitExcerpt(text: string, span: { start: number; end: number } | null): [string, string, string] {
  if (!span) return [text, "", ""];
  const s = Math.max(0, Math.min(text.length, span.start));
  const e = Math.max(s, Math.min(text.length, span.end));
  return [text.slice(0, s), text.slice(s, e), text.slice(e)];
}

export function PayTrace({ trace }: { trace: TraceDemo }) {
  const firstWithSpan = trace.steps.find((s) => s.span)?.id ?? trace.steps[0]?.id ?? null;
  const [active, setActive] = useState<string | null>(firstWithSpan);
  const step = trace.steps.find((s) => s.id === active) ?? null;
  const [before, mid, after] = splitExcerpt(trace.excerpt, step?.span ?? null);

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,15rem)_1fr]" data-testid="pay-trace">
      <ol className="flex flex-col gap-1.5" aria-label="How the pay was worked out">
        {trace.steps.map((s, i) => {
          const on = s.id === active;
          return (
            <li key={s.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => setActive(s.id)}
                data-step={s.id}
                className={cn(
                  "flex min-h-11 w-full cursor-pointer items-start gap-3 rounded-[14px] px-3 py-2 text-left outline-none transition-[background-color,box-shadow,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.985]",
                  on ? "bg-card shadow-[0_6px_18px_-8px_rgb(19_32_26/.3)] ring-1 ring-primary/40" : "hover:bg-card/70",
                )}
              >
                <span aria-hidden className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-extrabold tabular-nums", on ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground")}>
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[12px] font-bold uppercase leading-4 tracking-[0.06em] text-muted-foreground">{s.group}</span>
                  <span className="block text-[14px] font-semibold leading-5">{s.label}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <article className="rounded-[22px] bg-card p-5 shadow-[0_1px_2px_rgb(19_32_26/.06),0_24px_48px_-24px_rgb(19_32_26/.3)] ring-1 ring-black/5">
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-black/10 pb-3">
          <p className="min-w-0 text-[14px] font-semibold leading-5">
            {trace.title} <span className="text-muted-foreground">· {trace.company}</span>
          </p>
          <p className="text-[18px] font-extrabold leading-6 text-primary" data-testid="trace-headline">{trace.headline}</p>
        </header>
        <p className="mt-4 text-[15px] leading-[26px] text-foreground/85" data-testid="trace-excerpt">
          {trace.clippedStart && <span aria-hidden>… </span>}
          {before}
          {mid && (
            <mark data-testid="trace-mark" className="rounded-[6px] bg-[var(--lime)] px-1 py-0.5 font-bold text-[var(--ink)] shadow-[0_0_0_2px_var(--lime)]">
              {mid}
            </mark>
          )}
          {after}
          {trace.clippedEnd && <span aria-hidden> …</span>}
        </p>
        <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted-foreground">
          <span>{step && !step.span ? "A rule check. No source words." : "Words from the posting."}</span>
          <Link href={`/job/${trace.slug}`} className="rounded-[8px] font-bold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2">
            Open the posting
          </Link>
        </footer>
      </article>
    </div>
  );
}
