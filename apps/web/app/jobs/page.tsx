import type { Metadata } from "next";
import Link from "next/link";
import { SourceBadge } from "../source-badge";
import { formatAge, formatCount } from "@/lib/format";
import { getPostingsPage } from "@/lib/ingest-data";
import { PAGE_SIZE, pageOffset, parsePage, totalPages } from "@/lib/ledger";
import { payOriginal } from "@/lib/pay";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Jobs" };

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const page = parsePage((await searchParams).page);
  const { rows, total } = await getPostingsPage(page);
  const pages = totalPages(total);
  const first = total === 0 ? 0 : pageOffset(page) + 1;
  const last = pageOffset(page) + rows.length;

  return (
    <div className="mx-auto w-full max-w-page px-4 sm:px-8 py-8">
      <div className="flex items-baseline justify-between border-b-2 border-rule-strong pb-2">
        <h1 className="display text-[40px]">Jobs</h1>
        <p className="figure text-[13px] text-ink-2" data-testid="jobs-count">
          {formatCount(total)} open
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="border-b border-rule py-8" data-testid="jobs-empty">
          <p className="text-[17px] font-semibold">No jobs ingested yet</p>
          <p className="mt-1 text-ink-2">Pull the first boards from their public APIs with:</p>
          <p className="mt-3 inline-block border border-rule bg-sheet px-3 py-2 text-[15px] font-semibold">
            pnpm ingest:run
          </p>
        </div>
      ) : (
        <>
          <table className="w-full text-left" data-testid="jobs-ledger">
            <thead className="text-[13px] text-ink-3">
              <tr className="border-b border-rule">
                <th className="w-16 py-2 pr-3 font-medium">Fresh</th>
                <th className="py-2 pr-3 font-medium">Role and company</th>
                <th className="hidden py-2 pr-3 font-medium sm:table-cell">Where</th>
                <th className="hidden py-2 pr-3 font-medium md:table-cell">Pay</th>
                <th className="w-14 py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => {
                const pay = payOriginal(j.raw);
                return (
                  <tr key={j.id} className="h-11 border-b border-rule align-middle">
                    <td className="num pr-3 text-ink-2">{formatAge(j.postedAt)}</td>
                    <td className="py-1 pr-3">
                      <span className="block font-medium">{j.title}</span>
                      <span className="block text-[13px] text-ink-2">{j.company}</span>
                      <span className="block text-[13px] text-ink-3 sm:hidden">{j.where ?? "Not stated"}</span>
                    </td>
                    <td className="hidden pr-3 sm:table-cell">{j.where ?? <span className="text-ink-3">Not stated</span>}</td>
                    <td className="num hidden pr-3 md:table-cell">
                      {pay ?? <span className="text-ink-3">Not stated</span>}
                    </td>
                    <td>
                      <SourceBadge ats={j.ats} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <nav aria-label="Pages" className="flex items-center justify-between py-4 text-[13px]">
            <p className="figure text-ink-2">
              {formatCount(first)} to {formatCount(last)} of {formatCount(total)} (page {page} of {pages}, {PAGE_SIZE} per
              page)
            </p>
            <p className="flex gap-4 font-medium">
              {page > 1 ? (
                <Link href={`/jobs?page=${page - 1}`} className="text-lane">
                  Previous
                </Link>
              ) : null}
              {page < pages ? (
                <Link href={`/jobs?page=${page + 1}`} className="text-lane">
                  Next
                </Link>
              ) : null}
            </p>
          </nav>
        </>
      )}
    </div>
  );
}
