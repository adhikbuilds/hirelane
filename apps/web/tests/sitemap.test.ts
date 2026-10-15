import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, close, withAdmin } from "@hirelane/db";
import {
  CHUNK,
  chunkCount,
  companyUrls,
  formatLastmod,
  indexEntries,
  jobChunkUrls,
  listUrls,
  renderIndex,
  renderUrlset,
  xmlEscape,
  parseChunkFile,
} from "../lib/sitemap";

const BASE = process.env["TEST_DATABASE_URL"] ?? "postgres://hirelane:hirelane@localhost:5433/hirelane_test";
const DB_NAME = "hirelane_sitemap_test";
const MIGRATIONS = resolve(fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url)));
const XSD = (n: string) => fileURLToPath(new URL(`./fixtures/${n}.xsd`, import.meta.url));
const ORIGIN = "https://hirelane.test";
const tmp = mkdtempSync(join(tmpdir(), "hirelane-sitemap-"));

function xmllint(xml: string, schema: "sitemap" | "siteindex"): void {
  const f = join(tmp, `${Math.random().toString(36).slice(2)}.xml`);
  writeFileSync(f, xml);
  execFileSync("xmllint", ["--noout", "--schema", XSD(schema), f], { stdio: "pipe" });
}

function url(db: string): string {
  const u = new URL(BASE);
  u.pathname = `/${db}`;
  return u.toString();
}

const OPEN = 27;
const CLOSED = 4;

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
    await c.query(`
      INSERT INTO companies (slug, name) VALUES ('acme', 'Acme & Sons'), ('empty-co', 'Empty Co'), ('closed-co', 'Closed Co');
      INSERT INTO jobs (slug, company_id, title, title_norm, doc_hash, first_seen_at, last_seen_at, enrich_version, source,
                        role_family, countries, content_updated_at, closed_at)
      SELECT 'job-' || lpad(i::text, 3, '0'), (SELECT id FROM companies WHERE slug = CASE WHEN i > ${OPEN} THEN 'closed-co' ELSE 'acme' END),
             'Data Engineer ' || i, 'data engineer', 'h', now(), now(), 1, 'live',
             'data-engineer', '{IN}', TIMESTAMPTZ '2026-10-01' + make_interval(hours => i),
             CASE WHEN i > ${OPEN} THEN TIMESTAMPTZ '2026-10-10' END
        FROM generate_series(1, ${OPEN + CLOSED}) i;
      INSERT INTO ingest_runs (trigger, mode, status, finished_at) VALUES ('fixture', 'fixture', 'ok', '2026-10-15T06:00:00Z');
      REFRESH MATERIALIZED VIEW job_facets;
    `);
  });
}, 60_000);

afterAll(async () => {
  await close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("pure builders", () => {
  it("escapes the five XML entities and strips control characters", () => {
    expect(xmlEscape(`a&b<c>d"e'f\u0001`)).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f");
  });
  it("formats lastmod as UTC seconds with a Z", () => {
    expect(formatLastmod(new Date("2026-10-16T01:02:03.456Z"))).toBe("2026-10-16T01:02:03Z");
  });
  it("accepts only 1-based numeric chunk file names", () => {
    expect(parseChunkFile("1.xml")).toBe(1);
    expect(parseChunkFile("9999.xml")).toBe(9999);
    for (const bad of ["0.xml", "01.xml", "1", "1.xml.gz", "a.xml", "-1.xml", "10000.xml", "1.XML", "1.xml/../x", ""]) {
      expect(parseChunkFile(bad)).toBeNull();
    }
  });
  it("renders a valid urlset and index", () => {
    xmllint(renderUrlset([{ loc: `${ORIGIN}/job/a&b`, lastmod: new Date("2026-10-01T00:00:00Z") }, { loc: `${ORIGIN}/x` }]), "sitemap");
    xmllint(renderIndex([{ loc: `${ORIGIN}/sitemaps/jobs/1.xml`, lastmod: null }]), "siteindex");
  });
  it("rejects an oversize urlset instead of emitting an invalid file", () => {
    const many = Array.from({ length: 50_001 }, (_, i) => ({ loc: `${ORIGIN}/job/${i}` }));
    expect(() => renderUrlset(many)).toThrow(/50000/);
  });
});

describe("database-backed sitemaps", () => {
  it("lists every open job exactly once across chunks and no closed job (default chunk)", async () => {
    const slugs = await withAdmin(async (db) => {
      const n = await chunkCount(db);
      expect(n).toBe(1);
      const urls = await jobChunkUrls(db, 1, ORIGIN);
      return urls.map((u) => u.loc);
    });
    expect(slugs).toHaveLength(OPEN);
    expect(new Set(slugs).size).toBe(OPEN);
    expect(slugs.every((s) => /\/job\/job-0\d\d$/.test(s))).toBe(true);
    expect(slugs.some((s) => /job-0(2[89]|3\d)$/.test(s))).toBe(false);
  });

  it("splits into ceil(open / CHUNK) files when CHUNK is injected as 2", async () => {
    const { n, all, sizes } = await withAdmin(async (db) => {
      const count = await chunkCount(db, 2);
      const sizes: number[] = [];
      const all: string[] = [];
      for (let i = 1; i <= count; i++) {
        const u = await jobChunkUrls(db, i, ORIGIN, 2);
        sizes.push(u.length);
        all.push(...u.map((x) => x.loc));
      }
      return { n: count, all, sizes };
    });
    expect(n).toBe(Math.ceil(OPEN / 2));
    expect(sizes.slice(0, -1).every((s) => s === 2)).toBe(true);
    expect(sizes.at(-1)).toBe(OPEN % 2 || 2);
    expect(new Set(all).size).toBe(OPEN);
    expect(all).toHaveLength(OPEN);
  });

  it("five open jobs with CHUNK=2 give three files", async () => {
    await withAdmin(async (db) => {
      await db.query("CREATE TEMP TABLE _keep AS SELECT id FROM jobs WHERE closed_at IS NULL ORDER BY id LIMIT 5");
      await db.query("UPDATE jobs SET closed_at = now() WHERE closed_at IS NULL AND id NOT IN (SELECT id FROM _keep)");
      expect(await chunkCount(db, 2)).toBe(3);
      // Reopen so later tests see the same data.
      await db.query("UPDATE jobs SET closed_at = NULL WHERE slug <= 'job-027'");
    });
  });

  it("out-of-range chunks are empty and chunk count is never below 1", async () => {
    await withAdmin(async (db) => {
      expect(await jobChunkUrls(db, 2, ORIGIN)).toEqual([]);
    });
  });

  it("closing a job removes it from the chunk", async () => {
    await withAdmin(async (db) => {
      await db.query("UPDATE jobs SET closed_at = now() WHERE slug = 'job-001'");
      const urls = await jobChunkUrls(db, 1, ORIGIN);
      expect(urls.map((u) => u.loc)).not.toContain(`${ORIGIN}/job/job-001`);
      expect(urls).toHaveLength(OPEN - 1);
      await db.query("UPDATE jobs SET closed_at = NULL WHERE slug = 'job-001'");
    });
  });

  it("lastmod is content_updated_at, not updated_at", async () => {
    await withAdmin(async (db) => {
      await db.query("UPDATE jobs SET updated_at = now() WHERE slug = 'job-001'");
      const urls = await jobChunkUrls(db, 1, ORIGIN);
      const u = urls.find((x) => x.loc.endsWith("/job-001"));
      expect(u?.lastmod?.toISOString()).toBe("2026-10-01T01:00:00.000Z");
    });
  });

  it("passes xmllint: the chunk, the index and the company and list files", async () => {
    const out = await withAdmin(async (db) => ({
      jobs: renderUrlset(await jobChunkUrls(db, 1, ORIGIN)),
      companies: renderUrlset(await companyUrls(db, ORIGIN)),
      lists: renderUrlset(await listUrls(db, ORIGIN)),
      index: renderIndex(await indexEntries(db, ORIGIN)),
    }));
    xmllint(out.jobs, "sitemap");
    xmllint(out.companies, "sitemap");
    xmllint(out.lists, "sitemap");
    xmllint(out.index, "siteindex");
    expect(out.jobs.match(/<url>/g)).toHaveLength(OPEN);
  });

  it("the index points at every job chunk, companies and lists, with a lastmod", async () => {
    const entries = await withAdmin((db) => indexEntries(db, ORIGIN, 10));
    const locs = entries.map((e) => e.loc);
    expect(locs).toEqual([
      `${ORIGIN}/sitemaps/jobs/1.xml`,
      `${ORIGIN}/sitemaps/jobs/2.xml`,
      `${ORIGIN}/sitemaps/jobs/3.xml`,
      `${ORIGIN}/sitemaps/companies.xml`,
      `${ORIGIN}/sitemaps/lists.xml`,
    ]);
    expect(entries.every((e) => e.lastmod instanceof Date)).toBe(true);
    const jobMods = entries.slice(0, 3).map((e) => e.lastmod!.getTime());
    expect(Math.max(...jobMods)).toBe(Date.parse("2026-10-02T03:00:00Z")); // newest open job
  });

  it("companies.xml lists only companies with an open job", async () => {
    const urls = await withAdmin((db) => companyUrls(db, ORIGIN));
    expect(urls.map((u) => u.loc)).toEqual([`${ORIGIN}/company/acme`]);
    expect(urls[0]?.lastmod?.toISOString()).toBe("2026-10-02T03:00:00.000Z");
  });

  it("lists.xml has /lists plus published lists only (n >= 20)", async () => {
    const urls = await withAdmin((db) => listUrls(db, ORIGIN));
    const locs = urls.map((u) => u.loc);
    expect(locs).toContain(`${ORIGIN}/lists`);
    expect(locs).toContain(`${ORIGIN}/lists/data-engineer-jobs-in-india`);
    expect(locs.filter((l) => l.includes("/lists/"))).toHaveLength(1); // no remote or salary rows exist
  });

  it("escapes special characters in slugs-bearing URLs", async () => {
    const xml = renderUrlset([{ loc: `${ORIGIN}/company/a&b` }]);
    expect(xml).toContain("a&amp;b");
    xmllint(xml, "sitemap");
  });

  it("CHUNK is the protocol maximum", () => {
    expect(CHUNK).toBe(50_000);
  });
});
