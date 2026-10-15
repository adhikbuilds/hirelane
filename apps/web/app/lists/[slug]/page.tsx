import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { withAdmin } from "@hirelane/db";
import { SourceBadge } from "../../source-badge";
import { formatAge, formatCount } from "@/lib/format";
import { facetCountFor, latestSuccessfulRunAt } from "@/lib/lists-data";
import { listBySlug, listRobots, type ListDef } from "@/lib/lists";
import { appOrigin, searchJobs } from "@/lib/queries/jobs";

// ISR: no searchParams, no paging. Pages build on first request.
export const revalidate = 300;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ slug: string }> };

async function load(def: ListDef) {
  const [n, ranAt, res] = await Promise.all([
    withAdmin((db) => facetCountFor(db, def)),
    withAdmin((db) => latestSuccessfulRunAt(db)),
    searchJobs({ filter: def.filter, page: 1, pageSize: 50, sort: "fresh" }),
  ]);
  return { n, ranAt, res };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const def = listBySlug((await params).slug);
  if (!def) return { title: "List not found", robots: { index: false, follow: false } };
  const n = await withAdmin((db) => facetCountFor(db, def));
  return {
    title: def.name,
    description: `${def.name}: open jobs from public company boards, with pay where the posting states it.`,
    // Always the list's own URL. Lists below the threshold stay reachable but are not indexed.
    alternates: { canonical: `${appOrigin()}/lists/${def.slug}` },
    robots: listRobots(n),
  };
}

export default async function ListPage({ params }: Props) {
  const def = listBySlug((await params).slug);
  if (!def) notFound();
  const { n, ranAt, res } = await load(def);
  const age = ranAt ? formatAge(ranAt) : null;

  return (
    <div className="mx-auto w-full max-w-page px-4 sm:px-8 py-8">
      <p className="text-[13px] text-ink-3">
        <Link href="/lists" className="hover:text-lane hover:underline">
          Job lists
        </Link>
      </p>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-rule-strong pb-2">
        <h1 className="display text-[32px] sm:text-[40px]" data-testid="list-title">
          {def.name}
        </h1>
        <p className="figure text-[13px] text-ink-2" data-testid="list-count">
          {formatCount(res.total)} open{age ? `, refreshed ${age} ago` : ""}
        </p>
      </div>

      {res.jobs.length === 0 ? (
        <div className="border-b border-rule py-8" data-testid="list-empty">
          <p className="text-[17px] font-semibold">No open jobs match this list right now</p>
          <p className="mt-1 text-ink-2">
            Jobs appear here as boards are refreshed. <Link href="/jobs" className="text-lane underline">Browse all jobs</Link>.
          </p>
        </div>
      ) : (
        <>
          <table className="w-full text-left" data-testid="list-ledger">
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
              {res.jobs.map((j) => {
                const where = [j.countries.join(", "), j.workplace].filter(Boolean).join(" · ");
                return (
                  <tr key={j.slug} className="h-11 border-b border-rule align-middle">
                    <td className="num pr-3 text-ink-2">{formatAge(new Date(j.freshAt))}</td>
                    <td className="py-1 pr-3">
                      <Link href={`/job/${j.slug}`} className="block font-medium hover:text-lane hover:underline">
                        {j.title}
                      </Link>
                      <span className="block text-[13px] text-ink-2">{j.company.name}</span>
                      <span className="block text-[13px] text-ink-3 sm:hidden">{where || "Not stated"}</span>
                    </td>
                    <td className="hidden pr-3 sm:table-cell">{where || <span className="text-ink-3">Not stated</span>}</td>
                    <td className="num hidden pr-3 md:table-cell">
                      {j.salary?.display ?? <span className="text-ink-3">Not stated</span>}
                    </td>
                    <td>
                      <SourceBadge ats={j.ats} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="figure flex items-center justify-between py-4 text-[13px] text-ink-2">
            <span>
              Showing {formatCount(res.jobs.length)} of {formatCount(res.total)}
            </span>
            <Link href={def.jobsHref} className="font-medium text-lane" data-testid="list-see-all">
              See all {formatCount(res.total)} on the jobs ledger
            </Link>
          </p>
        </>
      )}
      {n < 20 ? (
        <p className="text-[13px] text-ink-3" data-testid="list-thin">
          Fewer than 20 open jobs match, so this list is not indexed by search engines.
        </p>
      ) : null}
    </div>
  );
}
