// landing
/**
 * Loaders for the `/` landing page: live counts, the freshest-jobs ticker, jobs for the demo card stack and one real
 * salary trace. One cached read (300 s, tag `jobs`) feeds the whole page, and everything it returns is JSON-safe
 * (ISO strings, no Date), because `unstable_cache` serialises its result.
 */
import "server-only";
import { unstable_cache } from "next/cache";
import { withAdmin } from "@hirelane/db";
import { formatSalary } from "../job-view";
import { buildTraceDemo } from "../../components/landing/trace-model";
import type { DemoJob, LandingCounts, LandingSnapshot, TickerJob, TraceDemo } from "../../components/landing/types";
import { loadSnapshot } from "../../app/api/public/stats/autopilot/handler";
import { perWeekFrom } from "../autopilot-proxy";

type Db = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };

export const TICKER_SIZE = 30;
export const DEMO_SIZE = 8;
const NOT_SEEDED = "j.slug NOT LIKE 'e2e-%'";

const iso = (v: unknown): string => new Date(v as string).toISOString();
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

async function loadCounts(db: Db): Promise<LandingCounts> {
  const c = (
    await db.query(
      `SELECT count(*)::int AS open_jobs,
              count(DISTINCT company_id)::int AS companies,
              count(*) FILTER (WHERE salary_min_minor IS NOT NULL OR salary_max_minor IS NOT NULL)::int AS with_salary
         FROM jobs WHERE closed_at IS NULL`,
    )
  ).rows[0];
  const run = (
    await db.query(
      `SELECT finished_at, boards_ok FROM ingest_runs
        WHERE status IN ('ok','partial') AND finished_at IS NOT NULL
        ORDER BY finished_at DESC LIMIT 1`,
    )
  ).rows[0] as { finished_at: Date; boards_ok: number } | undefined;
  return {
    openJobs: Number(c.open_jobs),
    companies: Number(c.companies),
    withSalary: Number(c.with_salary),
    boards: run && run.boards_ok > 0 ? Number(run.boards_ok) : Number(c.companies),
    asOf: run ? iso(run.finished_at) : null,
  };
}

async function loadTicker(db: Db): Promise<TickerJob[]> {
  const rows = (
    await db.query(
      `SELECT j.slug, j.title, c.name AS company, c.logo_path,
              coalesce(j.posted_at, j.first_seen_at) AS fresh_at
         FROM jobs j JOIN companies c ON c.id = j.company_id
        WHERE j.closed_at IS NULL AND ${NOT_SEEDED}
          AND coalesce(j.posted_at, j.first_seen_at) <= now()
        ORDER BY coalesce(j.posted_at, j.first_seen_at) DESC, j.id
        LIMIT $1`,
      [TICKER_SIZE],
    )
  ).rows;
  return rows.map((r) => ({ slug: r.slug, title: r.title, company: r.company, logoPath: r.logo_path ?? null, freshAt: iso(r.fresh_at) }));
}

const placeOf = (countries: string[] | null, locations: unknown, workplace: string | null): string => {
  const locs = Array.isArray(locations) ? locations : locations && typeof locations === "object" && Array.isArray((locations as { all?: unknown }).all) ? (locations as { all: unknown[] }).all : [];
  const first = locs.find((x): x is string => typeof x === "string");
  const place = first ?? (countries && countries.length > 0 ? countries.slice(0, 2).join(", ") : "");
  const wp = workplace ? workplace.charAt(0).toUpperCase() + workplace.slice(1) : "";
  return [place, wp].filter(Boolean).join(" • ") || "Location not stated";
};

const DEMO_SQL = (extra: string) => `
SELECT j.slug, j.title, j.workplace, j.countries, j.locations,
       j.salary_min_minor, j.salary_max_minor, j.salary_currency, j.salary_period,
       j.salary_annual_usd_min, j.salary_annual_usd_max,
       c.id AS company_id, c.name AS company, c.logo_path,
       (SELECT coalesce(array_agg(s.label ORDER BY u.ord), '{}')
          FROM unnest(j.skills) WITH ORDINALITY AS u(id, ord) JOIN skills s ON s.id = u.id) AS skills
  FROM jobs j JOIN companies c ON c.id = j.company_id
 WHERE j.closed_at IS NULL AND ${NOT_SEEDED}
   AND j.salary_annual_usd_min IS NOT NULL AND cardinality(j.skills) >= 6
   AND j.employment = 'fulltime' ${extra}
 ORDER BY coalesce(j.posted_at, j.first_seen_at) DESC, j.id
 LIMIT 60`;

async function loadDemo(db: Db): Promise<DemoJob[]> {
  const general = (await db.query(DEMO_SQL("AND j.role_family LIKE '%engineer%'"))).rows;
  // A couple of INR postings keep the stack honest for Indian visitors; they are used only when they exist.
  const inr = (await db.query(DEMO_SQL("AND j.salary_currency = 'INR'"))).rows;
  const seen = new Set<unknown>();
  const picked: any[] = [];
  const take = (r: any) => {
    if (picked.length >= DEMO_SIZE || seen.has(r.company_id)) return false;
    if ((r.skills as string[]).filter(Boolean).length < 6) return false;
    seen.add(r.company_id);
    picked.push(r);
    return true;
  };
  // Order: logo-bearing companies first, then the rest; INR postings are interleaved at positions 2 and 5.
  const byLogo = (a: any, b: any) => Number(Boolean(b.logo_path)) - Number(Boolean(a.logo_path));
  const pool = [...general].sort(byLogo);
  const inrPool = [...inr].sort(byLogo);
  const out: any[] = [];
  for (const r of pool) if (take(r)) out.push(r);
  // Swap in up to two INR postings at fixed slots.
  let slot = 1;
  for (const r of inrPool) {
    if (slot > 4 || seen.has(r.company_id)) continue;
    seen.add(r.company_id);
    out.splice(slot, 0, r);
    slot += 3;
  }
  return out.slice(0, DEMO_SIZE).map((r): DemoJob => {
    const annual = formatSalary({
      minMinor: num(r.salary_annual_usd_min),
      maxMinor: num(r.salary_annual_usd_max),
      currency: "USD",
      period: "year",
    });
    const stated = formatSalary({
      minMinor: num(r.salary_min_minor),
      maxMinor: num(r.salary_max_minor),
      currency: r.salary_currency,
      period: r.salary_period,
    });
    return {
      slug: r.slug,
      title: r.title,
      company: r.company,
      logoPath: r.logo_path ?? null,
      where: placeOf(r.countries, r.locations, r.workplace),
      payAnnual: annual ?? stated ?? "Not stated",
      payStated: stated && stated !== annual ? stated : null,
      payMaxUsdMinor: num(r.salary_annual_usd_max) ?? num(r.salary_annual_usd_min),
      skills: (r.skills as string[]).filter(Boolean),
    };
  });
}

/** First text-sourced USD or INR pay whose every quoted span still sits at its offsets in the description. */
async function loadTrace(db: Db): Promise<TraceDemo | null> {
  const rows = (
    await db.query(
      `SELECT j.slug, j.title, c.name AS company, j.description_text, j.salary_trace,
              j.salary_min_minor, j.salary_max_minor, j.salary_currency, j.salary_period
         FROM jobs j JOIN companies c ON c.id = j.company_id
        WHERE j.closed_at IS NULL AND ${NOT_SEEDED}
          AND j.salary_source = 'text' AND j.salary_trace IS NOT NULL
          AND j.salary_currency IN ('USD', 'INR') AND j.salary_period = 'year'
          AND j.description_text IS NOT NULL
        ORDER BY (j.salary_currency = 'USD') DESC, coalesce(j.posted_at, j.first_seen_at) DESC, j.id
        LIMIT 120`,
    )
  ).rows;
  for (const r of rows) {
    const headline = formatSalary({
      minMinor: num(r.salary_min_minor),
      maxMinor: num(r.salary_max_minor),
      currency: r.salary_currency,
      period: r.salary_period,
    });
    if (!headline) continue;
    const demo = buildTraceDemo({
      slug: r.slug,
      title: r.title,
      company: r.company,
      headline,
      text: r.description_text,
      trace: r.salary_trace,
    });
    if (demo && demo.steps.some((s) => s.group === "Convert")) return demo;
  }
  return null;
}

async function loadAutopilot(): Promise<LandingSnapshot["autopilot"]> {
  try {
    const snap = await loadSnapshot();
    return { perWeek: perWeekFrom(snap, 70, null), asOf: snap.asOf };
  } catch {
    return null;
  }
}

async function loadLanding(): Promise<LandingSnapshot> {
  const [data, autopilot] = await Promise.all([
    withAdmin(async (db) => {
      const [counts, ticker, demo, trace] = await Promise.all([loadCounts(db), loadTicker(db), loadDemo(db), loadTrace(db)]);
      return { counts, ticker, demo, trace };
    }),
    loadAutopilot(),
  ]);
  return { ...data, autopilot };
}

/** Everything the landing page reads from the database, cached for 300 s under tag `jobs`. */
export const getLandingSnapshot = unstable_cache(loadLanding, ["landing:v1"], { revalidate: 300, tags: ["jobs"] });
// end landing

// landing v3
/**
 * Per-card extras for the landing card stack: when each job was posted, how many roles its company has open and
 * the posting URL. Read from the same jobs the demo uses; nothing here is invented. JSON-safe, cached 300 s.
 */
export type StackExtraRow = { freshAt: string | null; openRoles: number | null; postingUrl: string | null };

async function loadStackExtras(slugs: string[]): Promise<Record<string, StackExtraRow>> {
  if (slugs.length === 0) return {};
  const rows = await withAdmin(async (db) =>
    (
      await db.query(
        `SELECT j.slug, coalesce(j.posted_at, j.first_seen_at) AS fresh_at, p.url AS posting_url,
                (SELECT count(*)::int FROM jobs o WHERE o.company_id = j.company_id AND o.closed_at IS NULL) AS open_roles
           FROM jobs j LEFT JOIN postings p ON p.id = j.primary_posting_id
          WHERE j.slug = ANY($1::text[])`,
        [slugs],
      )
    ).rows,
  );
  const out: Record<string, StackExtraRow> = {};
  for (const r of rows) {
    out[r.slug as string] = {
      freshAt: r.fresh_at ? iso(r.fresh_at) : null,
      openRoles: num(r.open_roles),
      postingUrl: typeof r.posting_url === "string" ? r.posting_url : null,
    };
  }
  return out;
}

export const getStackExtras = unstable_cache(loadStackExtras, ["landing-v3:stack-extras"], { revalidate: 300, tags: ["jobs"] });
// end landing v3

/** Open roles located in India (public career pages). null when the index is unreachable. */
export async function indiaRoles(): Promise<number | null> {
  try {
    return await withAdmin(async (db) => Number((await db.query("SELECT count(*)::int AS n FROM jobs WHERE closed_at IS NULL AND 'IN' = ANY(countries)")).rows[0].n));
  } catch {
    return null;
  }
}

/** Employers with the most open India roles, as plain names (no logos). */
export async function loadEmployers(): Promise<string[]> {
  try {
    return await withAdmin(async (db) =>
      (
        await db.query(
          "SELECT c.name FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.closed_at IS NULL AND 'IN' = ANY(j.countries) GROUP BY c.name ORDER BY count(*) DESC LIMIT 12",
        )
      ).rows.map((r: { name: string }) => r.name),
    );
  } catch {
    return [];
  }
}

