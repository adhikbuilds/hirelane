import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, close, withAdmin } from "@hirelane/db";
import { facetCounts, facetCountFor, latestSuccessfulRunAt } from "../lib/lists-data";
import { queryJobs } from "../lib/queries/jobs";
import { LISTS, facetKeyOf, listBySlug } from "../lib/lists";

const BASE = process.env["TEST_DATABASE_URL"] ?? "postgres://hirelane:hirelane@localhost:5433/hirelane_test";
const DB_NAME = "hirelane_lists_test";
const MIGRATIONS = resolve(fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url)));

function url(db: string): string {
  const u = new URL(BASE);
  u.pathname = `/${db}`;
  return u.toString();
}

const SEED = `
INSERT INTO companies (slug, name) VALUES ('co-1', 'Acme');
INSERT INTO company_boards (company_id, ats, token) SELECT id, 'greenhouse', 'acme' FROM companies;
INSERT INTO postings (board_id, external_id, key, url, title, raw, content_hash, first_seen_at, last_seen_at, source)
SELECT id, 'p', 'k:' || id, 'https://x.test/p', 't', '{}', 'h', '2026-01-01', '2026-01-01', 'fixture' FROM company_boards;
INSERT INTO jobs (slug, company_id, title, title_norm, role_family, workplace, remote, remote_scope, countries, locations, visa,
                  doc_hash, salary_min_minor, salary_max_minor, salary_currency, salary_period, salary_source, salary_trace, fx_date, salary_stated,
                  first_seen_at, last_seen_at, closed_at, enrich_version, primary_posting_id, source)
SELECT 'job-' || i, c.id, 'Data Engineer ' || i, 'x', CASE WHEN i % 5 = 0 THEN 'ml-engineer' ELSE 'data-engineer' END,
       CASE WHEN i % 2 = 0 THEN 'remote' ELSE 'onsite' END, i % 2 = 0, 'none',
       (ARRAY['{IN}','{US}','{IN,US}'])[(i % 3) + 1]::char(2)[], '[]'::jsonb, 'unknown', 'h',
       CASE WHEN i % 4 = 0 THEN 100000 END, CASE WHEN i % 4 = 0 THEN 200000 END,
       CASE WHEN i % 4 = 0 THEN 'USD' END, CASE WHEN i % 4 = 0 THEN 'year' END, CASE WHEN i % 4 = 0 THEN 'text' END,
       CASE WHEN i % 4 = 0 THEN '[]'::jsonb END, CASE WHEN i % 4 = 0 THEN DATE '2026-10-01' END, i % 4 = 0,
       TIMESTAMPTZ '2026-10-15', TIMESTAMPTZ '2026-10-15', CASE WHEN i % 17 = 0 THEN TIMESTAMPTZ '2026-10-14' END,
       1, p.id, 'live'
  FROM generate_series(1, 90) i, companies c, postings p;
UPDATE jobs SET search_text = job_search_text(title, company_id, skills);
INSERT INTO ingest_runs (trigger, mode, started_at, finished_at, status) VALUES
  ('manual', 'fixture', '2026-10-15 01:00+00', '2026-10-15 01:05+00', 'ok'),
  ('manual', 'fixture', '2026-10-15 07:00+00', '2026-10-15 07:05+00', 'ok'),
  ('manual', 'fixture', '2026-10-15 13:00+00', '2026-10-15 13:05+00', 'failed');
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
  });
}, 60_000);

afterAll(async () => {
  await close();
});

describe("list data", () => {
  it("facet counts agree with the board query total for every list that has jobs", async () => {
    await withAdmin(async (c) => {
      const counts = await facetCounts(c);
      expect(counts.size).toBeGreaterThan(0);
      let checked = 0;
      for (const def of LISTS) {
        const n = counts.get(facetKeyOf(def));
        if (n === undefined) continue;
        const res = await queryJobs(c, { filter: def.filter, page: 1, pageSize: 50, sort: "fresh" });
        expect(res.total, def.slug).toBe(n);
        checked++;
      }
      expect(checked).toBeGreaterThan(3);
    });
  });

  it("reads one facet count, defaulting to 0 when the row is absent", async () => {
    await withAdmin(async (c) => {
      const def = listBySlug("data-engineer-jobs-in-india")!;
      expect(await facetCountFor(c, def)).toBeGreaterThan(0);
      expect(await facetCountFor(c, listBySlug("legal-jobs-in-japan")!)).toBe(0);
    });
  });

  it("takes the freshness from the latest successful ingest run", async () => {
    await withAdmin(async (c) => {
      expect((await latestSuccessfulRunAt(c))?.toISOString()).toBe("2026-10-15T07:05:00.000Z");
    });
  });
});
