import Link from "next/link";
import { CompanyLogo } from "../brand/CompanyLogo";
import { Marquee } from "../ui";
import { agoShort } from "./demo-model";
import type { TickerJob } from "./types";

/** The freshest jobs, looping. Each item is a plain link to its job page. */
export function Ticker({ jobs, now }: { jobs: TickerJob[]; now: Date }) {
  if (jobs.length === 0) return null;
  return (
    <section aria-labelledby="ticker-h" className="border-y border-line bg-surface py-5" data-testid="ticker">
      <div className="mx-auto mb-3 flex max-w-page items-center gap-3 px-4 sm:px-8">
        <span aria-hidden className="size-2 rounded-full bg-match shadow-[0_0_0_4px_rgb(16_185_129/0.2)]" />
        <h2 id="ticker-h" className="text-[14px] font-extrabold tracking-tight">
          Fresh off the career sites
        </h2>
        <span className="text-[13px] text-ink-3">The {jobs.length} newest postings. Hover to pause.</span>
      </div>
      <Marquee label="Newest job postings" secondsPerItem={3.2}>
        {jobs.map((j) => (
          <Link
            key={j.slug}
            href={`/job/${j.slug}`}
            data-testid="ticker-item"
            className="flex w-[320px] items-center gap-3 rounded-[14px] border border-line bg-canvas px-3.5 py-2.5 transition-[border-color,box-shadow,background-color] duration-150 hover:border-lane/40 hover:bg-surface hover:shadow-card"
          >
            <CompanyLogo name={j.company} src={j.logoPath} size={36} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-extrabold leading-5 text-ink">{j.title}</span>
              <span className="block truncate text-[13px] leading-5 text-ink-2">{j.company}</span>
            </span>
            <time dateTime={j.freshAt} className="shrink-0 text-[12px] font-bold text-lane">
              {agoShort(j.freshAt, now)}
            </time>
          </Link>
        ))}
      </Marquee>
    </section>
  );
}
