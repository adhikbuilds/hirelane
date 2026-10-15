import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, close, withAdmin } from "@hirelane/db";
import {
  JOBS_SQL,
  canonicalQueryKey,
  escapeLike,
  levelToDb,
  pagesFor,
  queryJobs,
  qTokens,
  toPublicJob,
  toSqlParams,
  type JobFilter,
  type JobQuery,
} from "../lib/queries/jobs";

const BASE = process.env["TEST_DATABASE_URL"] ?? "postgres://hirelane:hirelane@localhost:5433/hirelane_test";
const DB_NAME = "hirelane_board_query_test";
const MIGRATIONS = resolve(fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url)));
const NOW = new Date("2026-10-16T00:00:00Z");
const ORIGIN = "https://hirelane.test";

const schema = JSON.parse(readFileSync(new URL("../lib/contracts/jobs.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const validateEnvelope = ajv.compile(schema);

const q = (filter: JobFilter = {}, over: Partial<Omit<JobQuery, "filter">> = {}): JobQuery => ({
  filter,
  page: 1,
  pageSize: 50,
  sort: "fresh",
  ...over,
});

function url(db: string): string {
  const u = new URL(BASE);
  u.pathname = `/${db}`;
  return u.toString();
}

const SEED = `
INSERT INTO companies (slug, name)
SELECT 'co-' || g, (ARRAY['Acme Labs','Borealis','Cinder_Works','Delta 100%','Ember','Fjord'])[g + 1] FROM generate_series(0, 5) g;
INSERT INTO company_boards (company_id, ats, token)
SELECT id, (ARRAY['greenhouse','lever','ashby'])[(right(slug, 1)::int % 3) + 1], slug FROM companies;
INSERT INTO postings (board_id, external_id, key, url, title, raw, content_hash, first_seen_at, last_seen_at, source)
SELECT id, 'p', 'k:' || id, 'https://x.test/p', 't', '{}', 'h', '2026-01-01', '2026-01-01', 'fixture' FROM company_boards;
INSERT INTO skills (id, label, category) VALUES ('python','Python','language'), ('sql','SQL','language'), ('rust','Rust','language');
`;

const SEED_JOBS = `
INSERT INTO jobs (slug, company_id, title, title_norm, role_family, level, workplace, employment, remote, remote_scope,
                  countries, locations, visa, doc_hash, salary_min_minor, salary_max_minor, salary_currency, salary_period,
                  salary_annual_usd_min, salary_annual_usd_max, salary_annual_inr_min, salary_annual_inr_max,
                  salary_source, salary_kind, salary_trace, fx_date, salary_stated, skills,
                  posted_at, first_seen_at, last_seen_at, closed_at, enrich_version, primary_posting_id, source)
SELECT 'job-' || i, c.id,
       (ARRAY['Data Engineer','Backend Engineer','Product Manager','Staff Designer','ML Scientist','Platform Engineer'])[(i % 6) + 1] || ' ' || i,
       'x',
       CASE WHEN i % 11 = 0 THEN NULL ELSE (ARRAY['data-engineer','software-engineer-general','product-manager','designer','data-scientist','devops-engineer'])[(i % 6) + 1] END,
       (ARRAY[NULL,'intern','entry','mid','senior','lead','executive'])[(i % 7) + 1],
       (ARRAY['remote','hybrid','onsite',NULL])[(i % 4) + 1],
       (ARRAY['fulltime','contract','parttime','intern',NULL])[(i % 5) + 1],
       (i % 4) = 0,
       CASE WHEN (i % 4) = 0 AND i % 3 = 0 THEN 'worldwide' WHEN (i % 4) = 0 THEN 'countries' ELSE 'none' END,
       (ARRAY['{}','{IN}','{US}','{IN,US}','{GB,DE}'])[(i % 5) + 1]::char(2)[],
       CASE WHEN i % 2 = 0 THEN jsonb_build_object('all', jsonb_build_array('Bengaluru, India')) ELSE '[]'::jsonb END,
       CASE WHEN i % 6 = 0 THEN 'yes' WHEN i % 6 = 1 THEN 'no' ELSE 'unknown' END,
       'h',
       CASE WHEN i % 3 = 0 THEN CASE WHEN i % 9 = 0 THEN NULL ELSE 8000000 + i * 100000 END END,
       CASE WHEN i % 3 = 0 THEN 9000000 + i * 100000 END,
       CASE WHEN i % 3 = 0 THEN 'USD' END, CASE WHEN i % 3 = 0 THEN 'year' END,
       CASE WHEN i % 3 = 0 AND i % 9 <> 0 THEN 8000000 + i * 100000 END,
       CASE WHEN i % 3 = 0 THEN 9000000 + i * 100000 END,
       CASE WHEN i % 3 = 0 AND i % 9 <> 0 THEN (8000000 + i * 100000)::bigint * 88 END,
       CASE WHEN i % 3 = 0 THEN (9000000 + i * 100000)::bigint * 88 END,
       CASE WHEN i % 3 = 0 THEN 'text' END, CASE WHEN i % 3 = 0 THEN 'base' END,
       CASE WHEN i % 3 = 0 THEN '[]'::jsonb END, CASE WHEN i % 3 = 0 THEN DATE '2026-10-01' END,
       i % 3 = 0,
       CASE WHEN i % 2 = 0 THEN ARRAY['python','sql'] WHEN i % 3 = 0 THEN ARRAY['rust'] ELSE '{}' END,
       CASE WHEN i % 4 <> 0 THEN TIMESTAMPTZ '2026-10-15' - make_interval(hours => i) END,
       TIMESTAMPTZ '2026-10-15' - make_interval(hours => i) - interval '1 hour',
       TIMESTAMPTZ '2026-10-15', CASE WHEN i % 13 = 0 THEN TIMESTAMPTZ '2026-10-14' END,
       1, pc.posting_id, CASE WHEN i % 10 = 0 THEN 'fixture' ELSE 'live' END
  FROM generate_series(1, 240) i
  JOIN (SELECT id, row_number() OVER (ORDER BY slug) - 1 AS n FROM companies) c ON c.n = i % 6
  JOIN (SELECT b.company_id, p.id AS posting_id FROM company_boards b JOIN postings p ON p.board_id = b.id) pc ON pc.company_id = c.id;
UPDATE jobs SET search_text = job_search_text(title, company_id, skills);
REFRESH MATERIALIZED VIEW job_facets;
`;

beforeAll(async () => {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(BASE)) throw new Error("refusing to run against a non-local database");
  process.env["DATABASE_URL"] = BASE;
  await withAdmin(async (c) => {
    const { rowCount } = await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB_NAME]);
    if (!rowCount) await c.query(`CREATE DATABASE ${DB_NAME}`);
  });
  await close();
  process.env["DATABASE_URL"] = url(DB_NAME);
  await withAdmin(async (c) => {
    await c.query("DROP SCHEMA public CASCADE");
    await c.query("CREATE SCHEMA public");
    await applyMigrations(c, MIGRATIONS);
    await c.query(SEED);
    await c.query(SEED_JOBS);
  });
}, 60_000);

afterAll(async () => {
  await close();
});

describe("parameter binding", () => {
  it("escapes LIKE metacharacters and tokenises q", () => {
    expect(escapeLike("100%_a\\b")).toBe("100\\%\\_a\\\\b");
    expect(qTokens("  Data   engineer  x ")).toEqual(["data", "engineer"]);
    expect(qTokens("a b cc dd ee ff gg")).toEqual(["cc", "dd", "ee", "ff"]);
    expect(qTokens(undefined)).toEqual([]);
    expect(qTokens("")).toEqual([]);
  });

  it("maps the API level vocabulary onto stored levels", () => {
    expect(levelToDb("experienced")).toEqual(["senior", "lead", "executive"]);
    expect(levelToDb("entry")).toEqual(["entry"]);
    expect(levelToDb(undefined)).toBeNull();
  });

  it("binds 21 positional parameters in the documented order", () => {
    const p = toSqlParams(
      q({ q: "data eng", role: "data-engineer", country: "IN", remote: true, salary: true, workplace: "remote", employment: "fulltime",
        level: "experienced", visa: true, posted: 7, company: "co-1", minPay: 150000, currency: "INR" }, { page: 3, pageSize: 20, sort: "pay" }),
      NOW,
      true,
    );
    expect(p).toHaveLength(21);
    expect(p[0]).toEqual(NOW);
    expect(p.slice(1, 5)).toEqual(["%data%", "%eng%", null, null]);
    expect(p.slice(5, 17)).toEqual(["data-engineer", "IN", true, true, "remote", "fulltime", ["senior", "lead", "executive"], true, 7, "co-1", 15000000, "INR"]);
    expect(p.slice(17)).toEqual(["pay", 20, 40, true]);
  });

  it("uses NULL for absent filters and defaults currency to USD", () => {
    const p = toSqlParams(q(), NOW, false);
    expect(p.slice(1, 16)).toEqual([null, null, null, null, null, null, null, null, null, null, null, null, null, null, null]);
    expect(p.slice(16)).toEqual(["USD", "fresh", 50, 0, false]);
  });

  it("builds a stable cache key regardless of property order", () => {
    const a = canonicalQueryKey(q({ role: "designer", country: "IN" }), true);
    const b = canonicalQueryKey({ sort: "fresh", pageSize: 50, page: 1, filter: { country: "IN", role: "designer" } }, true);
    expect(a).toBe(b);
    expect(canonicalQueryKey(q({ role: "designer" }), true)).not.toBe(canonicalQueryKey(q({ role: "designer" }), false));
  });

  it("computes pages as max(1, min(100, ceil(total / pageSize)))", () => {
    expect(pagesFor(0, 50)).toBe(1);
    expect(pagesFor(51, 50)).toBe(2);
    expect(pagesFor(10_000, 50)).toBe(100);
    expect(pagesFor(1_000_000, 10)).toBe(100);
  });

  it("runs as an unnamed statement so the planner sees the real values", async () => {
    const seen: unknown[] = [];
    const fake = { query: async (...a: unknown[]) => (seen.push(a[0]), { rows: [{ total: 0, jobs: [], facets: null }] }) };
    await queryJobs(fake as never, q(), { now: NOW });
    expect(typeof seen[0]).toBe("string");
    expect(seen[0]).toBe(JOBS_SQL);
  });
});

type Case = { name: string; query: JobQuery; where: string; args?: unknown[] };
const DAY3 = "coalesce(posted_at, first_seen_at) >= timestamptz '2026-10-16' - interval '3 days'";
const CASES: Case[] = [
  { name: "no filters", query: q(), where: "true" },
  { name: "q single token", query: q({ q: "engineer" }), where: "search_text LIKE '%engineer%'" },
  { name: "q two tokens", query: q({ q: "data engineer" }), where: "search_text LIKE '%data%' AND search_text LIKE '%engineer%'" },
  { name: "q company name", query: q({ q: "acme" }), where: "search_text LIKE '%acme labs%'" },
  { name: "q skill label", query: q({ q: "python" }), where: "'python' = ANY(skills)" },
  { name: "q skill id via search_text", query: q({ q: "rust" }), where: "'rust' = ANY(skills)" },
  { name: "q percent is literal", query: q({ q: "100%" }), where: "position('100%' in search_text) > 0" },
  { name: "q underscore is literal", query: q({ q: "cinder_works" }), where: "position('cinder_works' in search_text) > 0" },
  { name: "q backslash is literal", query: q({ q: "a\\b" }), where: "position(E'a\\\\b' in search_text) > 0" },
  { name: "q no match", query: q({ q: "zzzzqqqq" }), where: "false" },
  { name: "role", query: q({ role: "data-engineer" }), where: "role_family = 'data-engineer'" },
  { name: "country IN", query: q({ country: "IN" }), where: "'IN' = ANY(countries)" },
  { name: "country US", query: q({ country: "US" }), where: "'US' = ANY(countries)" },
  { name: "country GB strict", query: q({ country: "GB" }), where: "'GB' = ANY(countries)" },
  { name: "remote", query: q({ remote: true }), where: "workplace = 'remote'" },
  { name: "salary", query: q({ salary: true }), where: "salary_min_minor IS NOT NULL OR salary_max_minor IS NOT NULL" },
  { name: "workplace hybrid", query: q({ workplace: "hybrid" }), where: "workplace = 'hybrid'" },
  { name: "workplace onsite", query: q({ workplace: "onsite" }), where: "workplace = 'onsite'" },
  { name: "remote and hybrid is empty", query: q({ remote: true, workplace: "hybrid" }), where: "false" },
  { name: "employment contract", query: q({ employment: "contract" }), where: "employment = 'contract'" },
  { name: "employment intern", query: q({ employment: "intern" }), where: "employment = 'intern'" },
  { name: "level entry", query: q({ level: "entry" }), where: "level = 'entry'" },
  { name: "level mid", query: q({ level: "mid" }), where: "level = 'mid'" },
  { name: "level intern", query: q({ level: "intern" }), where: "level = 'intern'" },
  { name: "level experienced", query: q({ level: "experienced" }), where: "level IN ('senior','lead','executive')" },
  { name: "visa", query: q({ visa: true }), where: "visa = 'yes'" },
  { name: "posted 3 days", query: q({ posted: 3 }), where: DAY3 },
  { name: "posted 2 days", query: q({ posted: 2 }), where: "coalesce(posted_at, first_seen_at) >= timestamptz '2026-10-14'" },
  { name: "company", query: q({ company: "co-1" }), where: "company_id = (SELECT id FROM companies WHERE slug = 'co-1')" },
  { name: "min_pay USD", query: q({ minPay: 100000 }), where: "coalesce(salary_annual_usd_max, salary_annual_usd_min) >= 10000000" },
  { name: "min_pay INR", query: q({ minPay: 9000000, currency: "INR" }), where: "coalesce(salary_annual_inr_max, salary_annual_inr_min) >= 900000000" },
  { name: "role + country", query: q({ role: "data-engineer", country: "IN" }), where: "role_family = 'data-engineer' AND 'IN' = ANY(countries)" },
  { name: "remote + salary + country IN", query: q({ remote: true, salary: true, country: "IN" }), where: "remote AND (salary_min_minor IS NOT NULL OR salary_max_minor IS NOT NULL) AND 'IN' = ANY(countries)" },
  { name: "everything", query: q({ q: "engineer", role: "data-engineer", country: "IN", salary: true, employment: "fulltime", level: "mid", posted: 30 }), where: "search_text LIKE '%engineer%' AND role_family='data-engineer' AND 'IN' = ANY(countries) AND salary_min_minor IS NOT NULL OR false" },
  { name: "sort pay", query: q({ salary: true }, { sort: "pay" }), where: "salary_min_minor IS NOT NULL OR salary_max_minor IS NOT NULL" },
  { name: "sort pay without salary filter", query: q({}, { sort: "pay" }), where: "true" },
  { name: "page 2", query: q({}, { page: 2 }), where: "true" },
  { name: "page 3 of 20-row pages", query: q({ role: "designer" }, { page: 3, pageSize: 20 }), where: "role_family = 'designer'" },
  { name: "page past the end keeps the true total", query: q({ role: "designer" }, { page: 100 }), where: "role_family = 'designer'" },
  { name: "page 100 of 1-row pages", query: q({}, { page: 100, pageSize: 1 }), where: "true" },
];

// The "everything" row is checked by hand below; its predicate there is intentionally exact.
CASES.find((c) => c.name === "everything")!.where =
  "search_text LIKE '%engineer%' AND role_family='data-engineer' AND 'IN' = ANY(countries) AND (salary_min_minor IS NOT NULL OR salary_max_minor IS NOT NULL) AND employment='fulltime' AND level='mid' AND coalesce(posted_at, first_seen_at) >= timestamptz '2026-10-16' - interval '30 days'";

describe("40-case filter table", () => {
  it("has at least 40 cases", () => expect(CASES.length).toBeGreaterThanOrEqual(40));

  for (const c of CASES) {
    it(`${c.name}: schema-valid, total = count(*)`, async () => {
      const res = await withAdmin((client) => queryJobs(client, c.query, { now: NOW, origin: ORIGIN }));
      const expected = await withAdmin(async (client) =>
        (await client.query(`SELECT count(*)::int AS n FROM jobs WHERE closed_at IS NULL AND (${c.where})`)).rows[0].n,
      );
      expect(res.total).toBe(expected);
      const pages = pagesFor(res.total, c.query.pageSize);
      const envelope = {
        jobs: res.jobs,
        page: c.query.page,
        pageSize: c.query.pageSize,
        pages,
        total: res.total,
        links: { self: "/api/public/jobs", next: c.query.page < pages ? "/api/public/jobs?page=2" : null, prev: null },
      };
      const ok = validateEnvelope(envelope);
      expect(validateEnvelope.errors ?? []).toEqual([]);
      expect(ok).toBe(true);
      const offset = (c.query.page - 1) * c.query.pageSize;
      expect(res.jobs).toHaveLength(Math.max(0, Math.min(c.query.pageSize, res.total - offset)));
    });
  }

  it("has non-trivial totals (the table is not vacuous)", async () => {
    const totals = await Promise.all(CASES.map((c) => withAdmin((cl) => queryJobs(cl, c.query, { now: NOW })).then((r) => r.total)));
    expect(totals.filter((n) => n > 0).length).toBeGreaterThanOrEqual(32);
  });
});

describe("semantics", () => {
  const run = (query: JobQuery, withFacets = false) => withAdmin((c) => queryJobs(c, query, { now: NOW, origin: ORIGIN, withFacets }));

  it("never returns closed jobs", async () => {
    const r = await run(q({}, { pageSize: 100 }));
    const closed = await withAdmin(async (c) => (await c.query("SELECT slug FROM jobs WHERE closed_at IS NOT NULL")).rows.map((x) => x.slug as string));
    expect(closed.length).toBeGreaterThan(0);
    expect(r.jobs.some((j) => closed.includes(j.slug))).toBe(false);
  });

  it("sort=fresh orders by coalesce(posted_at, first_seen_at) desc then id, and pages do not overlap", async () => {
    const p1 = await run(q({}, { pageSize: 40, page: 1 }));
    const p2 = await run(q({}, { pageSize: 40, page: 2 }));
    const fresh = [...p1.jobs, ...p2.jobs].map((j) => j.freshAt);
    expect(fresh).toEqual([...fresh].sort().reverse());
    expect(new Set([...p1.jobs, ...p2.jobs].map((j) => j.slug)).size).toBe(p1.jobs.length + p2.jobs.length);
    expect(p1.total).toBe(p2.total);
  });

  it("sort=pay ranks by the annual floor in the chosen currency; unpaid jobs sort last but stay", async () => {
    const usd = await run(q({}, { sort: "pay", pageSize: 100 }));
    const paid = usd.jobs.filter((j) => j.salary?.annualUsd);
    const floors = paid.map((j) => j.salary!.annualUsd!.min ?? j.salary!.annualUsd!.max!);
    expect(floors).toEqual([...floors].sort((a, b) => b - a));
    const firstUnpaid = usd.jobs.findIndex((j) => j.salary === null);
    expect(firstUnpaid).toBeGreaterThan(0);
    expect(usd.jobs.slice(firstUnpaid).every((j) => j.salary === null)).toBe(true);
    const inr = await run(q({ currency: "INR" }, { sort: "pay", pageSize: 100 }));
    const f2 = inr.jobs.filter((j) => j.salary?.annualInr).map((j) => j.salary!.annualInr!.min ?? j.salary!.annualInr!.max!);
    expect(f2).toEqual([...f2].sort((a, b) => b - a));
  });

  it("min_pay compares the top of the range and excludes jobs with no pay", async () => {
    const r = await run(q({ minPay: 1 }, { pageSize: 100 }));
    expect(r.jobs.length).toBeGreaterThan(0);
    expect(r.jobs.every((j) => j.salary !== null)).toBe(true);
  });

  it("country is strict: worldwide-remote jobs without countries are not in country=IN", async () => {
    const r = await run(q({ country: "IN" }, { pageSize: 100 }));
    expect(r.jobs.every((j) => j.countries.includes("IN"))).toBe(true);
    const ww = await run(q({ remote: true }, { pageSize: 100 }));
    expect(ww.jobs.some((j) => j.remoteScope === "worldwide" && j.countries.length === 0)).toBe(true);
  });

  it("posted filters against the injected clock", async () => {
    const r = await run(q({ posted: 2 }, { pageSize: 100 }));
    expect(r.jobs.length).toBeGreaterThan(0);
    for (const j of r.jobs) expect(Date.parse(j.freshAt)).toBeGreaterThanOrEqual(Date.parse("2026-10-14T00:00:00Z"));
    const later = await withAdmin((c) => queryJobs(c, q({ posted: 2 }), { now: new Date("2027-01-01T00:00:00Z") }));
    expect(later.total).toBe(0);
  });

  it("q is a trigram-backed ILIKE: case-insensitive and deterministic", async () => {
    const a = await run(q({ q: "ACME" }));
    const b = await run(q({ q: "acme" }));
    expect(a.total).toBe(b.total);
    expect(a.total).toBeGreaterThan(0);
  });

  it("facet counts drill down over the filtered set and add up", async () => {
    const r = await run(q({ role: "data-engineer" }), true);
    expect(r.facets).not.toBeNull();
    expect(r.facets!.role).toEqual([{ value: "data-engineer", n: r.total }]);
    expect(r.facets!.remote).toBe(
      await withAdmin(async (c) => (await c.query("SELECT count(*)::int n FROM jobs WHERE closed_at IS NULL AND role_family='data-engineer' AND remote")).rows[0].n),
    );
    const all = await run(q(), true);
    const wp = all.facets!.workplace.reduce((s, x) => s + x.n, 0);
    const nullWp = await withAdmin(async (c) => (await c.query("SELECT count(*)::int n FROM jobs WHERE closed_at IS NULL AND workplace IS NULL")).rows[0].n);
    expect(wp + nullWp).toBe(all.total);
    const exp = all.facets!.level.find((x) => x.value === "experienced")!;
    expect(exp.n).toBe(
      await withAdmin(async (c) => (await c.query("SELECT count(*)::int n FROM jobs WHERE closed_at IS NULL AND level IN ('senior','lead','executive')")).rows[0].n),
    );
    const inCount = all.facets!.country.find((x) => x.value === "IN")!.n;
    expect(inCount).toBe((await run(q({ country: "IN" }))).total);
  });

  it("skips facets when not asked", async () => {
    expect((await run(q())).facets).toBeNull();
  });

  it("job_facets agrees with the list query for role_country, remote_role and salary_role", async () => {
    const rows = await withAdmin(async (c) =>
      (await c.query("SELECT grain, role_family, country, n FROM job_facets WHERE grain IN ('role_country','remote_role','salary_role')")).rows,
    );
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) {
      const filter: JobFilter =
        r.grain === "role_country" ? { role: r.role_family, country: r.country } : r.grain === "remote_role" ? { role: r.role_family, remote: true } : { role: r.role_family, salary: true };
      expect((await run(q(filter))).total, `${r.grain}:${r.role_family}:${r.country}`).toBe(r.n);
    }
  });

  it("maps a row to the public shape with minor-unit money and absolute URLs", async () => {
    const r = await run(q({ salary: true, company: "co-3" }, { pageSize: 5 }));
    const j = r.jobs[0]!;
    expect(j.url).toBe(`${ORIGIN}/job/${j.slug}`);
    expect(j.markdownUrl).toBe(`${ORIGIN}/job/${j.slug}.md`);
    expect(Number.isInteger(j.salary!.max)).toBe(true);
    expect(j.salary!.display).toMatch(/\$/);
    expect(j.company.slug).toBe("co-3");
    expect(j.fixture).toBe(j.slug === "job-" + j.slug.slice(4) && Number(j.slug.slice(4)) % 10 === 0);
    expect(j.skills.every((s) => typeof s.label === "string")).toBe(true);
    expect(["greenhouse", "lever", "ashby"]).toContain(j.ats);
  });

  it("toPublicJob nulls a salary with no figures and unsafe logo paths", () => {
    const base = {
      slug: "a-b", title: "T", role_family: null, level: null, workplace: null, employment: null, remote: false, remote_scope: "none",
      countries: [], locations: [], visa: "unknown", skill_labels: [], source: "live", salary_min_minor: null, salary_max_minor: null,
      salary_currency: null, salary_period: null, salary_kind: null, salary_source: null, salary_annual_usd_min: null,
      salary_annual_usd_max: null, salary_annual_inr_min: null, salary_annual_inr_max: null, fx_day: null, posted_at: null,
      first_seen_at: "2026-01-01T00:00:00+00:00", last_seen_at: "2026-01-02T00:00:00+00:00", fresh_at: "2026-01-01T00:00:00+00:00",
      company_slug: "c", company_name: "C", logo_path: "//evil.test/x.png", ats: "lever",
    };
    const j = toPublicJob(base as never, ORIGIN);
    expect(j.salary).toBeNull();
    expect(j.company.logoUrl).toBeNull();
    expect(j.freshAt).toBe("2026-01-01T00:00:00.000Z");
    expect(toPublicJob({ ...base, logo_path: "/logos/c.png", locations: { all: ["Pune"] } } as never, ORIGIN).company.logoUrl).toBe(`${ORIGIN}/logos/c.png`);
    expect(toPublicJob({ ...base, locations: { all: ["Pune"] } } as never, ORIGIN).locations).toEqual(["Pune"]);
  });
});

describe("scale", () => {
  it("answers over 6,000 open jobs with a correct total and a sane p95", async () => {
    await withAdmin(async (c) => {
      await c.query(`
        INSERT INTO jobs (slug, company_id, title, title_norm, role_family, level, workplace, employment, remote, countries, doc_hash,
                          skills, first_seen_at, last_seen_at, enrich_version, primary_posting_id, source, search_text)
        SELECT 'bulk-' || i, j.company_id, 'Bulk Engineer ' || i, 'x', 'data-engineer', 'mid', 'remote', 'fulltime', true,
               (ARRAY['{IN}','{US}','{}'])[(i % 3) + 1]::char(2)[], 'h', '{}',
               TIMESTAMPTZ '2026-10-01' - make_interval(mins => i), TIMESTAMPTZ '2026-10-15', 1, j.primary_posting_id, 'fixture',
               'bulk engineer ' || i || ' acme labs'
          FROM generate_series(1, 6000) i, LATERAL (SELECT company_id, primary_posting_id FROM jobs WHERE slug = 'job-1') j`);
      await c.query("ANALYZE jobs");
    });
    const expected = await withAdmin(async (c) => (await c.query("SELECT count(*)::int n FROM jobs WHERE closed_at IS NULL AND 'IN' = ANY(countries)")).rows[0].n);
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      const r = await withAdmin((c) => queryJobs(c, q({ country: "IN", q: "engineer" }), { now: NOW, withFacets: true }));
      times.push(performance.now() - t);
      if (i === 0) expect(r.total).toBe(expected - (await withAdmin(async (c) => (await c.query("SELECT count(*)::int n FROM jobs WHERE closed_at IS NULL AND 'IN' = ANY(countries) AND search_text NOT LIKE '%engineer%'")).rows[0].n)));
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95) - 1]!).toBeLessThan(300);
  });
});
