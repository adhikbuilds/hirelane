import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FilterRail } from "@/components/board/filter-rail";
import { LedgerKeys } from "@/components/board/ledger-keys";
import { JobBoard } from "@/components/board/job-board";
import { SearchBox } from "@/components/board/search-box";
import { toBoardRow } from "@/components/board/row-model";
import { Compass, SearchX, X } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
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
import { pagesFor, previewsFor, searchJobs } from "@/lib/queries/jobs";

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

/** Filters that already have a pressed chip in the filter bar (remote, pay, visa, 24h/7d, role) are not repeated here. */
const inQuickBar = (c: Chip): boolean =>
  c.key === "remote" || c.key === "salary" || c.key === "visa" || c.key === "role" || (c.key === "posted" && (c.value === 1 || c.value === 7));

function Chips({ query }: { query: BoardQuery }) {
  const all = activeChips(query);
  const chips = all.filter((c) => !inQuickBar(c));
  if (all.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-2" aria-label="Active filters" data-testid="jobs-chips">
      {chips.map((c) => (
        <li key={c.key}>
          <Link
            href={href(c.removeQuery)}
            aria-label={`Remove filter: ${chipLabel(c)}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-lane-100 bg-lane-50 pl-3 pr-2 text-[13px] font-bold text-lane hover:border-lane hover:bg-lane-100"
          >
            {chipLabel(c)}
            <X aria-hidden className="size-3.5" />
          </Link>
        </li>
      ))}
      <li>
        <Link href={query.sort === "pay" ? "/jobs?sort=pay" : "/jobs"} className="px-1 text-[13px] font-semibold text-ink-2 underline hover:text-lane">
          Clear all
        </Link>
      </li>
    </ul>
  );
}

function SortLinks({ query }: { query: BoardQuery }) {
  const seg = (sort: "fresh" | "pay", label: string) => (
    <Link
      href={href(withSort(query, sort))}
      aria-current={query.sort === sort ? "true" : undefined}
      className={`rounded-full px-3.5 py-1.5 text-[13px] font-bold ${query.sort === sort ? "bg-surface text-lane shadow-control" : "text-ink-2 hover:text-ink"}`}
    >
      {label}
    </Link>
  );
  return (
    <p className="flex items-center gap-1 rounded-full bg-ink/[0.06] p-1" aria-label="Sort">
      {seg("fresh", "Freshest")}
      {seg("pay", "Highest pay")}
    </p>
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
  const rows = jobs.map((j) => toBoardRow(j, pref, now));
  const firstSlug = rows[0]?.slug;
  const found = firstSlug ? await previewsFor([firstSlug]) : {};
  const initialPreviews = firstSlug ? { [firstSlug]: found[firstSlug] ?? null } : {};
  const baseQs = serializeBoard({ ...query, page: 1 });
  const carry = [...new URLSearchParams(serializeBoard({ filter: { ...query.filter, q: undefined }, page: 1, sort: query.sort }))];
  const capped = total > MAX_PAGE * PAGE_SIZE;

  return (
    <>
      <LedgerKeys />
      <section className="hero-mesh stripe-bg border-b border-line">
        <div className="mx-auto w-full max-w-page px-4 pb-8 pt-9 sm:px-8 sm:pb-10 sm:pt-12">
          <div className="flex items-end justify-between gap-x-6">
            <div>
              <p className="text-[13px] font-bold uppercase tracking-[0.1em] text-lane">Live from career sites</p>
              <h1 className="display mt-1 text-[40px] leading-[44px] sm:text-[52px] sm:leading-[56px]">Jobs</h1>
            </div>
            <p className="figure inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface/80 px-4 py-2 text-[15px] font-bold shadow-control backdrop-blur" data-testid="jobs-count">
              {formatCount(total)} {filtered ? "match" : "open"}
            </p>
          </div>
          <div className="mt-6 max-w-3xl">
            <SearchBox defaultValue={query.filter.q ?? ""} carry={carry} />
            <p className="mt-2 hidden text-[13px] text-ink-2 sm:block">Press / to search, j and k to move, Enter to open. Hover a role for pay and requirements.</p>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-page px-4 py-5 sm:px-8">
        <FilterRail query={query} facets={facets} />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {filtered ? (
            <Chips query={query} />
          ) : (
            <p className="figure text-[13.5px] text-ink-2">
              Pay is stated on {formatCount(facets?.salary ?? 0)} of {formatCount(total)} roles. Never estimated.
            </p>
          )}
          <div className="ml-auto">
            <SortLinks query={query} />
          </div>
        </div>
        {capped ? (
          <p className="figure mt-2 text-[13px] text-ink-2">
            Showing the first {formatCount(MAX_PAGE * PAGE_SIZE)} of {formatCount(total)}. Narrow the filters to see the rest.
          </p>
        ) : null}

        <div className="mt-4">
          {jobs.length === 0 ? (
            filtered ? (
              <div className="rounded-[16px] border border-line bg-surface p-8 text-center shadow-card sm:p-12" data-testid="jobs-empty">
                <SearchX aria-hidden className="mx-auto size-9 text-lane" />
                <p className="mt-3 text-[20px] font-extrabold tracking-[-0.02em]">No open jobs match these filters</p>
                <p className="mx-auto mt-1 max-w-xl text-ink-2">
                  Remove a filter to widen the search. Matching is exact: for example, a country filter lists only jobs that name that country.
                </p>
                <p className="mt-5">
                  <Link href="/jobs" className={buttonClasses("primary", "md")}>
                    Clear all filters
                  </Link>
                </p>
              </div>
            ) : (
              <div className="rounded-[16px] border border-line bg-surface p-8 text-center shadow-card sm:p-12" data-testid="jobs-empty">
                <Compass aria-hidden className="mx-auto size-9 text-lane" />
                <p className="mt-3 text-[20px] font-extrabold tracking-[-0.02em]">No jobs ingested yet</p>
                <p className="mt-1 text-ink-2">Pull the first boards from their public APIs with:</p>
                <p className="mt-3 inline-block rounded-[10px] border border-line bg-canvas px-3 py-2 text-[15px] font-bold">pnpm ingest:run</p>
              </div>
            )
          ) : (
            <JobBoard
              key={`${baseQs}|${query.page}`}
              initialRows={rows}
              initialPreviews={initialPreviews}
              total={total}
              page={query.page}
              hasMore={query.page < pages && query.page < MAX_PAGE}
              qs={baseQs}
              pageSize={PAGE_SIZE}
            />
          )}
        </div>
      </div>
    </>
  );
}
