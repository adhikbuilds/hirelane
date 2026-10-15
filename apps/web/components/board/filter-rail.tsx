import Link from "next/link";
import type { FacetCount, JobFacets } from "../../lib/queries/jobs";
import { formatCount } from "../../lib/format";
import { EMPLOYMENT_LABEL, LEVEL_LABEL, POSTED_OPTIONS, WORKPLACE_LABEL, countryName, postedLabel, roleLabel } from "./labels";
import { RailDisclosure } from "./rail-disclosure";
import { activeChips, serializeBoard, withFilter, type BoardQuery } from "./url-state";

const href = (qs: string) => (qs ? `/jobs?${qs}` : "/jobs");

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-rule py-3" aria-label={title}>
      <h2 className="mb-1 text-[13px] font-semibold text-ink-2">{title}</h2>
      {children}
    </section>
  );
}

function Option({ to, label, n, active }: { to: string; label: string; n?: number; active?: boolean }) {
  return (
    <li>
      <Link
        href={to}
        aria-current={active ? "true" : undefined}
        className={`flex min-h-8 items-center justify-between gap-2 py-1 text-[14px] leading-5 hover:text-lane ${active ? "font-semibold text-lane" : ""}`}
      >
        <span className="min-w-0 truncate">{label}</span>
        {n !== undefined ? <span className="figure shrink-0 text-[13px] text-ink-2">{formatCount(n)}</span> : null}
      </Link>
    </li>
  );
}

/** A facet whose dimension is already chosen shows the choice and Clear; otherwise each value with its drill-down count. */
function Facet({
  title, query, field, counts, label, limit = 8, order,
}: {
  title: string;
  query: BoardQuery;
  field: "role" | "country" | "workplace" | "employment" | "level";
  counts: FacetCount[];
  label: (v: string) => string;
  limit?: number;
  order?: readonly string[];
}) {
  const chosen = query.filter[field] as string | undefined;
  if (chosen) {
    return (
      <Group title={title}>
        <p className="flex items-center justify-between gap-2 text-[14px]">
          <span className="min-w-0 truncate font-semibold text-lane">{label(chosen)}</span>
          <Link href={href(withFilter(query, { [field]: undefined }))} className="shrink-0 text-[13px] text-lane underline">
            Clear
          </Link>
        </p>
      </Group>
    );
  }
  const rows = order ? [...counts].sort((a, b) => order.indexOf(a.value) - order.indexOf(b.value)) : counts;
  if (rows.length === 0) return null;
  const shown = rows.slice(0, limit);
  const rest = rows.slice(limit);
  const opt = (c: FacetCount) => (
    <Option key={c.value} to={href(withFilter(query, { [field]: c.value }))} label={label(c.value)} n={c.n} />
  );
  return (
    <Group title={title}>
      <ul>{shown.map(opt)}</ul>
      {rest.length > 0 ? (
        <details>
          <summary className="cursor-pointer py-1 text-[13px] text-lane">Show {rest.length} more</summary>
          <ul>{rest.map(opt)}</ul>
        </details>
      ) : null}
    </Group>
  );
}

function Toggle({ query, field, label, n }: { query: BoardQuery; field: "remote" | "salary" | "visa"; label: string; n: number }) {
  const on = query.filter[field] === true;
  if (!on && n === 0) return null;
  return (
    <Option to={href(withFilter(query, { [field]: on ? undefined : true }))} label={on ? `${label} (on)` : label} n={on ? undefined : n} active={on} />
  );
}

export function FilterRail({ query, facets }: { query: BoardQuery; facets: JobFacets | null }) {
  const f = query.filter;
  const hidden: [string, string][] = [];
  for (const [k, v] of new URLSearchParams(serializeBoard({ filter: { ...f, q: undefined }, page: 1, sort: query.sort }))) hidden.push([k, v]);
  const count = activeChips(query).length;

  return (
    <aside aria-label="Filters" className="lg:w-[248px] lg:shrink-0">
      <RailDisclosure summary={count > 0 ? `Filters (${count} on)` : "Filters"}>
        <form action="/jobs" method="get" role="search" className="pb-3 pt-3 lg:pt-0">
          <label htmlFor="board-q" className="mb-1 block text-[13px] font-semibold text-ink-2">
            Search
          </label>
          <div className="flex gap-2">
            <input
              id="board-q"
              name="q"
              type="search"
              defaultValue={f.q ?? ""}
              maxLength={100}
              placeholder="Title, company or skill"
              autoComplete="off"
              className="h-10 min-w-0 flex-1 border border-rule-strong bg-sheet px-2 text-[15px] placeholder:text-ink-2"
            />
            <button type="submit" className="h-10 bg-lane px-3 text-[15px] font-semibold text-white hover:bg-ink">
              Go
            </button>
          </div>
          <p className="mt-1 text-[12px] text-ink-2">Press / to search, j and k to move, Enter to open.</p>
          {hidden.map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
        </form>

        <Group title="Show only">
          <ul>
            <Toggle query={query} field="remote" label="Remote" n={facets?.remote ?? 0} />
            <Toggle query={query} field="salary" label="Pay stated" n={facets?.salary ?? 0} />
            <Toggle query={query} field="visa" label="Sponsors visas" n={facets?.visa ?? 0} />
          </ul>
        </Group>

        <Facet title="Role" query={query} field="role" counts={facets?.role ?? []} label={roleLabel} limit={8} />
        <Facet title="Country" query={query} field="country" counts={facets?.country ?? []} label={countryName} limit={8} />
        <Facet title="Workplace" query={query} field="workplace" counts={facets?.workplace ?? []} label={(v) => WORKPLACE_LABEL[v] ?? v} order={["remote", "hybrid", "onsite"]} />
        <Facet title="Type" query={query} field="employment" counts={facets?.employment ?? []} label={(v) => EMPLOYMENT_LABEL[v] ?? v} order={["fulltime", "contract", "parttime", "intern"]} />
        <Facet title="Level" query={query} field="level" counts={facets?.level ?? []} label={(v) => LEVEL_LABEL[v] ?? v} order={["intern", "entry", "mid", "experienced"]} />

        <Group title="Posted">
          <ul>
            {POSTED_OPTIONS.map((d) => (
              <Option key={d} to={href(withFilter(query, { posted: f.posted === d ? undefined : d }))} label={postedLabel(d)} active={f.posted === d} />
            ))}
          </ul>
        </Group>
      </RailDisclosure>
    </aside>
  );
}
