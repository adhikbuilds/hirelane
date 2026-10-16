"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, FileSearch, Globe } from "lucide-react";
import Link from "next/link";
import { CompanyLogo } from "../brand/CompanyLogo";
import { Card, Chip, CountUp, Reveal, cn } from "../ui";
import { SectionHeading } from "./section-heading";
import type { TraceDemo } from "./types";

const GROUP_TONE = { Read: "lane", Currency: "info", Period: "info", Check: "neutral", Convert: "signal" } as const;

function Excerpt({ trace, activeId }: { trace: TraceDemo; activeId: string }) {
  const reduce = useReducedMotion();
  const step = trace.steps.find((s) => s.id === activeId);
  const span = step?.span ?? null;
  const { excerpt } = trace;
  const before = span ? excerpt.slice(0, span.start) : excerpt;
  const quote = span ? excerpt.slice(span.start, span.end) : "";
  const after = span ? excerpt.slice(span.end) : "";
  return (
    <div className="rounded-[14px] border border-line bg-canvas p-4" data-testid="trace-source">
      <p className="mb-2 flex items-center gap-1.5 text-[12px] font-extrabold tracking-[0.02em] text-ink-3">
        <FileSearch aria-hidden className="size-3.5" /> From the posting
      </p>
      <p className="whitespace-pre-wrap break-words text-[14px] leading-[23px] text-ink-2">
        {trace.clippedStart && <span className="text-ink-3">…</span>}
        {before}
        {span && (
          <motion.mark
            key={activeId}
            data-testid="trace-highlight"
            initial={reduce ? false : { backgroundColor: "rgb(250 204 21 / 0)" }}
            animate={{ backgroundColor: "rgb(250 204 21 / 0.7)" }}
            transition={{ duration: reduce ? 0 : 0.35 }}
            className="rounded-[4px] px-0.5 font-bold text-ink [box-decoration-break:clone]"
          >
            {quote}
          </motion.mark>
        )}
        {after}
        {trace.clippedEnd && <span className="text-ink-3">…</span>}
      </p>
      {!span && (
        <p className="mt-3 flex items-start gap-2 rounded-[10px] bg-sky px-3 py-2 text-[13px] font-semibold text-[#1e3a8a]" data-testid="trace-nospan">
          <Globe aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>This step uses no text from the posting{trace.fxDate ? `: it applies the rate table of ${trace.fxDate}.` : "."}</span>
        </p>
      )}
    </div>
  );
}

export function SalaryTruth({ trace, withSalary, openJobs }: { trace: TraceDemo | null; withSalary: number; openJobs: number }) {
  const first = trace?.steps.find((s) => s.span)?.id ?? trace?.steps[0]?.id ?? "";
  const [activeId, setActiveId] = useState(first);
  const pct = openJobs > 0 ? Math.round((withSalary / openJobs) * 100) : 0;

  return (
    <section id="salary" aria-labelledby="salary-h" className="scroll-mt-16 bg-surface py-16 sm:py-24" data-testid="salary-truth">
      <div className="mx-auto grid max-w-page grid-cols-[minmax(0,1fr)] gap-12 px-4 sm:px-8 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:gap-16">
        <Reveal className="lg:sticky lg:top-24 lg:self-start">
          <SectionHeading eyebrow="Salary truth" title="Pay, with the working shown" id="salary-h">
            Hirelane reads pay out of the posting itself and shows you the exact words it used. If a posting does not say, you see
            &ldquo;not stated&rdquo;. It never guesses, and it never calls missing pay unpaid.
          </SectionHeading>
          <Card className="mt-8" data-testid="salary-stat">
            <p className="text-[56px] font-extrabold leading-none tracking-tight text-lane sm:text-[64px]">
              <CountUp value={pct} suffix="%" />
            </p>
            <p className="mt-2 text-[16px] font-bold">Salary shown on {pct}% of jobs</p>
            <p className="mt-1 text-[14px] text-ink-2">
              {withSalary.toLocaleString("en-US")} of {openJobs.toLocaleString("en-US")} open roles state a pay figure.
            </p>
          </Card>
        </Reveal>

        <Reveal delay={0.1}>
          {trace ? (
            <Card className="p-0 sm:p-0" data-testid="trace-card">
              <div className="flex flex-wrap items-center gap-3.5 border-b border-line p-5">
                <CompanyLogo name={trace.company} size={44} />
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-[17px] font-extrabold tracking-tight">{trace.title}</p>
                  <p className="truncate text-[14px] text-ink-2">{trace.company}</p>
                </div>
                <div className="w-full sm:w-auto sm:text-right">
                  <p className="text-[24px] font-extrabold leading-7 tracking-tight text-lane" data-testid="trace-headline">
                    {trace.headline}
                  </p>
                  <Link href={`/job/${trace.slug}`} className="inline-flex items-center gap-0.5 text-[13px] font-bold text-ink-2 hover:text-lane">
                    Open this job <ArrowUpRight aria-hidden className="size-3.5" />
                  </Link>
                </div>
              </div>
              <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                <div>
                  <p className="mb-2 text-[13px] font-extrabold text-ink-2">How it was worked out. Click a step.</p>
                  <ol className="grid gap-1.5" data-testid="trace-steps">
                    {trace.steps.map((s, i) => {
                      const on = s.id === activeId;
                      return (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => setActiveId(s.id)}
                            aria-pressed={on}
                            data-testid="trace-step"
                            data-has-span={s.span ? "true" : "false"}
                            className={cn(
                              "flex w-full items-start gap-2.5 rounded-[12px] border px-3 py-2 text-left transition-[border-color,background-color,box-shadow] duration-150",
                              on ? "border-signal bg-signal-50 shadow-control" : "border-line bg-surface hover:border-lane/40 hover:bg-lane-50/60",
                            )}
                          >
                            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-ink/10 text-[11px] font-extrabold tabular-nums">{i + 1}</span>
                            <span className="min-w-0 flex-1">
                              <Chip tone={GROUP_TONE[s.group]} className="mb-1 h-5 px-2 text-[11px]">
                                {s.group}
                              </Chip>
                              <span className="block break-words text-[13px] leading-[19px] font-semibold text-ink">{s.label}</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </div>
                <div className="order-first md:sticky md:top-24 md:order-none md:self-start">
                  <Excerpt trace={trace} activeId={activeId} />
                  <p className="mt-3 text-[12px] leading-[18px] text-ink-3">
                    A real posting from today&apos;s feed. Conversions use a dated rate table
                    {trace.fxDate ? ` (${trace.fxDate})` : ""}, shown beside every converted figure.
                  </p>
                </div>
              </div>
            </Card>
          ) : (
            <Card>
              <p className="font-extrabold">The pay trace appears once a posting with stated pay has been ingested.</p>
            </Card>
          )}
        </Reveal>
      </div>
    </section>
  );
}
