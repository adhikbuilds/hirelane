/**
 * The public board query: filter, total, page and facets in one parameterised statement (design section 3).
 *
 * Pure SQL and mapping live here so they can be tested against a database without Next. `searchJobs` wraps the same
 * work in `unstable_cache` (300 s, tag `jobs`). Results are JSON-safe: dates are ISO strings, money is integer minor units.
 */
import { unstable_cache } from "next/cache";
import { withAdmin } from "@hirelane/db";
import { formatSalary, safeLogoSrc } from "../job-view";

export type RoleSlug = string;
export type JobFilter = {
  q?: string;
  role?: RoleSlug;
  /** ISO 3166-1 alpha-2, uppercase. Strict: the job must name this country. */
  country?: string;
  remote?: true;
  salary?: true;
  workplace?: "remote" | "hybrid" | "onsite";
  employment?: "fulltime" | "contract" | "parttime" | "intern";
  /** API vocabulary; `experienced` expands to senior, lead and executive. */
  level?: "entry" | "mid" | "experienced" | "intern";
  visa?: true;
  /** Days, 1 to 365. */
  posted?: number;
  company?: string;
  /** Major units of `currency`. */
  minPay?: number;
  currency?: "USD" | "INR";
};
export type JobQuery = { filter: JobFilter; page: number; pageSize: number; sort: "fresh" | "pay" };

export const MAX_PAGES = 100;
export const MAX_Q_TOKENS = 4;

const LEVELS: Record<NonNullable<JobFilter["level"]>, string[]> = {
  intern: ["intern"],
  entry: ["entry"],
  mid: ["mid"],
  experienced: ["senior", "lead", "executive"],
};
export const levelToDb = (l: JobFilter["level"]): string[] | null => (l ? LEVELS[l] : null);

/** Escapes LIKE/ILIKE metacharacters so user text is always literal. */
export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Lower-cased tokens of at least 2 characters, at most MAX_Q_TOKENS. */
export function qTokens(q: string | undefined): string[] {
  if (!q) return [];
  return q
    .normalize("NFKC")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, MAX_Q_TOKENS);
}

export const pagesFor = (total: number, pageSize: number): number =>
  Math.max(1, Math.min(MAX_PAGES, Math.ceil(total / pageSize)));

/** $1..$21, in the order documented in the design. `now` is injected so tests are deterministic. */
export function toSqlParams(query: JobQuery, now: Date, withFacets: boolean): unknown[] {
  const f = query.filter;
  const tokens = qTokens(f.q).map((t) => `%${escapeLike(t)}%`);
  return [
    now,
    tokens[0] ?? null,
    tokens[1] ?? null,
    tokens[2] ?? null,
    tokens[3] ?? null,
    f.role ?? null,
    f.country ?? null,
    f.remote ? true : null,
    f.salary ? true : null,
    f.workplace ?? null,
    f.employment ?? null,
    levelToDb(f.level),
    f.visa ? true : null,
    f.posted ?? null,
    f.company ?? null,
    f.minPay === undefined ? null : f.minPay * 100,
    f.currency ?? "USD",
    query.sort,
    query.pageSize,
    (query.page - 1) * query.pageSize,
    withFacets,
  ];
}

export const JOBS_SQL = `
WITH f AS MATERIALIZED (
  SELECT j.id, j.role_family, j.level, j.workplace, j.employment, j.remote, j.visa, j.countries,
         (j.salary_min_minor IS NOT NULL OR j.salary_max_minor IS NOT NULL)          AS has_salary,
         coalesce(j.posted_at, j.first_seen_at)                                      AS fresh_at,
         CASE WHEN $17 = 'INR' THEN coalesce(j.salary_annual_inr_min, j.salary_annual_inr_max)
              ELSE                 coalesce(j.salary_annual_usd_min, j.salary_annual_usd_max) END AS pay_key
    FROM jobs j
   WHERE j.closed_at IS NULL
     AND ($2::text IS NULL OR j.search_text ILIKE $2)
     AND ($3::text IS NULL OR j.search_text ILIKE $3)
     AND ($4::text IS NULL OR j.search_text ILIKE $4)
     AND ($5::text IS NULL OR j.search_text ILIKE $5)
     AND ($6::text IS NULL OR j.role_family = $6)
     AND ($7::text IS NULL OR j.countries @> ARRAY[$7::text::char(2)])
     AND ($8::boolean IS NOT TRUE OR j.remote)
     AND ($9::boolean IS NOT TRUE OR (j.salary_min_minor IS NOT NULL OR j.salary_max_minor IS NOT NULL))
     AND ($10::text IS NULL OR j.workplace = $10)
     AND ($11::text IS NULL OR j.employment = $11)
     AND ($12::text[] IS NULL OR j.level = ANY ($12))
     AND ($13::boolean IS NOT TRUE OR j.visa = 'yes')
     AND ($14::int IS NULL OR coalesce(j.posted_at, j.first_seen_at) >= $1::timestamptz - make_interval(days => $14))
     AND ($15::text IS NULL OR j.company_id = (SELECT c.id FROM companies c WHERE c.slug = $15))
     AND ($16::bigint IS NULL OR
          (CASE WHEN $17 = 'INR' THEN coalesce(j.salary_annual_inr_max, j.salary_annual_inr_min)
                ELSE                 coalesce(j.salary_annual_usd_max, j.salary_annual_usd_min) END) >= $16)
),
pg AS (
  SELECT f.id, f.fresh_at, f.pay_key
    FROM f
   ORDER BY CASE WHEN $18 = 'pay' THEN f.pay_key END DESC NULLS LAST, f.fresh_at DESC, f.id
   LIMIT $19 OFFSET $20
)
SELECT
  (SELECT count(*) FROM f)::int AS total,
  (SELECT coalesce(json_agg(to_jsonb(r) ORDER BY CASE WHEN $18 = 'pay' THEN r.pay_key END DESC NULLS LAST, r.fresh_at DESC, r.id), '[]'::json)
     FROM (SELECT pg.fresh_at, pg.pay_key, j.id, j.slug, j.title, j.role_family, j.level, j.workplace, j.employment,
                  j.remote, j.remote_scope, j.countries, j.locations, j.visa, j.source,
                  (SELECT coalesce(json_agg(json_build_object('id', s.id, 'label', s.label) ORDER BY u.ord), '[]'::json)
                     FROM unnest(j.skills) WITH ORDINALITY AS u(id, ord) JOIN skills s ON s.id = u.id) AS skill_labels,
                  j.salary_min_minor, j.salary_max_minor, j.salary_currency, j.salary_period, j.salary_kind, j.salary_source,
                  j.salary_annual_usd_min, j.salary_annual_usd_max, j.salary_annual_inr_min, j.salary_annual_inr_max,
                  to_char(j.fx_date, 'YYYY-MM-DD') AS fx_day, j.posted_at, j.first_seen_at, j.last_seen_at,
                  c.slug AS company_slug, c.name AS company_name, c.logo_path, b.ats
             FROM pg
             JOIN jobs j           ON j.id = pg.id
             JOIN companies c      ON c.id = j.company_id
             LEFT JOIN postings p  ON p.id = j.primary_posting_id
             LEFT JOIN company_boards b ON b.id = p.board_id) r) AS jobs,
  CASE WHEN $21 THEN json_build_object(
    'role',       (SELECT coalesce(json_agg(json_build_object('value', k, 'n', n) ORDER BY n DESC, k), '[]')
                     FROM (SELECT role_family k, count(*) n FROM f WHERE role_family IS NOT NULL GROUP BY 1) x),
    'country',    (SELECT coalesce(json_agg(json_build_object('value', k, 'n', n) ORDER BY n DESC, k), '[]')
                     FROM (SELECT c::text k, count(DISTINCT f.id) n FROM f, unnest(f.countries) c GROUP BY 1
                           ORDER BY n DESC, k LIMIT 30) x),
    'workplace',  (SELECT coalesce(json_agg(json_build_object('value', k, 'n', n) ORDER BY k), '[]')
                     FROM (SELECT workplace k, count(*) n FROM f WHERE workplace IS NOT NULL GROUP BY 1) x),
    'employment', (SELECT coalesce(json_agg(json_build_object('value', k, 'n', n) ORDER BY k), '[]')
                     FROM (SELECT employment k, count(*) n FROM f WHERE employment IS NOT NULL GROUP BY 1) x),
    'level',      (SELECT coalesce(json_agg(json_build_object('value', k, 'n', n) ORDER BY k), '[]')
                     FROM (SELECT CASE WHEN level IN ('senior','lead','executive') THEN 'experienced' ELSE level END k,
                                  count(*) n FROM f WHERE level IS NOT NULL GROUP BY 1) x),
    'remote',     (SELECT count(*) FROM f WHERE remote),
    'salary',     (SELECT count(*) FROM f WHERE has_salary),
    'visa',       (SELECT count(*) FROM f WHERE visa = 'yes')
  ) END AS facets`;

// ---------------------------------------------------------------------------------------------
// result types

export type PublicSalary = {
  min: number | null;
  max: number | null;
  currency: string;
  period: "hour" | "day" | "week" | "month" | "year";
  kind: "base" | "ote" | null;
  display: string;
  annualUsd: { min: number | null; max: number | null } | null;
  annualInr: { min: number | null; max: number | null } | null;
  source: "ats_structured" | "text" | "llm";
  fxDate: string | null;
};

export type PublicJob = {
  slug: string;
  url: string;
  markdownUrl: string;
  title: string;
  company: { slug: string; name: string; logoUrl: string | null };
  roleFamily: string | null;
  level: "intern" | "entry" | "mid" | "senior" | "lead" | "executive" | null;
  workplace: "remote" | "hybrid" | "onsite" | null;
  employment: "fulltime" | "parttime" | "contract" | "intern" | null;
  remote: boolean;
  remoteScope: "none" | "countries" | "region" | "worldwide";
  countries: string[];
  locations: string[];
  visa: "yes" | "no" | "unknown";
  salary: PublicSalary | null;
  skills: { id: string; label: string }[];
  postedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  freshAt: string;
  ats: "greenhouse" | "lever" | "ashby";
  fixture: boolean;
};

export type FacetCount = { value: string; n: number };
export type JobFacets = {
  role: FacetCount[];
  country: FacetCount[];
  workplace: FacetCount[];
  employment: FacetCount[];
  level: FacetCount[];
  remote: number;
  salary: number;
  visa: number;
};

export type JobsResult = { total: number; jobs: PublicJob[]; facets: JobFacets | null };

/** Minimal client shape, so tests can pass a fake and callers a pooled client. */
export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };

// ---------------------------------------------------------------------------------------------
// mapping

const iso = (v: unknown): string => new Date(v as string).toISOString();
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const range = (min: unknown, max: unknown) => (min === null && max === null ? null : { min: num(min), max: num(max) });

function locationsOf(v: unknown): string[] {
  const list = Array.isArray(v) ? v : v && typeof v === "object" && Array.isArray((v as { all?: unknown }).all) ? (v as { all: unknown[] }).all : [];
  return list.filter((x): x is string => typeof x === "string");
}

/** Maps one raw row from JOBS_SQL to the public shape. `origin` is APP_ORIGIN, without a trailing slash. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toPublicJob(r: any, origin: string): PublicJob {
  const min = num(r.salary_min_minor);
  const max = num(r.salary_max_minor);
  const display = formatSalary({ minMinor: min, maxMinor: max, currency: r.salary_currency, period: r.salary_period });
  const salary: PublicSalary | null =
    display === null
      ? null
      : {
          min,
          max,
          currency: r.salary_currency,
          period: r.salary_period,
          kind: r.salary_kind ?? null,
          display,
          annualUsd: range(r.salary_annual_usd_min ?? null, r.salary_annual_usd_max ?? null),
          annualInr: range(r.salary_annual_inr_min ?? null, r.salary_annual_inr_max ?? null),
          source: r.salary_source,
          fxDate: r.fx_day ?? null,
        };
  const logo = safeLogoSrc(r.logo_path ?? null);
  return {
    slug: r.slug,
    url: `${origin}/job/${r.slug}`,
    markdownUrl: `${origin}/job/${r.slug}.md`,
    title: r.title,
    company: { slug: r.company_slug, name: r.company_name, logoUrl: logo ? `${origin}${logo}` : null },
    roleFamily: r.role_family ?? null,
    level: r.level ?? null,
    workplace: r.workplace ?? null,
    employment: r.employment ?? null,
    remote: r.remote,
    remoteScope: r.remote_scope,
    countries: (r.countries ?? []).map((c: string) => c.trim()),
    locations: locationsOf(r.locations),
    visa: r.visa,
    salary,
    skills: r.skill_labels ?? [],
    postedAt: isoOrNull(r.posted_at),
    firstSeenAt: iso(r.first_seen_at),
    lastSeenAt: iso(r.last_seen_at),
    freshAt: iso(r.fresh_at),
    ats: r.ats,
    fixture: r.source === "fixture",
  };
}

export function appOrigin(): string {
  return (process.env["APP_ORIGIN"] ?? "http://localhost:3001").replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------------------------
// execution

export type RunOptions = { now?: Date; withFacets?: boolean; origin?: string };

/**
 * One round trip. Deliberately an unnamed statement (no `name`): PostgreSQL plans with the real values, so the
 * `$n IS NULL OR ...` branches fold away and the partial/GIN indexes are chosen per request.
 */
export async function queryJobs(client: Queryable, query: JobQuery, opts: RunOptions = {}): Promise<JobsResult> {
  const now = opts.now ?? new Date();
  const withFacets = opts.withFacets ?? false;
  const { rows } = await client.query(JOBS_SQL, toSqlParams(query, now, withFacets));
  const row = rows[0];
  const origin = opts.origin ?? appOrigin();
  return {
    total: Number(row.total),
    jobs: (row.jobs as unknown[]).map((j) => toPublicJob(j, origin)),
    facets: (row.facets as JobFacets | null) ?? null,
  };
}

const KEY_FILTER_ORDER: (keyof JobFilter)[] = [
  "q", "role", "country", "remote", "salary", "workplace", "employment", "level", "visa", "posted", "company", "minPay", "currency",
];

/** Stable string for a query: the unstable_cache argument, so equal queries share one entry. */
export function canonicalQueryKey(query: JobQuery, withFacets: boolean): string {
  const filter: Record<string, unknown> = {};
  for (const k of KEY_FILTER_ORDER) if (query.filter[k] !== undefined) filter[k] = query.filter[k];
  return JSON.stringify({ filter, page: query.page, pageSize: query.pageSize, sort: query.sort, facets: withFacets });
}

const cachedSearch = unstable_cache(
  async (key: string): Promise<JobsResult> => {
    const parsed = JSON.parse(key) as { filter: JobFilter; page: number; pageSize: number; sort: JobQuery["sort"]; facets: boolean };
    // `now` is taken here, not passed in: it must not be part of the cache key.
    return withAdmin((client) =>
      queryJobs(client, { filter: parsed.filter, page: parsed.page, pageSize: parsed.pageSize, sort: parsed.sort }, { withFacets: parsed.facets }),
    );
  },
  ["jobs:v1"],
  { revalidate: 300, tags: ["jobs"] },
);

/** Cached for 300 s under tag `jobs`. Use `queryJobs` for uncached reads. */
export function searchJobs(query: JobQuery, opts: { withFacets?: boolean } = {}): Promise<JobsResult> {
  return cachedSearch(canonicalQueryKey(query, opts.withFacets ?? false));
}

// ---------------------------------------------------------------------------------------------
// companies (/companies, /company/[slug]); open roles themselves come from searchJobs({ filter: { company } })

export type CompanyRow = { slug: string; name: string; logoPath: string | null; open: number; ats: string[] };

const LIST_SQL = `
SELECT c.slug, c.name, c.logo_path,
       count(j.id)::int AS open,
       coalesce(array_agg(DISTINCT b.ats) FILTER (WHERE b.ats IS NOT NULL), '{}') AS ats
  FROM companies c
  JOIN jobs j ON j.company_id = c.id AND j.closed_at IS NULL
  LEFT JOIN postings p ON p.id = j.primary_posting_id
  LEFT JOIN company_boards b ON b.id = p.board_id
 GROUP BY c.id
 ORDER BY open DESC, lower(c.name), c.slug`;

const ONE_SQL = `
SELECT c.slug, c.name, c.logo_path,
       (SELECT count(*) FROM jobs j WHERE j.company_id = c.id AND j.closed_at IS NULL)::int AS open,
       coalesce((SELECT array_agg(DISTINCT b.ats) FROM company_boards b WHERE b.company_id = c.id), '{}') AS ats
  FROM companies c WHERE c.slug = $1`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const map = (r: any): CompanyRow => ({ slug: r.slug, name: r.name, logoPath: r.logo_path ?? null, open: Number(r.open), ats: r.ats ?? [] });

export const listCompanies = unstable_cache(
  async (): Promise<CompanyRow[]> => withAdmin(async (db) => (await db.query(LIST_SQL)).rows.map(map)),
  ["companies:list:v1"],
  { revalidate: 300, tags: ["companies"] },
);

/** Null when the slug is unknown. A known company with no open roles returns open = 0. */
export const getCompany = unstable_cache(
  async (slug: string): Promise<CompanyRow | null> =>
    withAdmin(async (db) => {
      const r = (await db.query(ONE_SQL, [slug])).rows[0];
      return r ? map(r) : null;
    }),
  ["companies:one:v1"],
  { revalidate: 300, tags: ["companies"] },
);

// board v2 ------------------------------------------------------------------------------------
// Read helpers for the /jobs preview panel and type-ahead. Still the one data path: same pool, same tables.

export type PreviewTraceStep = { label: string; ruleId: string };
export type PreviewRequirement = { kind: "must" | "nice"; text: string; category: string; yearsMin: number | null };
export type JobPreviewData = {
  slug: string;
  trace: PreviewTraceStep[];
  requirements: PreviewRequirement[];
  requirementsTotal: number;
  /** The employer's own posting page, http(s) only; null when unknown. */
  applyUrl: string | null;
};

export const PREVIEW_REQUIREMENTS = 4;
export const PREVIEW_MAX_SLUGS = 60;

export const PREVIEWS_SQL = `
SELECT j.slug, j.salary_trace, coalesce(p.apply_url, p.url) AS apply_url,
       (SELECT count(*) FROM job_requirements q WHERE q.job_id = j.id)::int AS req_total,
       (SELECT coalesce(json_agg(json_build_object('kind', r.kind, 'text', r.text, 'category', r.category, 'yearsMin', r.years_min)
                               ORDER BY r.rk, r.ord), '[]'::json)
          FROM (SELECT q.kind, q.text, q.category, q.years_min, q.ord, (q.kind <> 'must') AS rk
                  FROM job_requirements q WHERE q.job_id = j.id
                 ORDER BY (q.kind <> 'must'), q.ord LIMIT ${PREVIEW_REQUIREMENTS}) r) AS reqs
  FROM jobs j
  LEFT JOIN postings p ON p.id = j.primary_posting_id
 WHERE j.slug = ANY ($1::text[])`;

/** The stored trace is either `{ steps: [...] }` or a bare array; anything malformed is dropped. */
export function previewTrace(trace: unknown): PreviewTraceStep[] {
  const steps = Array.isArray(trace) ? trace : trace && typeof trace === "object" && Array.isArray((trace as { steps?: unknown }).steps) ? (trace as { steps: unknown[] }).steps : [];
  const out: PreviewTraceStep[] = [];
  for (const s of steps) {
    if (!s || typeof s !== "object") continue;
    const { label, ruleId } = s as { label?: unknown; ruleId?: unknown };
    if (typeof label === "string" && typeof ruleId === "string") out.push({ label, ruleId });
  }
  return out;
}

const httpOnly = (u: unknown): string | null => {
  if (typeof u !== "string") return null;
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
};

export async function queryPreviews(client: Queryable, slugs: string[]): Promise<Record<string, JobPreviewData>> {
  const wanted = [...new Set(slugs)].filter((s) => /^[a-z0-9][a-z0-9-]{0,199}$/.test(s)).slice(0, PREVIEW_MAX_SLUGS);
  if (wanted.length === 0) return {};
  const { rows } = await client.query(PREVIEWS_SQL, [wanted]);
  const out: Record<string, JobPreviewData> = {};
  for (const r of rows) {
    out[r.slug as string] = {
      slug: r.slug,
      trace: previewTrace(r.salary_trace),
      requirements: r.reqs ?? [],
      requirementsTotal: Number(r.req_total ?? 0),
      applyUrl: httpOnly(r.apply_url),
    };
  }
  return out;
}

const cachedPreviews = unstable_cache(
  async (key: string) => withAdmin((client) => queryPreviews(client, JSON.parse(key) as string[])),
  ["jobs:preview:v1"],
  { revalidate: 300, tags: ["jobs"] },
);

/** Preview data for up to PREVIEW_MAX_SLUGS jobs, cached for 300 s under tag `jobs`. */
export function previewsFor(slugs: string[]): Promise<Record<string, JobPreviewData>> {
  return cachedPreviews(JSON.stringify([...new Set(slugs)].sort()));
}

export type BoardSuggestions = {
  companies: { slug: string; name: string; logoPath: string | null; open: number }[];
  titles: { title: string; n: number }[];
};

export const SUGGEST_MIN = 2;
export const SUGGEST_MAX = 60;

const SUGGEST_COMPANIES_SQL = `
SELECT c.slug, c.name, c.logo_path, count(j.id)::int AS open
  FROM companies c JOIN jobs j ON j.company_id = c.id AND j.closed_at IS NULL
 WHERE c.name ILIKE $1
 GROUP BY c.id
 ORDER BY (c.name ILIKE $2) DESC, open DESC, lower(c.name)
 LIMIT 4`;

const SUGGEST_TITLES_SQL = `
SELECT title, count(*)::int AS n FROM jobs
 WHERE closed_at IS NULL AND title ILIKE $1
 GROUP BY title
 ORDER BY (title ILIKE $2) DESC, n DESC, title
 LIMIT 5`;

/** Title and company type-ahead over open jobs. Needs SUGGEST_MIN characters; user text is always literal. */
export async function suggestBoard(client: Queryable, raw: string): Promise<BoardSuggestions> {
  const q = raw.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, SUGGEST_MAX);
  if (q.length < SUGGEST_MIN) return { companies: [], titles: [] };
  const lit = escapeLike(q);
  const args = [`%${lit}%`, `${lit}%`];
  const [companies, titles] = await Promise.all([client.query(SUGGEST_COMPANIES_SQL, args), client.query(SUGGEST_TITLES_SQL, args)]);
  return {
    companies: companies.rows.map((r) => ({ slug: r.slug, name: r.name, logoPath: safeLogoSrc(r.logo_path ?? null), open: Number(r.open) })),
    titles: titles.rows.map((r) => ({ title: r.title, n: Number(r.n) })),
  };
}
// end board v2 --------------------------------------------------------------------------------
