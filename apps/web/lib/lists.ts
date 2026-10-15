/**
 * The SEO list registry (design section 8). Generated, not hand-written: the cross product of the role families
 * with a fixed, reviewed set of countries, plus one remote list and one posted-salary list per role.
 *
 * Pure: no I/O, importable from the sitemap, /jobs canonical logic and tests. Publication is decided elsewhere from
 * `job_facets.n` (see `isPublished`).
 */
import { ROLE_FAMILIES, type RoleFamily } from "@hirelane/engine";
import type { JobFilter } from "./queries/jobs";

export const MIN_PUBLISHED = 20;

export const LIST_COUNTRIES = [
  "IN", "US", "GB", "CA", "DE", "NL", "IE", "FR", "ES", "PL", "SG", "AU", "AE", "JP", "BR", "MX", "IL", "SE", "CH", "PT",
] as const;
export type ListCountry = (typeof LIST_COUNTRIES)[number];

const COUNTRY_NAMES: Record<ListCountry, string> = {
  IN: "India", US: "the United States", GB: "the United Kingdom", CA: "Canada", DE: "Germany", NL: "the Netherlands",
  IE: "Ireland", FR: "France", ES: "Spain", PL: "Poland", SG: "Singapore", AU: "Australia", AE: "the United Arab Emirates",
  JP: "Japan", BR: "Brazil", MX: "Mexico", IL: "Israel", SE: "Sweden", CH: "Switzerland", PT: "Portugal",
};
const COUNTRY_SLUGS: Record<ListCountry, string> = {
  IN: "india", US: "united-states", GB: "united-kingdom", CA: "canada", DE: "germany", NL: "netherlands",
  IE: "ireland", FR: "france", ES: "spain", PL: "poland", SG: "singapore", AU: "australia", AE: "united-arab-emirates",
  JP: "japan", BR: "brazil", MX: "mexico", IL: "israel", SE: "sweden", CH: "switzerland", PT: "portugal",
};

/** Sentence-case labels; acronyms keep their capitals. */
export const ROLE_LABELS: Record<RoleFamily, string> = {
  "software-engineer-general": "Software engineer",
  "software-engineer-frontend": "Frontend engineer",
  "software-engineer-backend": "Backend engineer",
  "software-engineer-fullstack": "Full-stack engineer",
  "software-engineer-mobile": "Mobile engineer",
  "infrastructure-sre": "Infrastructure and SRE",
  "security-engineer": "Security engineer",
  "data-engineer": "Data engineer",
  "data-scientist": "Data scientist",
  "data-analyst": "Data analyst",
  "ml-engineer": "ML engineer",
  "research-scientist": "Research scientist",
  "qa-test-engineer": "QA and test engineer",
  "hardware-embedded": "Hardware and embedded engineer",
  "solutions-engineer": "Solutions engineer",
  "engineering-manager": "Engineering manager",
  "product-manager": "Product manager",
  design: "Design",
  "program-manager": "Program manager",
  sales: "Sales",
  "customer-success": "Customer success",
  marketing: "Marketing",
  "operations-strategy": "Operations and strategy",
  finance: "Finance",
  legal: "Legal",
  "people-recruiting": "People and recruiting",
  "it-corporate-systems": "IT and corporate systems",
};

export type ListKind = "role-country" | "remote-role" | "salary-role";
export type ListFilter = Pick<JobFilter, "role" | "country" | "remote" | "salary">;
export type FacetKey = {
  grain: "role_country" | "remote_role" | "salary_role";
  roleFamily: RoleFamily;
  country: string | null;
};

export interface ListDef {
  slug: string;
  kind: ListKind;
  filter: ListFilter;
  facet: FacetKey;
  name: string;
  /** "See all" link: the same filter on the raw ledger. */
  jobsHref: string;
}

/** Canonical /jobs parameter order, for the filters a list can carry. */
export function filterToQuery(f: ListFilter): string {
  const p = new URLSearchParams();
  if (f.role) p.set("role", f.role);
  if (f.country) p.set("country", f.country);
  if (f.remote) p.set("remote", "1");
  if (f.salary) p.set("salary", "1");
  return p.toString();
}

/** The job_facets.k surrogate key for a list. */
export const facetKeyOf = (d: ListDef): string => `${d.facet.grain}:${d.facet.roleFamily}:${d.facet.country ?? "*"}`;

const lowerFirst = (s: string): string => (/^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));

function make(kind: ListKind, slug: string, name: string, filter: ListFilter, facet: FacetKey): ListDef {
  return { slug, kind, filter, facet, name, jobsHref: `/jobs?${filterToQuery(filter)}` };
}

function generate(): ListDef[] {
  const out: ListDef[] = [];
  for (const role of ROLE_FAMILIES) {
    const label = ROLE_LABELS[role];
    for (const c of LIST_COUNTRIES) {
      out.push(
        make("role-country", `${role}-jobs-in-${COUNTRY_SLUGS[c]}`, `${label} jobs in ${COUNTRY_NAMES[c]}`,
          { role, country: c }, { grain: "role_country", roleFamily: role, country: c }),
      );
    }
    out.push(make("remote-role", `remote-${role}-jobs`, `Remote ${lowerFirst(label)} jobs`, { role, remote: true },
      { grain: "remote_role", roleFamily: role, country: null }));
    out.push(make("salary-role", `${role}-jobs-with-salary`, `${label} jobs with a posted salary`, { role, salary: true },
      { grain: "salary_role", roleFamily: role, country: null }));
  }
  return out;
}

export const LISTS: readonly ListDef[] = Object.freeze(generate());

const BY_SLUG: ReadonlyMap<string, ListDef> = new Map(LISTS.map((l) => [l.slug, l]));
const BY_FILTER: ReadonlyMap<string, ListDef> = new Map(LISTS.map((l) => [filterToQuery(l.filter), l]));

export const listBySlug = (slug: string): ListDef | undefined => BY_SLUG.get(slug);

/** Exact-match lookup: any extra filter key (visa, q, workplace...) means no list. */
export function listForFilter(f: JobFilter): ListDef | undefined {
  const allowed = new Set(["role", "country", "remote", "salary"]);
  for (const [k, v] of Object.entries(f)) if (v !== undefined && !allowed.has(k)) return undefined;
  const key = filterToQuery({ role: f.role, country: f.country, remote: f.remote, salary: f.salary });
  return key ? BY_FILTER.get(key) : undefined;
}

// ---------------------------------------------------------------------------------------------
// publication and presentation (pure)

export const isPublished = (n: number | undefined | null): boolean => typeof n === "number" && n >= MIN_PUBLISHED;

export const listRobots = (n: number | undefined | null): { index: boolean; follow: true } => ({
  index: isPublished(n),
  follow: true,
});

export function listTitle(def: ListDef, n: number, age: string | null): string {
  const count = new Intl.NumberFormat("en-US").format(n);
  return age ? `${def.name}: ${count} open, refreshed ${age} ago` : `${def.name}: ${count} open`;
}

export type PublishedList = { def: ListDef; n: number };

/** Published lists only, grouped by kind, largest first (ties by slug for a stable order). */
export function groupPublished(counts: ReadonlyMap<string, number>): Record<ListKind, PublishedList[]> {
  const groups: Record<ListKind, PublishedList[]> = { "role-country": [], "remote-role": [], "salary-role": [] };
  for (const def of LISTS) {
    const n = counts.get(facetKeyOf(def));
    if (isPublished(n)) groups[def.kind].push({ def, n: n as number });
  }
  for (const g of Object.values(groups)) g.sort((a, b) => b.n - a.n || a.def.slug.localeCompare(b.def.slug));
  return groups;
}
