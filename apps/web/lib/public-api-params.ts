/**
 * Strict query-string parsing for GET /api/public/jobs (design 1.1 and 5.1). Invalid values are errors, never dropped.
 * Parameter names, order and vocabulary match /jobs; the last four are API-only.
 */
import { ROLE_FAMILIES } from "@hirelane/engine";
import places from "@hirelane/engine/data/places.json";
import type { JobFilter, JobQuery } from "./queries/jobs";

export const API_PARAM_ORDER = [
  "q", "role", "country", "remote", "salary", "workplace", "employment", "level", "visa", "posted", "page", "sort",
  "company", "min_pay", "currency", "page_size",
] as const;

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE = 100;

export type ParamError = { code: "invalid_param" | "page_out_of_range"; param: string; message: string };
export type ParseResult = { ok: true; query: JobQuery } | { ok: false; error: ParamError };

const ROLES: ReadonlySet<string> = new Set(ROLE_FAMILIES);
const COUNTRIES: ReadonlySet<string> = new Set((places as { countries: { code: string }[] }).countries.map((c) => c.code));
const WORKPLACE = ["remote", "hybrid", "onsite"] as const;
const EMPLOYMENT = ["fulltime", "contract", "parttime", "intern"] as const;
const LEVEL = ["entry", "mid", "experienced", "intern"] as const;
const SORT = ["fresh", "pay"] as const;
const CURRENCY = ["USD", "INR"] as const;
const SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/;

class Invalid extends Error {
  constructor(readonly error: ParamError) {
    super(error.message);
  }
}
const fail = (param: string, message: string, code: ParamError["code"] = "invalid_param"): never => {
  throw new Invalid({ code, param, message });
};

function int(param: string, raw: string, min: number, max: number): number {
  if (!/^\d{1,10}$/.test(raw)) return fail(param, `${param} must be an integer from ${min} to ${max}`);
  const n = Number(raw);
  if (n < min || n > max) return fail(param, `${param} must be an integer from ${min} to ${max}`);
  return n;
}
function oneOf<T extends string>(param: string, raw: string, allowed: readonly T[]): T {
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  return fail(param, `${param} must be one of: ${allowed.join(", ")}`);
}
/** true for 1/true, false for 0/false. */
function flag(param: string, raw: string): boolean {
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return fail(param, `${param} must be 1, 0, true or false`);
}

export function parseStrict(sp: URLSearchParams): ParseResult {
  const get = (k: string) => sp.get(k); // first occurrence
  try {
    const filter: JobFilter = {};
    let page = 1;
    let pageSize = DEFAULT_PAGE_SIZE;
    let sort: JobQuery["sort"] = "fresh";

    for (const name of API_PARAM_ORDER) {
      const raw = get(name);
      if (raw === null) continue;
      switch (name) {
        case "q": {
          const q = raw.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
          if (q.length < 1 || q.length > 100) fail("q", "q must be 1 to 100 characters");
          filter.q = q;
          break;
        }
        case "role":
          if (!ROLES.has(raw)) fail("role", "role must be one of the role family slugs");
          filter.role = raw;
          break;
        case "country": {
          const c = raw.toUpperCase();
          if (!COUNTRIES.has(c)) fail("country", "country must be an ISO 3166-1 alpha-2 code");
          filter.country = c;
          break;
        }
        case "remote":
          if (flag(name, raw)) filter.remote = true;
          break;
        case "salary":
          if (flag(name, raw)) filter.salary = true;
          break;
        case "visa":
          if (flag(name, raw)) filter.visa = true;
          break;
        case "workplace":
          filter.workplace = oneOf(name, raw, WORKPLACE);
          break;
        case "employment":
          filter.employment = oneOf(name, raw, EMPLOYMENT);
          break;
        case "level":
          filter.level = oneOf(name, raw, LEVEL);
          break;
        case "posted":
          filter.posted = int(name, raw, 1, 365);
          break;
        case "page":
          if (/^\d{1,10}$/.test(raw) && Number(raw) > MAX_PAGE) fail("page", `page must not exceed ${MAX_PAGE}`, "page_out_of_range");
          page = int(name, raw, 1, MAX_PAGE);
          break;
        case "sort":
          sort = oneOf(name, raw, SORT);
          break;
        case "company":
          if (!SLUG.test(raw)) fail("company", "company must be a company slug");
          filter.company = raw;
          break;
        case "min_pay":
          filter.minPay = int(name, raw, 1, 1_000_000_000);
          break;
        case "currency":
          filter.currency = oneOf(name, raw.toUpperCase(), CURRENCY);
          break;
        case "page_size":
          pageSize = int(name, raw, 1, 100);
          break;
      }
    }
    // remote=1 already means workplace=remote; keep contradictions so the result is honestly empty.
    if (filter.remote && filter.workplace === "remote") delete filter.workplace;
    return { ok: true, query: { filter, page, pageSize, sort } };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.error };
    throw e;
  }
}

/** Canonical query string (no leading "?"): canonical order, defaults dropped, booleans as 1. */
export function serializeApi(q: JobQuery): string {
  const f = q.filter;
  const out = new URLSearchParams();
  const put = (k: string, v: string | number | undefined | null) => {
    if (v !== undefined && v !== null) out.append(k, String(v));
  };
  put("q", f.q);
  put("role", f.role);
  put("country", f.country);
  if (f.remote) put("remote", 1);
  if (f.salary) put("salary", 1);
  put("workplace", f.remote && f.workplace === "remote" ? undefined : f.workplace);
  put("employment", f.employment);
  put("level", f.level);
  if (f.visa) put("visa", 1);
  put("posted", f.posted);
  if (q.page !== 1) put("page", q.page);
  if (q.sort !== "fresh") put("sort", q.sort);
  put("company", f.company);
  put("min_pay", f.minPay);
  if (f.currency && f.currency !== "USD") put("currency", f.currency);
  if (q.pageSize !== DEFAULT_PAGE_SIZE) put("page_size", q.pageSize);
  return out.toString();
}
