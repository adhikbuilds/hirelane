"use client";

import Link from "next/link";
import { ArrowUpRight, Check, ExternalLink, MousePointerClick, ShieldCheck } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { JobPreviewData } from "../../lib/queries/jobs";
import { CompanyLogo } from "../brand/CompanyLogo";
import { buttonClasses } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { cn } from "../ui/cn";
import { FreshDot } from "./job-row";
import { traceSummary } from "./preview-model";
import { ATS_LABEL, type BoardRow } from "./row-model";

const GROUP_TONE: Record<string, string> = {
  Read: "bg-lane-50 text-lane",
  Currency: "bg-info/10 text-[#1d4ed8]",
  Period: "bg-signal-50 text-signal-ink",
  FX: "bg-sky text-[#0369a1]",
  Check: "bg-ink/5 text-ink-2",
};

function PayBlock({ row, data, loading }: { row: BoardRow; data: JobPreviewData | null; loading: boolean }) {
  const sum = data ? traceSummary(data.trace) : null;
  return (
    <section aria-label="Pay" className="rounded-[14px] border border-line bg-canvas/70 p-4">
      <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-ink-3">Pay</p>
      {row.pay ? (
        <>
          <p className="display figure mt-1 text-[26px] leading-8 text-ink">{row.pay}</p>
          {row.payNote ? <p className="figure text-[13px] text-ink-2">Posted as {row.payNote}</p> : null}
          {loading ? (
            <div aria-hidden="true" className="mt-3 space-y-2">
              <div className="skeleton h-4 w-full rounded-md" />
              <div className="skeleton h-4 w-4/5 rounded-md" />
            </div>
          ) : sum && sum.steps.length > 0 ? (
            <div className="mt-3" data-testid="preview-trace">
              <p className="text-[12.5px] font-semibold text-ink-2">
                How it was read ({sum.steps.length} of {sum.total} steps)
              </p>
              <ol className="mt-1.5 space-y-1.5">
                {sum.steps.map((s, i) => (
                  <li key={`${s.group}-${i}`} className="flex gap-2 text-[13px] leading-5">
                    <span className={cn("mt-px inline-flex h-5 w-[4.25rem] shrink-0 items-center justify-center rounded-md text-[11.5px] font-bold", GROUP_TONE[s.group])}>
                      {s.group}
                    </span>
                    <span className="min-w-0 break-words text-ink-2">{s.label}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </>
      ) : (
        <p className="mt-1 text-[15px] text-ink-2">Not stated in the posting. Hirelane never guesses a number.</p>
      )}
    </section>
  );
}

function Requirements({ data, loading }: { data: JobPreviewData | null; loading: boolean }) {
  return (
    <section aria-label="Top requirements">
      <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-ink-3">Top requirements</p>
      {loading ? (
        <div aria-hidden="true" className="mt-2 space-y-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-4 w-full rounded-md" />
          ))}
        </div>
      ) : data && data.requirements.length > 0 ? (
        <>
          <ul className="mt-2 space-y-2" data-testid="preview-requirements">
            {data.requirements.map((r, i) => (
              <li key={i} className="flex gap-2 text-[14px] leading-5">
                <Check aria-hidden className={cn("mt-0.5 size-4 shrink-0", r.kind === "must" ? "text-match" : "text-ink-3")} />
                <span className="min-w-0 break-words">
                  <span className="line-clamp-3" title={r.text}>{r.text}</span>
                  <span className="block text-[12px] text-ink-3">
                    {r.kind === "must" ? "must have" : "nice to have"}
                    {r.yearsMin !== null ? `, ${r.yearsMin}+ yrs` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {data.requirementsTotal > data.requirements.length ? (
            <p className="mt-2 text-[12.5px] text-ink-3">{data.requirementsTotal - data.requirements.length} more on the full posting.</p>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-[14px] text-ink-3">
          {data ? "No requirements could be read from this posting." : "Details are not available for this job right now. The full posting still opens."}
        </p>
      )}
    </section>
  );
}

/** The right-hand preview: no navigation, just the facts a person needs to decide whether to open the job. */
export function PreviewPanel({ row, data, loading }: { row: BoardRow | null; data: JobPreviewData | null; loading: boolean }) {
  const reduce = useReducedMotion();
  if (!row) {
    return (
      <div className="grid min-h-[360px] place-items-center rounded-[16px] border border-dashed border-line bg-surface/60 p-8 text-center" data-testid="job-preview-empty">
        <div>
          <MousePointerClick aria-hidden className="mx-auto size-7 text-lane" />
          <p className="mt-3 text-[16px] font-bold">Hover or focus a role</p>
          <p className="mt-1 text-[14px] text-ink-2">Pay, requirements and the employer link show here. Nothing opens until you click.</p>
        </div>
      </div>
    );
  }
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.article
        key={row.slug}
        data-testid="job-preview"
        data-slug={row.slug}
        aria-label={`Preview: ${row.title} at ${row.company.name}`}
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduce ? { opacity: 1 } : { opacity: 0, y: -4 }}
        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        className="rounded-[16px] border border-line bg-surface shadow-card"
      >
        <header className="flex gap-3.5 border-b border-line p-5">
          <CompanyLogo name={row.company.name} src={row.company.logoPath} size={52} />
          <div className="min-w-0">
            <h2 className="display text-[22px] leading-7" data-testid="preview-title">
              {row.title}
            </h2>
            <p className="mt-0.5 text-[14.5px] text-ink-2">
              <Link href={`/company/${row.company.slug}`} className="font-semibold hover:text-lane hover:underline">
                {row.company.name}
              </Link>
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {row.chips.map((c) => (
                <Chip key={c} className="h-6 px-2 text-[12.5px]">
                  {c}
                </Chip>
              ))}
              <FreshDot fresh={row.fresh} age={row.age} at={row.freshAt} />
            </div>
          </div>
        </header>
        <div className="space-y-5 p-5">
          <PayBlock row={row} data={data} loading={loading} />
          <Requirements data={data} loading={loading} />
          {row.skills.length > 0 ? (
            <div className="flex flex-wrap gap-1.5" aria-label="Skills">
              {row.skills.map((s) => (
                <Chip key={s} tone="lane" className="h-6 px-2 text-[12.5px]">
                  {s}
                </Chip>
              ))}
            </div>
          ) : null}
        </div>
        <footer className="space-y-3 border-t border-line bg-canvas/60 p-5">
          <div className="flex flex-wrap gap-2">
            {data?.applyUrl ? (
              <a
                href={data.applyUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                data-testid="preview-apply"
                className={buttonClasses("primary", "md", "flex-1")}
              >
                Apply on employer site
                <ExternalLink aria-hidden className="size-4" />
              </a>
            ) : (
              <span
                aria-disabled="true"
                className={buttonClasses("secondary", "md", "flex-1")}
                title={loading ? "Loading the employer link" : "The employer link is not available"}
              >
                {loading ? "Finding the employer link" : "Employer link unavailable"}
              </span>
            )}
            <Link href={`/job/${row.slug}`} className={buttonClasses("secondary", "md")}>
              Full posting
              <ArrowUpRight aria-hidden className="size-4" />
            </Link>
          </div>
          <p className="flex items-start gap-1.5 text-[12.5px] leading-[18px] text-ink-3">
            <ShieldCheck aria-hidden className="mt-px size-3.5 shrink-0" />
            Opens the employer&apos;s own posting{ATS_LABEL[row.ats] ? ` (hosted on ${ATS_LABEL[row.ats]})` : ""} in a new tab. Hirelane sends nothing from this page.
          </p>
        </footer>
      </motion.article>
    </AnimatePresence>
  );
}
