import Link from "next/link";
import { Check, X } from "lucide-react";
import type { FacetCount, JobFacets } from "../../lib/queries/jobs";
import { formatCount } from "../../lib/format";
import { cn } from "../ui/cn";
import { AllFilters } from "./all-filters";
import { EMPLOYMENT_LABEL, LEVEL_LABEL, WORKPLACE_LABEL, countryName, postedLabel, roleLabel } from "./labels";
import { activeChips, withFilter, type BoardQuery } from "./url-state";

const href = (qs: string) => (qs ? `/jobs?${qs}` : "/jobs");

const CHIP =
  "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[14px] font-semibold leading-none tabular-nums " +
  "transition-[background-color,color,border-color,box-shadow] duration-150 ease-out";
const CHIP_OFF = "border-line bg-surface text-ink-2 hover:border-lane/40 hover:bg-lane-50 hover:text-lane";
const CHIP_ON = "border-lane bg-lane text-white shadow-control hover:bg-lane-600";

/** A filter as a link, so the URL is the state and it works without JavaScript. Pressed chips remove their own filter. */
function FilterChip({ to, label, n, on }: { to: string; label: string; n?: number; on?: boolean }) {
  return (
    <Link href={to} aria-current={on ? "true" : undefined} className={cn(CHIP, on ? CHIP_ON : CHIP_OFF)}>
      {on ? <Check aria-hidden className="size-3.5" /> : null}
      <span>{label}</span>
      {on ? (
        <X aria-hidden className="size-3.5 opacity-80" />
      ) : n !== undefined ? (
        <span className="text-[12px] font-bold text-ink-3">{formatCount(n)}</span>
      ) : null}
    </Link>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-1.5 text-[12px] font-bold uppercase tracking-[0.08em] text-ink-3">{title}</h2>
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
        className={cn(
          "-mx-2 flex min-h-8 items-center justify-between gap-2 rounded-lg px-2 py-1 text-[14px] leading-5 hover:bg-lane-50 hover:text-lane",
          active && "font-bold text-lane",
        )}
      >
        <span className="min-w-0 truncate">{label}</span>
        {n !== undefined ? <span className="figure shrink-0 text-[13px] text-ink-3">{formatCount(n)}</span> : null}
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
          <span className="min-w-0 truncate font-bold text-lane">{label(chosen)}</span>
          <Link href={href(withFilter(query, { [field]: undefined }))} className="shrink-0 text-[13px] font-semibold text-lane underline">
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
  const opt = (c: FacetCount) => <Option key={c.value} to={href(withFilter(query, { [field]: c.value }))} label={label(c.value)} n={c.n} />;
  return (
    <Group title={title}>
      <ul>{shown.map(opt)}</ul>
      {rest.length > 0 ? (
        <details>
          <summary className="cursor-pointer py-1 text-[13px] font-semibold text-lane">Show {rest.length} more</summary>
          <ul>{rest.map(opt)}</ul>
        </details>
      ) : null}
    </Group>
  );
}

const TOP_ROLES = 5;

/**
 * The filter bar: quick chips with live counts, plus an "All filters" panel for every facet. Everything is a link.
 * The first <details> inside this landmark is the panel.
 */
export function FilterRail({ query, facets }: { query: BoardQuery; facets: JobFacets | null }) {
  const f = query.filter;
  const on = activeChips(query).filter((c) => c.key !== "q").length;
  const toggle = (field: "remote" | "salary" | "visa", label: string, n: number) => {
    const isOn = f[field] === true;
    if (!isOn && n === 0) return null;
    return <FilterChip key={field} to={href(withFilter(query, { [field]: isOn ? undefined : true }))} label={label} n={isOn ? undefined : n} on={isOn} />;
  };
  const roles = (facets?.role ?? []).slice(0, TOP_ROLES);
  const posted = [1, 7] as const;

  return (
    <aside aria-label="Filters" className="relative">
      <div className="flex items-center gap-2">
        <AllFilters active={on}>
          <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
            <Facet title="Role" query={query} field="role" counts={facets?.role ?? []} label={roleLabel} limit={8} />
            <Facet title="Country" query={query} field="country" counts={facets?.country ?? []} label={countryName} limit={8} />
            <div className="space-y-6">
              <Facet title="Workplace" query={query} field="workplace" counts={facets?.workplace ?? []} label={(v) => WORKPLACE_LABEL[v] ?? v} order={["remote", "hybrid", "onsite"]} />
              <Facet title="Type" query={query} field="employment" counts={facets?.employment ?? []} label={(v) => EMPLOYMENT_LABEL[v] ?? v} order={["fulltime", "contract", "parttime", "intern"]} />
            </div>
            <div className="space-y-6">
              <Facet title="Level" query={query} field="level" counts={facets?.level ?? []} label={(v) => LEVEL_LABEL[v] ?? v} order={["intern", "entry", "mid", "experienced"]} />
              <Group title="Posted">
                <ul>
                  {[1, 3, 7, 14, 30].map((d) => (
                    <Option key={d} to={href(withFilter(query, { posted: f.posted === d ? undefined : d }))} label={postedLabel(d)} active={f.posted === d} />
                  ))}
                </ul>
              </Group>
            </div>
          </div>
        </AllFilters>
        <div
          className="-mr-4 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-1 pr-4 [scrollbar-width:none] [mask-image:linear-gradient(to_right,#000_calc(100%-40px),transparent)] sm:mr-0 sm:pr-8 [&::-webkit-scrollbar]:hidden"
          role="group"
          aria-label="Quick filters"
        >
          {toggle("remote", "Remote", facets?.remote ?? 0)}
          {toggle("salary", "Pay stated", facets?.salary ?? 0)}
          {toggle("visa", "Sponsors visas", facets?.visa ?? 0)}
          {posted.map((d) => (
            <FilterChip key={d} to={href(withFilter(query, { posted: f.posted === d ? undefined : d }))} label={d === 1 ? "Last 24 hours" : "Last 7 days"} on={f.posted === d} />
          ))}
          {f.role ? (
            <FilterChip to={href(withFilter(query, { role: undefined }))} label={roleLabel(f.role)} on />
          ) : (
            roles.map((r) => <FilterChip key={r.value} to={href(withFilter(query, { role: r.value }))} label={roleLabel(r.value)} n={r.n} />)
          )}
        </div>
      </div>
    </aside>
  );
}
