import Link from "next/link";
import { SourceBadge } from "../../app/source-badge";
import { formatAge } from "../../lib/format";
import type { PublicJob } from "../../lib/queries/jobs";
import { Logo16 } from "./logo";
import { whereSummary } from "./locations";
import { payColumn } from "./pay";

const STALE_AFTER_MS = 7 * 24 * 3_600_000;

function Fresh({ at, now }: { at: string; now: Date }) {
  const d = new Date(at);
  const stale = now.getTime() - d.getTime() > STALE_AFTER_MS;
  return (
    <time dateTime={at} title={d.toUTCString()} className={stale ? "text-ink-3" : "text-ink-2"}>
      {formatAge(d, now)}
    </time>
  );
}

function Pay({ job, pref }: { job: PublicJob; pref: "USD" | "INR" }) {
  const p = payColumn(job.salary, pref);
  if (!p) return <span className="text-ink-2">Not stated</span>;
  return (
    <>
      <span
        className="block leading-5"
        title={p.converted && job.salary?.fxDate ? `Converted at the ${job.salary.fxDate} rates` : undefined}
      >
        {p.main}
      </span>
      {p.original ? <span className="block text-[12px] leading-4 text-ink-2">{p.original}</span> : null}
    </>
  );
}

function Where({ job }: { job: PublicJob }) {
  const w = whereSummary(job);
  if (!w.primary && !w.workplace) return <span className="text-ink-2">Not stated</span>;
  return (
    <span title={w.detail ?? undefined}>
      <span className="block truncate leading-5">
        {w.primary ?? <span className="text-ink-2">Not stated</span>}
        {w.more > 0 ? <span className="text-ink-2"> +{w.more}</span> : null}
      </span>
      {w.workplace ? <span className="block text-[12px] leading-4 text-ink-2">{w.workplace}</span> : null}
    </span>
  );
}

/** The ledger: 44px rows from sm up, two stacked lines below. Rows expose their link as [data-row-link] for j/k. */
export function Ledger({
  jobs,
  pref,
  showCompany = true,
  now,
  testId = "jobs-ledger",
}: {
  jobs: PublicJob[];
  pref: "USD" | "INR";
  showCompany?: boolean;
  now: Date;
  testId?: string;
}) {
  return (
    <table className="w-full table-fixed text-left" data-testid={testId}>
      <thead className="text-[13px] text-ink-2">
        <tr className="border-b border-rule">
          <th className="w-12 py-2 pr-3 font-medium">Fresh</th>
          <th className="py-2 pr-3 font-medium">{showCompany ? "Role and company" : "Role"}</th>
          <th className="hidden w-48 py-2 pr-3 font-medium sm:table-cell">Where</th>
          <th className="hidden w-40 py-2 pr-3 font-medium md:table-cell">Pay</th>
          <th className="w-12 py-2 font-medium">Source</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((j) => {
          const w = whereSummary(j);
          return (
            <tr key={j.slug} className="border-b border-rule align-middle hover:bg-lane-soft focus-within:bg-lane-soft sm:h-11">
              <td className="figure py-1 pr-3 align-top sm:align-middle">
                <Fresh at={j.freshAt} now={now} />
              </td>
              <td className="min-w-0 py-[3px] pr-3">
                <Link
                  href={`/job/${j.slug}`}
                  data-row-link
                  className="block truncate text-[15px] font-medium leading-5 hover:text-lane hover:underline"
                >
                  {j.title}
                </Link>
                <span className="flex items-center gap-1.5 text-[13px] leading-4 text-ink-2">
                  {showCompany ? (
                    <Link href={`/company/${j.company.slug}`} className="flex min-w-0 items-center gap-1.5 hover:text-lane">
                      <Logo16 name={j.company.name} src={j.company.logoUrl} />
                      <span className="truncate">{j.company.name}</span>
                    </Link>
                  ) : null}
                  <span className="figure min-w-0 truncate sm:hidden">
                    {(showCompany ? "· " : "") +
                      ([w.primary ?? w.workplace, payColumn(j.salary, pref)?.main].filter(Boolean).join(" · ") || "Place and pay not stated")}
                  </span>
                </span>
              </td>
              <td className="hidden pr-3 text-[14px] sm:table-cell">
                <Where job={j} />
              </td>
              <td className="figure hidden pr-3 text-[14px] md:table-cell">
                <Pay job={j} pref={pref} />
              </td>
              <td className="align-top sm:align-middle">
                <SourceBadge ats={j.ats} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
