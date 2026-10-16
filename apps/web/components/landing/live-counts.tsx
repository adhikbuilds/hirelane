import { CountUp } from "../ui";
import { formatAgeLong } from "./model";
import { asOfLabel } from "./demo-model";
import type { LandingCounts } from "./types";

/** Live numbers from the database with their as-of time. Server-rendered at the true value; the count-up is cosmetic. */
export function LiveCounts({ counts, now }: { counts: LandingCounts; now: Date }) {
  const asOf = asOfLabel(counts.asOf);
  const age = counts.asOf ? formatAgeLong(new Date(counts.asOf), now) : null;
  const items = [
    { n: counts.openJobs, label: "open roles", id: "open" },
    { n: counts.companies, label: "companies", id: "companies" },
    { n: counts.withSalary, label: "with salary shown", id: "salary" },
  ];
  return (
    <div data-testid="live-counts" className="mt-8">
      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        {items.map((it) => (
          <div key={it.id} className="flex flex-col-reverse">
            <dt className="text-[13px] font-semibold text-ink-3">{it.label}</dt>
            <dd className="text-[28px] font-extrabold leading-8 tracking-tight text-ink sm:text-[32px] sm:leading-9">
              <CountUp value={it.n} />
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 flex items-center gap-2 text-[13px] text-ink-3" data-testid="as-of">
        <span aria-hidden className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-match/60 motion-reduce:hidden" />
          <span className="relative inline-flex size-2 rounded-full bg-match" />
        </span>
        {asOf && age ? (
          <span>
            Updated {age} ago, as of {asOf}. Refreshed every six hours.
          </span>
        ) : (
          <span>No completed ingest run yet.</span>
        )}
      </p>
    </div>
  );
}
