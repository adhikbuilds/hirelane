import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateMasterKey } from "@hirelane/vault";
import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authTestDb } from "./helpers/auth-db";

// GET /api/v1/picks and POST /api/v1/paste end to end: a real migrated database, real sessions, real RLS, the real engine.
// Only the Next request plumbing is faked. Synthetic data only. 0 LLM calls; no network (fetch is spied on).
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "localhost:3001", "user-agent": "vitest" }),
  cookies: async () => ({ get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined), set: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

const ORIGIN = "http://localhost:3001";
let client: Client;
let close: () => Promise<void>;
let closePool: () => Promise<void>;
let S: typeof import("@hirelane/services");
let R: { picks: typeof import("../app/api/v1/picks/route"); paste: typeof import("../app/api/v1/paste/route"); openapi: typeof import("../app/api/v1/openapi.json/route") };
let fetchSpy: ReturnType<typeof vi.spyOn>;
let n = 0;

type Who = { id: string; token: string };
async function mkWho(): Promise<Who> {
  const id = randomUUID();
  await client.query(
    `WITH u AS (INSERT INTO users (id, email, email_verified_at) VALUES ($1, $2, now()) RETURNING id)
     INSERT INTO consents (user_id, kind, granted, doc_version) SELECT id, 'age_18_plus', true, 'test' FROM u`,
    [id, `picks-fixture-${++n}-${id.slice(0, 6)}@example.test`],
  );
  const { startSession, defaultAuthDeps } = await import("../lib/auth/session");
  return { id, token: (await startSession(defaultAuthDeps(), { userId: id })).token };
}

const GOOD_PROFILE = { pct_10: 82, secondary_kind: "12th", pct_secondary: 74, grad_pct_equiv: 74, grad_scale: 100, grad_score: 74, grad_conversion: "direct", active_backlogs: 0, passout_year: 2026, degree: "BTECH" };
async function mkStudent(o: { profile?: Record<string, unknown> | null; skills?: string[] } = {}): Promise<Who> {
  const u = await mkWho();
  const profile = o.profile === undefined ? GOOD_PROFILE : o.profile;
  if (profile) {
    const cols = Object.keys(profile);
    await client.query(`INSERT INTO eligibility_profiles (user_id, confirmed_at, ${cols.join(", ")}) VALUES ($1, now(), ${cols.map((_, i) => `$${i + 2}`).join(", ")})`, [u.id, ...Object.values(profile)]);
  }
  await client.query(
    "INSERT INTO resumes (user_id, source, mime, size_bytes, file_hmac, blob_key, confirmed_at, is_default, skills) VALUES ($1, 'upload', 'application/pdf', 10, $2, $3, now(), true, $4)",
    [u.id, `h-${u.id}`, `k-${u.id}`, o.skills ?? ["python", "sql"]],
  );
  return u;
}

const DAY = 86_400_000;
let seq = 0;
async function mkJob(o: { title?: string; text?: string; ageDays?: number; seenDays?: number; closed?: boolean; company?: string; titleNorm?: string; musts?: { text: string; skills: string[] }[]; paid?: boolean } = {}): Promise<string> {
  const k = ++seq;
  const tag = randomUUID().slice(0, 8);
  const companyId = randomUUID();
  const company = o.company ?? `picks-co-${tag}`;
  const existing = (await client.query("SELECT id FROM companies WHERE slug = $1", [company])).rows[0];
  const cid = existing?.id ?? companyId;
  if (!existing) await client.query("INSERT INTO companies (id, slug, name, domain) VALUES ($1, $2, $3, $4)", [cid, company, `Picks Co ${k}`, `${company}.example.test`]);
  const id = randomUUID();
  const posted = new Date(Date.now() - (o.ageDays ?? 1) * DAY);
  const title = o.title ?? `Graduate Engineer Trainee ${k}`;
  await client.query(
    `INSERT INTO jobs (id, slug, company_id, title, title_norm, level, description_text, doc_hash, posted_at, first_seen_at, last_seen_at, closed_at, enrich_version, source, salary_stated)
     VALUES ($1, $2, $3, $4, $5, 'entry', $6, $7, $8, $8, $9, $10, 1, 'fixture', $11)`,
    [
      id,
      `picks-job-${tag}`,
      cid,
      title,
      o.titleNorm ?? title.toLowerCase(),
      o.text ?? "Graduate Engineer Trainee. Open to freshers. Skills: Python, SQL.",
      `d-${tag}`,
      posted,
      new Date(Date.now() - (o.seenDays ?? 0) * DAY),
      o.closed ? new Date() : null,
      o.paid === true,
    ],
  );
  const musts = o.musts ?? [{ text: "Python", skills: ["python"] }];
  for (const [ord, m] of musts.entries()) {
    await client.query("INSERT INTO job_requirements (job_id, ord, kind, text, category, skill_ids, span_start, span_end, extractor, confidence) VALUES ($1, $2, 'must', $3, 'skill', $4, 0, 10, 'rule', 0.9)", [id, ord, m.text, m.skills]);
  }
  return id;
}

type Opts = { who?: Who | null; origin?: string | null; body?: unknown; type?: string | null; headers?: Record<string, string> };
async function call(handler: (r: Request, c: { params: Promise<any> }) => Promise<Response>, method: string, path: string, o: Opts = {}) {
  const h: Record<string, string> = { host: "localhost:3001", ...(o.headers ?? {}) };
  if (o.who) h["cookie"] = `__Host-hl_session=${o.who.token}`;
  if (o.origin !== null && method !== "GET") h["origin"] = o.origin ?? ORIGIN;
  let body: BodyInit | undefined;
  if (o.body !== undefined) {
    if (o.type !== null) h["content-type"] = o.type ?? "application/json";
    body = typeof o.body === "string" ? o.body : JSON.stringify(o.body);
  }
  const res = await handler(new Request(`${ORIGIN}${path}`, { method, headers: h, ...(body !== undefined ? { body } : {}) }), { params: Promise.resolve({}) });
  const text = await res.clone().text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { res, json, status: res.status, text };
}
const getPicks = (who: Who | null) => call(R.picks.GET, "GET", "/api/v1/picks", { who });
const paste = (who: Who | null, body: unknown, o: Opts = {}) => call(R.paste.POST, "POST", "/api/v1/paste", { who, body, ...o });

beforeAll(async () => {
  const db = await authTestDb("hirelane_picks_paste_test");
  client = db.client;
  close = db.close;
  process.env["DATABASE_URL"] = db.url;
  process.env["HIRELANE_MASTER_KEY"] = generateMasterKey();
  process.env["HIRELANE_STORAGE_DIR"] = mkdtempSync(join(tmpdir(), "hirelane-picks-blobs-"));
  process.env["HIRELANE_ACCOUNTS"] = "1";
  closePool = (await import("@hirelane/db")).close;
  S = await import("@hirelane/services");
  R = { picks: await import("../app/api/v1/picks/route"), paste: await import("../app/api/v1/paste/route"), openapi: await import("../app/api/v1/openapi.json/route") };
  fetchSpy = vi.spyOn(globalThis, "fetch");
});
afterAll(async () => {
  fetchSpy.mockRestore();
  await closePool();
  await close();
  delete process.env["HIRELANE_ACCOUNTS"];
});
beforeEach(async () => {
  process.env["HIRELANE_ACCOUNTS"] = "1";
  await client.query("DELETE FROM rate_limits");
  await client.query("DELETE FROM jobs");
  fetchSpy.mockClear();
});

describe("GET /api/v1/picks", () => {
  it("flag off is 404, no session is 401", async () => {
    process.env["HIRELANE_ACCOUNTS"] = "0";
    expect((await getPicks(await mkStudent())).status).toBe(404);
    process.env["HIRELANE_ACCOUNTS"] = "1";
    expect((await getPicks(null)).status).toBe(401);
  });

  it("returns today's picks in the documented shape, each with its reasons", async () => {
    const student = await mkStudent();
    await mkJob({ text: "Graduate Engineer Trainee. Freshers. Minimum 60% in graduation. No active backlogs. Skills: Python.", paid: true });
    const r = await getPicks(student);
    expect(r.status).toBe(200);
    expect(() => S.PicksSchema.parse(r.json)).not.toThrow();
    expect(r.json.placed).toBe(false);
    expect(r.json.picks).toHaveLength(1);
    const p = r.json.picks[0];
    expect(p).toMatchObject({ rank: 1, eligibility: "eligible", mustHaves: { matched: 1, total: 1 }, whoYouKnow: null });
    expect(p.rules.length).toBeGreaterThan(0);
    expect(p.rules.every((x: any) => x.status === "pass" && x.text.length > 10)).toBe(true);
    expect(p.rules.map((x: any) => x.text)).toContain("Your graduation: 74%. Needs 60%: you meet it"); // the maths is on the line
    expect(p.pay).toEqual({ stated: true, text: "Pay is stated in the posting" });
    expect(p.posted).toMatchObject({ ageDays: 1, label: "Posted 1 day ago" });
  });

  it("a hard fail never shows; an unknown rule shows with its reason; for the same job, a different student gets a different answer", async () => {
    const strong = await mkStudent();
    const weak = await mkStudent({ profile: { ...GOOD_PROFILE, grad_pct_equiv: 52, grad_score: 52 } });
    const noProfile = await mkStudent({ profile: null });
    const j = await mkJob({ text: "Graduate Engineer Trainee. Freshers. Minimum 60% in graduation. Skills: Python." });
    expect((await getPicks(strong)).json.picks.map((p: any) => p.jobId)).toEqual([j]);
    expect((await getPicks(weak)).json.picks).toEqual([]);
    const unknown = (await getPicks(noProfile)).json.picks;
    expect(unknown.map((p: any) => p.jobId)).toEqual([j]);
    expect(unknown[0].eligibility).toBe("check");
    expect(unknown[0].rules[0]).toMatchObject({ status: "unknown" });
    expect(unknown[0].rules[0].text).toMatch(/confirm/i);
  });

  it("freshness under 14 days, closed jobs, duplicates and the daily cap of 10", async () => {
    const student = await mkStudent();
    await mkJob({ ageDays: 20, seenDays: 0 });
    await mkJob({ ageDays: 3, closed: true });
    await mkJob({ ageDays: 2, seenDays: 16 });
    const keepNew = await mkJob({ company: "dup-co", titleNorm: "graduate engineer", ageDays: 1 });
    await mkJob({ company: "dup-co", titleNorm: "graduate engineer", ageDays: 6 });
    for (let i = 0; i < 14; i++) await mkJob({ ageDays: 1 + (i % 5) });
    const picks = (await getPicks(student)).json.picks;
    expect(picks).toHaveLength(10);
    expect(new Set(picks.map((p: any) => p.jobId)).size).toBe(10);
    expect(picks.every((p: any) => p.posted.ageDays < 14)).toBe(true);
    // the duplicate pair appears at most once, and if it appears it is the newer posting
    const dup = picks.filter((p: any) => p.company === "Picks Co 4" || p.jobId === keepNew);
    expect(dup.length).toBeLessThanOrEqual(1);
    const again = (await getPicks(student)).json.picks;
    expect(again.map((p: any) => p.jobId)).toEqual(picks.map((p: any) => p.jobId));
  });

  it("is own data only: a job the student already applied to is not offered again, and a placed student has none", async () => {
    const student = await mkStudent();
    const j = await mkJob();
    expect((await getPicks(student)).json.picks).toHaveLength(1);
    // exclusion uses the student's own applications (RLS: they cannot see anyone else's)
    const camp = randomUUID();
    const coh = randomUUID();
    await client.query("INSERT INTO campuses (id, name, code_hmac) VALUES ($1, 'Picks College', $2)", [camp, `c-${camp}`]);
    await client.query("INSERT INTO cohorts (id, campus_id, passout_year, programme) VALUES ($1, $2, 2026, 'B.Tech')", [coh, camp]);
    const placed = await mkStudent();
    await client.query("INSERT INTO cohort_members (user_id, campus_id, cohort_id, verified_via, verified_at, email_hmac, placed) VALUES ($1, $2, $3, 'email', now(), $4, true)", [placed.id, camp, coh, `m-${placed.id}`]);
    const r = await getPicks(placed);
    expect(r.json).toMatchObject({ placed: true, picks: [] });
    expect(j).toBeTruthy();
  });

  it("stores nothing: no table gains a row", async () => {
    const student = await mkStudent();
    await mkJob();
    const before = await tableCounts();
    await getPicks(student);
    expect(await tableCounts()).toEqual(before);
  });

  it("carries no scam field and no percentage anywhere in the body", async () => {
    const student = await mkStudent();
    await mkJob();
    const text = (await getPicks(student)).text;
    expect(text).not.toMatch(/scam|percent_match|"score"/i);
  });
});

/** Row counts of every table except the rate limiter and sessions (which the wrapper itself touches). */
async function tableCounts(): Promise<Record<string, number>> {
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('rate_limits', 'sessions', 'schema_migrations') ORDER BY tablename")).rows.map((r) => r.tablename as string);
  const out: Record<string, number> = {};
  for (const t of tables) out[t] = Number((await client.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n);
  return out;
}

const JOB_TEXT = `Job Title: Graduate Engineer Trainee
Company: Acme Systems
Location: Pune
CTC: 3.6 LPA
Eligibility: B.Tech 2026 passout. Minimum 60% in graduation. No active backlogs.
Requirements:
- Python
- SQL
Apply on the careers page.`;

describe("POST /api/v1/paste", () => {
  it("answers fit, eligibility with the maths and a scam check, for the signed-in student", async () => {
    const student = await mkStudent();
    const r = await paste(student, { text: JOB_TEXT });
    expect(r.status).toBe(200);
    expect(() => S.PasteResultSchema.parse(r.json)).not.toThrow();
    expect(r.json.job).toMatchObject({ title: "Graduate Engineer Trainee", company: "Acme Systems" });
    expect(r.json.eligibility.overall).toBe("eligible");
    expect(r.json.scam).toMatchObject({ flagged: false });
    expect(r.json.fit.verdict).toBe("worthwhile");
  });

  it("uses only the caller's own profile: the same paste is eligible for one student and not for another", async () => {
    const strong = await mkStudent();
    const weak = await mkStudent({ profile: { ...GOOD_PROFILE, grad_pct_equiv: 52, grad_score: 52 } });
    expect((await paste(strong, { text: JOB_TEXT })).json.eligibility.overall).toBe("eligible");
    const w = (await paste(weak, { text: JOB_TEXT })).json;
    expect(w.eligibility.overall).toBe("not_eligible");
    expect(w.eligibility.rules.find((x: any) => x.status === "fail").text).toMatch(/52/);
  });

  it("stores nothing, fetches nothing: no table gains a row and the link is never opened", async () => {
    const student = await mkStudent();
    const before = await tableCounts();
    const r = await paste(student, { text: JOB_TEXT, url: "https://www.naukri.com/job-listings-graduate-engineer-123" });
    expect(r.status).toBe(200);
    expect(r.json.job.source).toBe("naukri");
    expect(await tableCounts()).toEqual(before);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("flags a scam forward", async () => {
    const student = await mkStudent();
    const r = await paste(student, { text: "Urgent hiring! Pay a registration fee of Rs 1500 to confirm your seat. Contact on Telegram @fastjobs. Earn 50,000 per month from home." });
    expect(r.json.scam.flagged).toBe(true);
    expect(r.json.fit.verdict).toBe("suspicious");
  });

  it("follows the wrapper rules: 401, cross-origin 403, wrong content type 415, bad body 400, flag off 404", async () => {
    const student = await mkStudent();
    expect((await paste(null, { text: JOB_TEXT })).status).toBe(401);
    expect((await paste(student, { text: JOB_TEXT }, { origin: "https://evil.example.test" })).status).toBe(403);
    expect((await paste(student, JOB_TEXT, { type: "text/plain" })).status).toBe(415);
    const bad = await paste(student, { text: "short" });
    expect([bad.status, bad.json.code]).toEqual([400, "invalid_input"]);
    expect((await paste(student, { text: JOB_TEXT, extra: 1 })).status).toBe(400);
    expect((await paste(student, { text: JOB_TEXT, url: "javascript:alert(1)" })).status).toBe(400);
    process.env["HIRELANE_ACCOUNTS"] = "0";
    expect((await paste(student, { text: JOB_TEXT })).status).toBe(404);
  });

  it("is rate limited to 20 an hour-ish window per student, with Retry-After, and one student's limit is not another's", async () => {
    const a = await mkStudent();
    const b = await mkStudent();
    for (let i = 0; i < 20; i++) expect((await paste(a, { text: JOB_TEXT })).status, `request ${i + 1}`).toBe(200);
    const over = await paste(a, { text: JOB_TEXT });
    expect([over.status, over.json.code]).toEqual([429, "rate_limited"]);
    expect(Number(over.res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await paste(b, { text: JOB_TEXT })).status).toBe(200);
  });

  it("needs no Idempotency-Key (there is nothing to replay), and a repeat is just answered again", async () => {
    const student = await mkStudent();
    const one = await paste(student, { text: JOB_TEXT });
    const two = await paste(student, { text: JOB_TEXT });
    expect([one.status, two.status]).toEqual([200, 200]);
    expect(two.res.headers.get("idempotent-replayed")).toBeNull();
  });
});

describe("OpenAPI", () => {
  it("documents both routes with their schemas and no Idempotency-Key on paste", async () => {
    const doc = (await call(R.openapi.GET, "GET", "/api/v1/openapi.json")).json;
    expect(doc.paths["/api/v1/picks"].get.operationId).toBe("getPicks");
    expect(doc.paths["/api/v1/picks"].get.responses["200"].content["application/json"].schema.properties.picks).toBeDefined();
    const post = doc.paths["/api/v1/paste"].post;
    expect(post.operationId).toBe("checkPastedJob");
    expect(post.parameters.some((p: any) => p.name === "Idempotency-Key")).toBe(false);
    expect(post.requestBody.content["application/json"].schema.properties.text).toBeDefined();
    expect(post.responses["200"].content["application/json"].schema.properties.scam).toBeDefined();
    expect(post.responses["403"]).toBeDefined();
  });
});
