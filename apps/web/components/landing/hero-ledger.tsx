import Link from "next/link";
import { SourceBadge } from "@/app/source-badge";
import { formatAge } from "@/lib/format";
import type { LandingData } from "./data";
import { ledgerCaption } from "./model";

/** The live ledger of the freshest jobs. Server-rendered; every figure comes from the database. */
export function HeroLedger({ data, now }: { data: LandingData; now: Date }) {
  const { jobs, refreshedAt, boards } = data;
  return (
    <section aria-labelledby="ledger-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-b-2 border-rule-strong pb-2">
        <h2 id="ledger-title" className="text-[17px] font-semibold">
          Freshest jobs
        </h2>
        <p className="figure text-[13px] text-ink-2" data-testid="ledger-caption">
          {ledgerCaption(refreshedAt, boards, now)}
        </p>
      </div>

      {jobs.length === 0 ? (
        <div className="border-b border-rule py-8" data-testid="ledger-empty">
          <p className="text-[17px] font-semibold">No jobs ingested yet</p>
          <p className="mt-1 text-ink-2">Pull the first boards from their public APIs with:</p>
          <p className="mt-3 inline-block border border-rule bg-sheet px-3 py-2 text-[15px] font-semibold">
            pnpm ingest:run
          </p>
        </div>
      ) : (
        <>
          <table className="w-full text-left" data-testid="landing-ledger">
            <thead className="text-[13px] text-ink-3">
              <tr className="border-b border-rule">
                <th className="w-14 py-2 pr-3 font-medium">Fresh</th>
                <th className="py-2 pr-3 font-medium">Role and company</th>
                <th className="hidden py-2 pr-3 font-medium sm:table-cell">Where</th>
                <th className="hidden py-2 pr-3 font-medium md:table-cell">Pay</th>
                <th className="w-14 py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.slug} className="h-11 border-b border-rule align-middle">
                  <td className="num pr-3 text-ink-2">{formatAge(j.freshAt, now)}</td>
                  <td className="py-1 pr-3">
                    <Link href={`/job/${j.slug}`} className="block font-medium hover:text-lane hover:underline">
                      {j.title}
                    </Link>
                    <span className="block text-[13px] text-ink-2">{j.company}</span>
                    <span className="block text-[13px] text-ink-3 sm:hidden">{j.where}</span>
                  </td>
                  <td className="hidden pr-3 sm:table-cell">{j.where}</td>
                  <td className="num hidden pr-3 md:table-cell">
                    {j.pay ?? <span className="text-ink-3">Not stated</span>}
                  </td>
                  <td>{j.ats ? <SourceBadge ats={j.ats} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="py-3 text-[13px]">
            <Link href="/jobs" className="font-medium text-lane hover:underline">
              Open the full ledger
            </Link>
          </p>
        </>
      )}
    </section>
  );
}
