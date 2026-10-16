/** Pure rules for the live board table: top-N picking, forced rows and columns, and the /jobs links. No I/O. */

export type BoardCell = { role: string; country: string; n: number };
export type BoardModel = {
  roles: string[];
  countries: string[];
  /** n by `${role}|${country}`. A missing key is a real zero. */
  counts: Record<string, number>;
  roleTotals: Record<string, number>;
  countryTotals: Record<string, number>;
};

export const TOP_ROLES = 5;
export const TOP_COUNTRIES = 4;
/** Asha's row and column: always shown so the highlight has something to sit on. */
export const SAMPLE_ROLE = "data-engineer";
export const SAMPLE_COUNTRY = "IN";

export const cellKey = (role: string, country: string) => `${role}|${country}`;

function topWithForced(totals: Record<string, number>, size: number, forced: string): string[] {
  const ranked = Object.entries(totals)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k]) => k);
  const top = ranked.slice(0, size);
  if (!top.includes(forced) && totals[forced] !== undefined) top[size - 1] = forced;
  return top;
}

export function buildBoard(cells: readonly BoardCell[], opts: { roles?: number; countries?: number } = {}): BoardModel {
  const counts: Record<string, number> = {};
  const roleTotals: Record<string, number> = {};
  const countryTotals: Record<string, number> = {};
  for (const c of cells) {
    counts[cellKey(c.role, c.country)] = c.n;
    roleTotals[c.role] = (roleTotals[c.role] ?? 0) + c.n;
    countryTotals[c.country] = (countryTotals[c.country] ?? 0) + c.n;
  }
  return {
    roles: topWithForced(roleTotals, opts.roles ?? TOP_ROLES, SAMPLE_ROLE),
    countries: topWithForced(countryTotals, opts.countries ?? TOP_COUNTRIES, SAMPLE_COUNTRY),
    counts,
    roleTotals,
    countryTotals,
  };
}

/** The same filters the board reads, so the number in a cell is the number the click lands on. */
export function boardHref(role?: string, country?: string): string {
  const p = new URLSearchParams();
  if (role) p.set("role", role);
  if (country) p.set("country", country);
  const s = p.toString();
  return s ? `/jobs?${s}` : "/jobs";
}
