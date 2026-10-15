import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FilterRail } from "@/components/board/filter-rail";
import { LedgerKeys } from "@/components/board/ledger-keys";
import { Ledger } from "@/components/board/ledger";
import { EMPLOYMENT_LABEL, LEVEL_LABEL, WORKPLACE_LABEL, countryName, postedLabel, roleLabel } from "@/components/board/labels";
import {
  MAX_PAGE,
  PAGE_SIZE,
  activeChips,
  parseBoardParams,
  serializeBoard,
  withPage,
  withSort,
  type BoardQuery,
  type Chip,
  type RawParams,
} from "@/components/board/url-state";
import { withAdmin } from "@hirelane/db";
import { formatCount } from "@/lib/format";
import { facetCountFor } from "@/lib/lists-data";
import { isPublished, listForFilter } from "@/lib/lists";
import { pagesFor, searchJobs } from "@/lib/queries/jobs";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const href = (qs: string) => (qs ? `/jobs?${qs}` : "/jobs");

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = parseBoardParams((await searchParams) as RawParams);
  const qs = serializeBoard(q);
  // Only the bare ledger is indexable; every filtered, sorted or paged view is a thin variant of it.
  const list = q.page === 1 && q.sort === "fresh" ? listForFilter(q.filter) : undefined;
  if (list && isPublished(await withAdmin((db) => facetCountFor(db, list)))) {
    // The same filter as a published list: that list is the page to index.
    return { title: "Jobs", alternates: { canonical: `/lists/${list.slug}` } };
  }
  if (qs) return { title: "Jobs", robots: { index: false, follow: true }, alternates: { canonical: href(qs) } };
  return { title: "Jobs", alternates: { canonical: "/jobs" } };
}

function chipLabel(c: Chip): string {
  switch (c.key) {
    case "q": return `Search: ${c.value}`;
    case "role": return roleLabel(String(c.value));
    case "country": return countryName(String(c.value));
    case "remote": return "Remote";
    case "salary": return "Pay stated";
    case "visa": return "Sponsors visas";
    case "workplace": return WORKPLACE_LABEL[String(c.value)] ?? String(c.value);
    case "employment": return EMPLOYMENT_LABEL[String(c.value)] ?? String(c.value);
    case "level": return LEVEL_LABEL[String(c.value)] ?? String(c.value);
    case "posted": return postedLabel(Number(c.value));
    default: return String(c.value);
  }
}

function Chips({ query }: { query: BoardQuery }) {
  const chips = activeChips(query);
  if (chips.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-2 py-3" aria-label="Active filters" data-testid="jobs-chips">
      {chips.map((c) => (
        <li key={c.key}>
          <Link
            href={href(c.removeQuery)}
            aria-label={`Remove filter: ${chipLabel(c)}`}
            className="inline-flex h-8 items-center gap-2 border border-lane bg-lane-soft px-2 text-[13px] font-medium text-lane hover:bg-sheet"
          >
            {chipLabel(c)}
            <span aria-hidden="true">x</span>
          </Link>
        </li>
      ))}
      <li>
        <Link href={query.sort === "pay" ? "/jobs?sort=pay" : "/jobs"} className="text-[13px] text-lane underline">
          Clear all
        </Link>
      </li>
    </ul>
  );
}

export default async function JobsPage({ searchParams }: Props) {
  const query = parseBoardParams((await searchParams) as RawParams);
  const result = await searchJobs({ ...query, pageSize: PAGE_SIZE }, { withFacets: true });
  const { total, jobs, facets } = result;
  const pages = pagesFor(total, PAGE_SIZE);

  // Depends on live data, so a temporary redirect (never 308).
  if (query.page > pages) redirect(href(withPage(query, pages)));

  const now = new Date();
  const filtered = activeChips(query).length > 0;
  const pref = query.filter.country === "IN" ? "INR" : "USD";
  const first = total === 0 ? 0 : (query.page - 1) * PAGE_SIZE + 1;
  const last = (query.page - 1) * PAGE_SIZE + jobs.length;
  const capped = total > MAX_PAGE * PAGE_SIZE;

  return (
    <div className="mx-auto w-full max-w-page px-4 py-8 sm:px-8">
      <LedgerKeys />
      <div className="flex items-baseline justify-between border-b-2 border-rule-strong pb-2">
        <h1 className="display text-[40px]">Jobs</h1>
        <p className="figure text-[13px] text-ink-2" data-testid="jobs-count">
          {formatCount(total)} {filtered ? "match" : "open"}
        </p>
      </div>

      <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:gap-8">
        <FilterRail query={query} facets={facets} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Chips query={query} />
            <p className="ml-auto flex items-center gap-3 py-3 text-[13px]" aria-label="Sort">
              <span className="text-ink-2">Sort</span>
              <Link href={href(withSort(query, "fresh"))} aria-current={query.sort === "fresh" ? "true" : undefined} className={query.sort === "fresh" ? "font-semibold text-lane" : "text-ink-2 hover:text-lane"}>
                Freshest
              </Link>
              <Link href={href(withSort(query, "pay"))} aria-current={query.sort === "pay" ? "true" : undefined} className={query.sort === "pay" ? "font-semibold text-lane" : "text-ink-2 hover:text-lane"}>
                Highest pay
              </Link>
            </p>
          </div>

          {jobs.length === 0 ? (
            filtered ? (
              <div className="border-b border-rule py-8" data-testid="jobs-empty">
                <p className="text-[17px] font-semibold">No open jobs match these filters</p>
                <p className="mt-1 text-ink-2">
                  Remove a filter to widen the search. Matching is exact: for example, a country filter lists only jobs that name that country.
                </p>
                <p className="mt-3">
                  <Link href="/jobs" className="font-semibold text-lane underline">
                    Clear all filters
                  </Link>
                </p>
              </div>
            ) : (
              <div className="border-b border-rule py-8" data-testid="jobs-empty">
                <p className="text-[17px] font-semibold">No jobs ingested yet</p>
                <p className="mt-1 text-ink-2">Pull the first boards from their public APIs with:</p>
                <p className="mt-3 inline-block border border-rule bg-sheet px-3 py-2 text-[15px] font-semibold">pnpm ingest:run</p>
              </div>
            )
          ) : (
            <>
              <Ledger jobs={jobs} pref={pref} now={now} />
              <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2 py-4 text-[13px]">
                <p className="figure text-ink-2">
                  {formatCount(first)} to {formatCount(last)} of {formatCount(total)} (page {query.page} of {pages}, {PAGE_SIZE} per page)
                  {capped ? ` Showing the first ${formatCount(MAX_PAGE * PAGE_SIZE)} of ${formatCount(total)}. Narrow the filters to see the rest.` : ""}
                </p>
                <p className="flex gap-4 font-medium">
                  {query.page > 1 ? <Link href={href(withPage(query, query.page - 1))} rel="prev" className="text-lane">Previous</Link> : null}
                  {query.page < pages ? <Link href={href(withPage(query, query.page + 1))} rel="next" className="text-lane">Next</Link> : null}
                </p>
              </nav>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
