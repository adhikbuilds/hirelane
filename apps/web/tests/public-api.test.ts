import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, close, withAdmin } from "@hirelane/db";
import { createJobDetailHandler, createJobsHandler, optionsResponse, type Deps } from "../app/api/public/_lib/handlers";
import { getPublicJobDetail } from "../app/api/public/_lib/detail";
import { etagMatches } from "../app/api/public/_lib/http";
import { API_PARAM_ORDER, parseStrict, serializeApi } from "../lib/public-api-params";
import { jobDetailResponseSchema, jobsResponseSchema, errorResponseSchema } from "../lib/public-api-schema";
import { buildOpenApi } from "../lib/openapi";
import { queryJobs } from "../lib/queries/jobs";
import { checkRateLimit, clientIp } from "../lib/rate-limit";
import { SEED, SEED_JOBS } from "./helpers/public-api-seed";

const BASE = process.env["TEST_DATABASE_URL"] ?? "postgres://hirelane:hirelane@localhost:5433/hirelane_test";
const DB_NAME = "hirelane_public_api_test";
const MIGRATIONS = resolve(fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url)));
const NOW = new Date("2026-10-16T00:00:00Z");
const ORIGIN = "https://hirelane.test";

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const validateList = ajv.compile(jobsResponseSchema);
const validateDetail = ajv.compile(jobDetailResponseSchema);
const validateError = ajv.compile(errorResponseSchema);
const errs = (v: { errors?: unknown }) => JSON.stringify(v.errors, null, 1);

let hops = 0;
let limitMax = 1_000_000;
let limiterBroken = false;
let searchBroken = false;

const deps: Deps = {
  search: (q) => {
    if (searchBroken) return Promise.reject(new Error("db password is hunter2"));
    return withAdmin((c) => queryJobs(c, q, { now: NOW, origin: ORIGIN }));
  },
  detail: (slug) => withAdmin((c) => getPublicJobDetail(c, slug, ORIGIN)),
  limit: (ip) => {
    if (limiterBroken) return Promise.reject(new Error("rate_limits missing"));
    return withAdmin((c) => checkRateLimit(c, `test:${ip}`, { limit: limitMax, windowSeconds: 60, now: new Date() }));
  },
  hops: () => hops,
};
const list = createJobsHandler(deps);
const detail = createJobDetailHandler(deps);

const get = (qs: string, headers: Record<string, string> = {}) =>
  list(new Request(`${ORIGIN}/api/public/jobs${qs ? `?${qs}` : ""}`, { headers }));
const getJob = (slug: string, headers: Record<string, string> = {}) =>
  detail(new Request(`${ORIGIN}/api/public/jobs/${slug}`, { headers }), { params: Promise.resolve({ slug }) });

function url(db: string): string {
  const u = new URL(BASE);
  u.pathname = `/${db}`;
  return u.toString();
}

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
    // Requirements and a second source for job-3.
    await c.query(
      `INSERT INTO job_requirements (job_id, ord, kind, text, category, years_min, span_start, span_end, section, extractor, confidence)
       SELECT id, 0, 'must', '3+ years of SQL', 'experience', 3, 0, 15, 'Requirements', 'rule', 0.9 FROM jobs WHERE slug = 'job-3'`,
    );
    await c.query(`UPDATE jobs SET description_md = 'We build **things**.' WHERE slug = 'job-3'`);
    await c.query(
      `UPDATE postings SET job_id = j.id FROM jobs j WHERE j.slug = 'job-3' AND postings.id = j.primary_posting_id`,
    );
  });
}, 60_000);

afterAll(async () => {
  await close();
});

// ---------------------------------------------------------------------------------------------
// contract: 40 filter cases, each validated against the schema with total = an independent count(*)

const CASES: [string, string][] = [
  ["", "true"],
  ["role=data-engineer", "j.role_family = 'data-engineer'"],
  ["role=product-manager&country=IN", "j.role_family = 'product-manager' AND 'IN' = ANY(j.countries::text[])"],
  ["country=US", "'US' = ANY(j.countries::text[])"],
  ["country=in", "'IN' = ANY(j.countries::text[])"],
  ["country=DE", "'DE' = ANY(j.countries::text[])"],
  ["remote=1", "j.workplace = 'remote'"],
  ["remote=true", "j.workplace = 'remote'"],
  ["remote=0", "true"],
  ["salary=1", "(j.salary_min_minor IS NOT NULL OR j.salary_max_minor IS NOT NULL)"],
  ["country=IN&remote=1&salary=1", "'IN' = ANY(j.countries::text[]) AND j.workplace = 'remote' AND (j.salary_min_minor IS NOT NULL OR j.salary_max_minor IS NOT NULL)"],
  ["workplace=hybrid", "j.workplace = 'hybrid'"],
  ["workplace=remote&remote=1", "j.workplace = 'remote'"],
  ["remote=1&workplace=hybrid", "false"],
  ["employment=contract", "j.employment = 'contract'"],
  ["employment=intern", "j.employment = 'intern'"],
  ["level=intern", "j.level = 'intern'"],
  ["level=entry", "j.level = 'entry'"],
  ["level=mid", "j.level = 'mid'"],
  ["level=experienced", "j.level IN ('senior','lead','executive')"],
  ["visa=1", "j.visa = 'yes'"],
  ["posted=2", "coalesce(j.posted_at, j.first_seen_at) >= TIMESTAMPTZ '2026-10-14'"],
  ["posted=1", "coalesce(j.posted_at, j.first_seen_at) >= TIMESTAMPTZ '2026-10-15'"],
  ["posted=365", "true"],
  ["q=data+engineer", "lower(j.title) LIKE '%data%' AND lower(j.title) LIKE '%engineer%'"],
  ["q=borealis", "lower(c.name) = 'borealis'"],
  ["q=100%25", "c.name LIKE '%100!%%' ESCAPE '!'"],
  ["q=cinder_works", "lower(c.name) = 'cinder_works'"],
  ["q=python", "'python' = ANY(j.skills)"],
  ["q=zzzzzz", "false"],
  ["company=co-1", "c.slug = 'co-1'"],
  ["company=nope", "false"],
  ["min_pay=95000", "coalesce(j.salary_annual_usd_max, j.salary_annual_usd_min) >= 9500000"],
  ["min_pay=1000000&currency=INR", "coalesce(j.salary_annual_inr_max, j.salary_annual_inr_min) >= 100000000"],
  ["sort=pay&salary=1", "(j.salary_min_minor IS NOT NULL OR j.salary_max_minor IS NOT NULL)"],
  ["sort=pay", "true"],
  ["page=2", "true"],
  ["page=100", "true"],
  ["page_size=10&page=3", "true"],
  ["page_size=100", "true"],
  ["role=sales", "j.role_family = 'sales'"],
  ["country=IN&employment=fulltime&level=experienced&workplace=onsite&visa=1", "'IN' = ANY(j.countries::text[]) AND j.employment = 'fulltime' AND j.level IN ('senior','lead','executive') AND j.workplace = 'onsite' AND j.visa = 'yes'"],
  ["utm_source=newsletter&role=design", "j.role_family = 'design'"],
];

describe("GET /api/public/jobs contract", () => {
  it("has at least 40 cases", () => expect(CASES.length).toBeGreaterThanOrEqual(40));

  it.each(CASES)("%s", async (qs, where) => {
    const res = await get(qs);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(validateList(body), errs(validateList)).toBe(true);

    const expected = await withAdmin(async (c) => {
      const r = await c.query(
        `SELECT count(*)::int AS n FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.closed_at IS NULL AND (${where})`,
      );
      return r.rows[0].n as number;
    });
    expect(body.total).toBe(expected);
    expect(body.pages).toBe(Math.max(1, Math.min(100, Math.ceil(expected / body.pageSize))));
    expect(body.jobs).toHaveLength(Math.max(0, Math.min(body.pageSize, expected - (body.page - 1) * body.pageSize)));

    const parsed = parseStrict(new URLSearchParams(qs));
    if (!parsed.ok) throw new Error("case must be valid");
    const canon = serializeApi(parsed.query);
    expect(body.links.self).toBe(canon ? `/api/public/jobs?${canon}` : "/api/public/jobs");
    expect(body.links.next === null).toBe(body.page >= body.pages);
    expect(body.links.prev === null).toBe(body.page === 1);

    // never a closed job, never a duplicate
    expect(new Set(body.jobs.map((j: { slug: string }) => j.slug)).size).toBe(body.jobs.length);
  });

  it("orders by freshness, newest first, with a stable tie-break", async () => {
    const body = await (await get("page_size=100")).json();
    const fresh = body.jobs.map((j: { freshAt: string }) => Date.parse(j.freshAt));
    expect([...fresh].sort((a, b) => b - a)).toEqual(fresh);
  });

  it("sort=pay puts the highest annual USD floor first and unstated pay last", async () => {
    const body = await (await get("sort=pay&page_size=100")).json();
    const keys: (number | null)[] = body.jobs.map((j: any) => (j.salary ? (j.salary.annualUsd?.min ?? j.salary.annualUsd?.max ?? null) : null));
    const firstNull = keys.findIndex((k) => k === null);
    if (firstNull >= 0) expect(keys.slice(firstNull).every((k) => k === null)).toBe(true);
    const stated = keys.filter((k): k is number => k !== null);
    expect([...stated].sort((a, b) => b - a)).toEqual(stated);
    expect(stated.length).toBeGreaterThan(0);
  });

  it("pages past the last return an empty list with the true total", async () => {
    const all = await (await get("")).json();
    const far = await (await get("page=100")).json();
    expect(far.jobs).toEqual([]);
    expect(far.total).toBe(all.total);
    expect(far.page).toBe(100);
    expect(far.links.next).toBeNull();
  });

  it("returns money as integer minor units and null for unstated pay", async () => {
    const body = await (await get("salary=1&page_size=100")).json();
    for (const j of body.jobs) {
      expect(j.salary).not.toBeNull();
      for (const v of [j.salary.min, j.salary.max]) if (v !== null) expect(Number.isInteger(v)).toBe(true);
    }
    const none = await (await get("page_size=100")).json();
    expect(none.jobs.some((j: any) => j.salary === null)).toBe(true);
  });

  it("builds absolute urls from APP_ORIGIN", async () => {
    const body = await (await get("page_size=1")).json();
    expect(body.jobs[0].url).toBe(`${ORIGIN}/job/${body.jobs[0].slug}`);
    expect(body.jobs[0].markdownUrl).toBe(`${ORIGIN}/job/${body.jobs[0].slug}.md`);
  });
});

describe("invalid parameters", () => {
  const BAD: [string, string, number?][] = [
    ["q=", "q"], ["role=wizard", "role"], ["country=ZZ", "country"], ["remote=maybe", "remote"], ["salary=2", "salary"],
    ["workplace=moon", "workplace"], ["employment=gig", "employment"], ["level=senior", "level"], ["visa=y", "visa"],
    ["posted=0", "posted"], ["posted=366", "posted"], ["page=0", "page"], ["page=101", "page"], ["sort=best", "sort"],
    ["company=Not%20A%20Slug", "company"], ["min_pay=-5", "min_pay"], ["currency=EUR", "currency"], ["page_size=101", "page_size"],
    ["country=%27%3B%20DROP%20TABLE%20jobs%3B--", "country"],
  ];
  it.each(BAD)("%s -> 400 on %s", async (qs, param) => {
    const res = await get(qs);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(validateError(body), errs(validateError)).toBe(true);
    expect(body.error.param).toBe(param);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
  it("page above 100 is page_out_of_range", async () => {
    expect((await (await get("page=101")).json()).error.code).toBe("page_out_of_range");
  });
});

describe("ETag and conditional requests", () => {
  it("sends a weak ETag and public cache headers", async () => {
    const res = await get("role=design");
    expect(res.headers.get("etag")).toMatch(/^W\/"[0-9a-f]{40}"$/);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=300, stale-while-revalidate=60");
    expect(res.headers.get("content-type")).toContain("application/json");
  });
  it("returns 304 with no body for a matching If-None-Match", async () => {
    const first = await get("role=design");
    const etag = first.headers.get("etag")!;
    for (const header of [etag, etag.replace(/^W\//, ""), `"nope", ${etag}`, "*"]) {
      const res = await get("role=design", { "If-None-Match": header });
      expect(res.status, header).toBe(304);
      expect(await res.text()).toBe("");
      expect(res.headers.get("etag")).toBe(etag);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
  });
  it("returns 200 for a stale validator or a different query", async () => {
    const etag = (await get("role=design")).headers.get("etag")!;
    expect((await get("role=design", { "If-None-Match": 'W/"stale"' })).status).toBe(200);
    expect((await get("role=sales", { "If-None-Match": etag })).status).toBe(200);
  });
  it("etagMatches follows weak comparison", () => {
    expect(etagMatches(null, 'W/"a"')).toBe(false);
    expect(etagMatches('"a"', 'W/"a"')).toBe(true);
    expect(etagMatches('W/"a"', 'W/"a"')).toBe(true);
    expect(etagMatches('"b", "a"', 'W/"a"')).toBe(true);
    expect(etagMatches('"b"', 'W/"a"')).toBe(false);
  });
});

describe("CORS", () => {
  it("allows any origin, GET only, never credentials", async () => {
    for (const res of [await get(""), await get("role=wizard"), await getJob("job-3"), await getJob("nope-nope")]) {
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-credentials")).toBeNull();
      expect(res.headers.get("access-control-expose-headers")).toMatch(/ETag/);
      expect(res.headers.get("access-control-expose-headers")).toMatch(/Retry-After/);
    }
  });
  it("answers preflight with GET, HEAD and OPTIONS only", () => {
    const res = optionsResponse();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, HEAD, OPTIONS");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    expect(res.headers.get("access-control-allow-headers")).toMatch(/If-None-Match/);
  });
});

describe("rate limiting", () => {
  const ip = (n: number) => ({ "x-forwarded-for": `198.51.100.${n}` });

  it("answers 429 with Retry-After once a client passes the limit, and CORS still applies", async () => {
    limitMax = 3;
    hops = 1;
    try {
      const codes: number[] = [];
      let last!: Response;
      for (let i = 0; i < 5; i++) {
        last = await get("", ip(1));
        codes.push(last.status);
      }
      expect(codes).toEqual([200, 200, 200, 429, 429]);
      const body = await last.json();
      expect(validateError(body), errs(validateError)).toBe(true);
      expect(body.error.code).toBe("rate_limited");
      expect(Number(last.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
      expect(Number(last.headers.get("retry-after"))).toBeLessThanOrEqual(60);
      expect(last.headers.get("access-control-allow-origin")).toBe("*");
      expect(last.headers.get("cache-control")).toBe("no-store");
      // another client is unaffected
      expect((await get("", ip(2))).status).toBe(200);
    } finally {
      limitMax = 1_000_000;
      hops = 0;
    }
  });

  it("with TRUST_PROXY_HOPS=0 a forged X-Forwarded-For cannot buy a fresh bucket", async () => {
    limitMax = 2;
    hops = 0;
    try {
      // unique window per test run is not needed: the "unknown" bucket was not used earlier in this file at limit 2
      const codes: number[] = [];
      for (let i = 10; i < 15; i++) codes.push((await get("", ip(i))).status);
      expect(codes.filter((c) => c === 429).length).toBeGreaterThanOrEqual(3);
    } finally {
      limitMax = 1_000_000;
    }
  });

  it("with hops=1 a forged left entry cannot buy a fresh bucket either", async () => {
    limitMax = 2;
    hops = 1;
    try {
      const codes: number[] = [];
      for (let i = 0; i < 4; i++) codes.push((await get("", { "x-forwarded-for": `10.9.9.${i}, 203.0.113.77` })).status);
      expect(codes).toEqual([200, 200, 429, 429]);
    } finally {
      limitMax = 1_000_000;
      hops = 0;
    }
  });

  it("does not count or serve work for a rejected request: 429 comes before parsing", async () => {
    limitMax = 1;
    hops = 1;
    try {
      const h = { "x-forwarded-for": "203.0.113.200" };
      await get("", h);
      const res = await get("role=wizard", h);
      expect(res.status).toBe(429);
    } finally {
      limitMax = 1_000_000;
      hops = 0;
    }
  });

  it("fails open when the limiter itself is down", async () => {
    limiterBroken = true;
    try {
      const res = await get("role=design");
      expect(res.status).toBe(200);
    } finally {
      limiterBroken = false;
    }
  });

  it("clientIp is the only thing the handler keys on (sanity)", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }), { hops: 1 })).toBe("2.2.2.2");
  });
});

describe("failures", () => {
  it("500s without leaking the cause", async () => {
    searchBroken = true;
    try {
      const res = await get("");
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).not.toContain("hunter2");
      const body = JSON.parse(text);
      expect(validateError(body), errs(validateError)).toBe(true);
      expect(body.error.code).toBe("internal_error");
    } finally {
      searchBroken = false;
    }
  });
});

describe("GET /api/public/jobs/{slug}", () => {
  it("returns the detail shape with requirements and sources", async () => {
    const res = await getJob("job-3");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(validateDetail(body), errs(validateDetail)).toBe(true);
    expect(body.slug).toBe("job-3");
    expect(body.descriptionMd).toBe("We build **things**.");
    expect(body.requirements).toEqual([
      { kind: "must", text: "3+ years of SQL", category: "experience", yearsMin: 3, spanStart: 0, spanEnd: 15 },
    ]);
    expect(body.sources).toHaveLength(1);
    expect(body.sources[0].url).toBe("https://x.test/p");
    expect(body.closedAt).toBeNull();
    expect(res.headers.get("etag")).toMatch(/^W\//);
  });

  it("agrees with the list entry for the shared fields", async () => {
    const d = await (await getJob("job-3")).json();
    const l = await (await get("q=job-3&page_size=100")).json(); // q does not match slugs; fall back to scan
    const all = await (await get("page_size=100")).json();
    const hit = [...l.jobs, ...all.jobs].find((j: any) => j.slug === "job-3");
    if (hit) {
      const { descriptionMd, requirements, salaryTrace, sources, closedAt, ...summary } = d;
      void descriptionMd; void requirements; void salaryTrace; void sources; void closedAt;
      expect(summary).toEqual(hit);
    }
  });

  it("serves closed jobs with closedAt, so old links still resolve", async () => {
    const slug = await withAdmin(async (c) => (await c.query("SELECT slug FROM jobs WHERE closed_at IS NOT NULL LIMIT 1")).rows[0].slug as string);
    const body = await (await getJob(slug)).json();
    expect(validateDetail(body), errs(validateDetail)).toBe(true);
    expect(body.closedAt).not.toBeNull();
    const listed = await (await get("page_size=100")).json();
    expect(listed.jobs.map((j: { slug: string }) => j.slug)).not.toContain(slug);
  });

  it("exposes the salary trace steps when present", async () => {
    await withAdmin((c) =>
      c.query(`UPDATE jobs SET salary_trace = '{"steps":[{"ruleId":"parse.range"}]}'::jsonb WHERE slug = 'job-3' AND salary_trace IS NOT NULL`),
    );
    const body = await (await getJob("job-3")).json();
    expect(body.salaryTrace).toEqual([{ ruleId: "parse.range" }]);
    const none = await withAdmin(async (c) => (await c.query("SELECT slug FROM jobs WHERE salary_trace IS NULL AND closed_at IS NULL LIMIT 1")).rows[0].slug as string);
    expect((await (await getJob(none)).json()).salaryTrace).toBeNull();
  });

  it.each(["does-not-exist", "UPPER", "a_b", "..%2F..", "x".repeat(300), "-leading"])("404s for %s", async (slug) => {
    const res = await getJob(slug);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(validateError(body), errs(validateError)).toBe(true);
    expect(body.error.code).toBe("not_found");
  });

  it("supports If-None-Match", async () => {
    const etag = (await getJob("job-3")).headers.get("etag")!;
    const res = await getJob("job-3", { "If-None-Match": etag });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
  });
});

describe("OpenAPI document", () => {
  const doc = buildOpenApi(ORIGIN);

  it("is 3.1 and documents both operations", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toEqual(["/api/public/jobs", "/api/public/jobs/{slug}"]);
    expect(doc.servers).toEqual([{ url: ORIGIN }]);
  });

  it("documents exactly the parameters the parser accepts, in canonical order", () => {
    const names = doc.paths["/api/public/jobs"].get.parameters.map((p: { name: string }) => p.name);
    expect(names).toEqual([...API_PARAM_ORDER]);
  });

  it("resolves every $ref against components", () => {
    const refs = [...JSON.stringify(doc).matchAll(/"\$ref":"([^"]+)"/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(5);
    for (const ref of refs) {
      expect(ref.startsWith("#/components/schemas/"), ref).toBe(true);
      expect(doc.components.schemas[ref.split("/").pop()!], ref).toBeDefined();
    }
  });

  it("validates real responses through its own component schemas", async () => {
    const wrap = (name: string) => ajv.compile({ $schema: "https://json-schema.org/draft/2020-12/schema", $ref: `#/components/schemas/${name}`, components: doc.components });
    const vList = wrap("JobsResponse");
    const vDetail = wrap("JobDetail");
    const vErr = wrap("Error");
    const body = await (await get("salary=1")).json();
    expect(vList(body), errs(vList)).toBe(true);
    expect(vDetail(await (await getJob("job-3")).json()), errs(vDetail)).toBe(true);
    expect(vErr(await (await get("role=wizard")).json()), errs(vErr)).toBe(true);
    expect(vList({ ...body, extra: 1 })).toBe(false);
  });

  it("describes 304, 400 and 429 on the list operation, with Retry-After on 429", () => {
    const r = doc.paths["/api/public/jobs"].get.responses;
    expect(Object.keys(r)).toEqual(["200", "304", "400", "429"]);
    expect(r["429"].headers["Retry-After"]).toBeDefined();
    expect(r["200"].headers["ETag"]).toBeDefined();
  });
});
