/**
 * /jobs URL state. Lenient on read (invalid values and unknown keys are dropped), canonical on write.
 * Canonical order and vocabulary match the public API's shared parameters. Single value per key.
 */
import { ROLE_FAMILIES } from "@hirelane/engine";
import type { JobFilter, JobQuery } from "../../lib/queries/jobs";
import { COUNTRY_CODES } from "./places";

export const PAGE_SIZE = 50;
export const MAX_PAGE = 100;
export const PARAM_ORDER = ["q", "role", "country", "remote", "salary", "workplace", "employment", "level", "visa", "posted", "page", "sort"] as const;

const ROLES: ReadonlySet<string> = new Set(ROLE_FAMILIES);
const WORKPLACE = ["remote", "hybrid", "onsite"] as const;
const EMPLOYMENT = ["fulltime", "contract", "parttime", "intern"] as const;
const LEVEL = ["entry", "mid", "experienced", "intern"] as const;

export type RawParams = URLSearchParams | Record<string, string | string[] | undefined>;
export type BoardQuery = Pick<JobQuery, "filter" | "page" | "sort">;

/** Every raw value for `key`, in order. */
function values(sp: RawParams, key: string): string[] {
  if (sp instanceof URLSearchParams) return sp.getAll(key);
  const v = sp[key];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}
/** First value that `ok` accepts: repeats after the first valid one are ignored. */
function first<T>(sp: RawParams, key: string, ok: (raw: string) => T | undefined): T | undefined {
  for (const raw of values(sp, key)) {
    const v = ok(raw);
    if (v !== undefined) return v;
  }
  return undefined;
}
const oneOf = <T extends string>(allowed: readonly T[]) => (raw: string) => ((allowed as readonly string[]).includes(raw) ? (raw as T) : undefined);
const flag = (raw: string): true | undefined => (raw === "1" ? true : undefined);
const int = (min: number, max: number) => (raw: string) => {
  if (!/^\d{1,9}$/.test(raw)) return undefined;
  const n = Number(raw);
  return n >= min && n <= max ? n : undefined;
};

function normQ(raw: string): string | undefined {
  const q = raw.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  return q.length >= 1 && q.length <= 100 ? q : undefined;
}

export function parseBoardParams(sp: RawParams): BoardQuery {
  const filter: JobFilter = {};
  const set = <K extends keyof JobFilter>(k: K, v: JobFilter[K] | undefined) => {
    if (v !== undefined) filter[k] = v;
  };
  set("q", first(sp, "q", normQ));
  set("role", first(sp, "role", (r) => (ROLES.has(r) ? r : undefined)));
  set("country", first(sp, "country", (r) => (/^[A-Za-z]{2}$/.test(r) && COUNTRY_CODES.has(r.toUpperCase()) ? r.toUpperCase() : undefined)));
  set("remote", first(sp, "remote", flag));
  set("salary", first(sp, "salary", flag));
  set("workplace", first(sp, "workplace", oneOf(WORKPLACE)));
  set("employment", first(sp, "employment", oneOf(EMPLOYMENT)));
  set("level", first(sp, "level", oneOf(LEVEL)));
  set("visa", first(sp, "visa", flag));
  set("posted", first(sp, "posted", int(1, 365)));
  if (filter.remote && filter.workplace === "remote") delete filter.workplace;
  const rawPage = first(sp, "page", (r) => (/^\d{1,9}$/.test(r) && Number(r) >= 1 ? Math.min(MAX_PAGE, Number(r)) : undefined));
  const sort = first(sp, "sort", oneOf(["fresh", "pay"] as const)) ?? "fresh";
  return { filter, page: rawPage ?? 1, pageSize: PAGE_SIZE, sort } as JobQuery;
}

/** Canonical query string, no leading "?". Defaults (page 1, sort fresh) are omitted. */
export function serializeBoard(q: BoardQuery): string {
  const f = q.filter;
  const out = new URLSearchParams();
  const put = (k: string, v: string | number | true | undefined) => {
    if (v !== undefined) out.set(k, v === true ? "1" : String(v));
  };
  put("q", f.q);
  put("role", f.role);
  put("country", f.country);
  put("remote", f.remote);
  put("salary", f.salary);
  put("workplace", f.remote && f.workplace === "remote" ? undefined : f.workplace);
  put("employment", f.employment);
  put("level", f.level);
  put("visa", f.visa);
  put("posted", f.posted);
  put("page", q.page > 1 ? Math.min(q.page, MAX_PAGE) : undefined);
  put("sort", q.sort === "pay" ? "pay" : undefined);
  return out.toString();
}

/** Query string after changing filter keys. Filter links always reset the page; sort is kept. */
export function withFilter(q: BoardQuery, patch: Partial<Record<keyof JobFilter, JobFilter[keyof JobFilter]>>): string {
  const filter = { ...q.filter } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete filter[k];
    else filter[k] = v;
  }
  if (filter["workplace"] === "remote") {
    delete filter["workplace"];
    filter["remote"] = true;
  }
  return serializeBoard({ filter: filter as JobFilter, page: 1, sort: q.sort });
}

export const withSort = (q: BoardQuery, sort: "fresh" | "pay"): string => serializeBoard({ filter: q.filter, page: 1, sort });
export const withPage = (q: BoardQuery, page: number): string => serializeBoard({ filter: q.filter, page, sort: q.sort });

export type Chip = { key: keyof JobFilter; value: string | number | true; removeQuery: string };

/** One chip per active filter, in canonical order, each with the query string that removes only it. */
export function activeChips(q: BoardQuery): Chip[] {
  const keys = ["q", "role", "country", "remote", "salary", "workplace", "employment", "level", "visa", "posted"] as const;
  const chips: Chip[] = [];
  for (const k of keys) {
    const v = q.filter[k];
    if (v === undefined) continue;
    chips.push({ key: k, value: v, removeQuery: withFilter(q, { [k]: undefined }) });
  }
  return chips;
}
