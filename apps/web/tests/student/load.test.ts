import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateMasterKey } from "@hirelane/vault";
import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authTestDb } from "../helpers/auth-db";

// The student loaders end to end: a real migrated database, real sessions, real services (including the picks
// service behind GET /api/v1/picks), real RLS. Only the Next request plumbing is faked. Synthetic data only; 0 LLM calls; no network.
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

let client: Client;
let close: () => Promise<void>;
let closePool: () => Promise<void>;
let closeProdPool: () => Promise<void>;
let S: typeof import("@hirelane/services");
let dev: typeof import("../../lib/student/load");
let prod: typeof import("../../lib/student/load");
let ctxFor: typeof import("../../lib/http/ctx").serviceCtxFor;
let n = 0;

type Who = { id: string; token: string };
async function mkWho(name: string | null): Promise<Who> {
  const id = randomUUID();
  await client.query(
    `WITH u AS (INSERT INTO users (id, email, display_name, email_verified_at) VALUES ($1, $2, $3, now()) RETURNING id)
     INSERT INTO consents (user_id, kind, granted, doc_version) SELECT id, 'age_18_plus', true, 'test' FROM u`,
    [id, `student-load-${++n}-${id.slice(0, 6)}@example.test`, name],
  );
  const { startSession, defaultAuthDeps } = await import("../../lib/auth/session");
  return { id, token: (await startSession(defaultAuthDeps(), { userId: id })).token };
}
const signIn = (w: Who | null) => (w ? jar.set("__Host-hl_session", w.token) : jar.delete("__Host-hl_session"));

async function mkStudent(name: string): Promise<Who> {
  const u = await mkWho(name);
  await client.query(
    "INSERT INTO eligibility_profiles (user_id, confirmed_at, pct_10, secondary_kind, pct_secondary, grad_pct_equiv, grad_scale, grad_score, grad_conversion, active_backlogs, passout_year, degree) VALUES ($1, now(), 82, '12th', 74, 74, 100, 74, 'direct', 0, 2026, 'BTECH')",
    [u.id],
  );
  await client.query("INSERT INTO resumes (user_id, source, mime, size_bytes, file_hmac, blob_key, confirmed_at, is_default, skills) VALUES ($1, 'upload', 'application/pdf', 10, $2, $3, now(), true, $4)", [u.id, `h-${u.id}`, `k-${u.id}`, ["python", "sql"]]);
  return u;
}

const DAY = 86_400_000;
async function mkJob(title: string): Promise<string> {
  const tag = randomUUID().slice(0, 8);
  const cid = randomUUID();
  const boardId = randomUUID();
  const postingId = randomUUID();
  await client.query("INSERT INTO companies (id, slug, name, domain) VALUES ($1, $2, $3, $4)", [cid, `load-co-${tag}`, `Load Co ${tag}`, `load-co-${tag}.example.test`]);
  await client.query("INSERT INTO company_boards (id, company_id, ats, token) VALUES ($1, $2, 'greenhouse', $3)", [boardId, cid, `load-co-${tag}`]);
  await client.query(
    `INSERT INTO postings (id, board_id, external_id, key, url, apply_url, title, raw, content_hash, first_seen_at, last_seen_at, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '{}'::jsonb, $8, now(), now(), 'fixture')`,
    [postingId, boardId, `ext-${tag}`, `key-${tag}`, `https://greenhouse.fixture.invalid/${tag}/public`, `https://greenhouse.fixture.invalid/${tag}/apply`, title, `h-${tag}`],
  );
  const id = randomUUID();
  await client.query(
    `INSERT INTO jobs (id, slug, company_id, title, title_norm, level, description_text, doc_hash, posted_at, first_seen_at, last_seen_at, enrich_version, source, salary_stated, primary_posting_id)
     VALUES ($1, $2, $3, $4, $5, 'entry', 'Graduate trainee. Open to freshers. Skills: Python, SQL.', $6, $7, $7, now(), 1, 'fixture', false, $8)`,
    [id, `load-job-${tag}`, cid, title, `${title.toLowerCase()}-${tag}`, `d-${tag}`, new Date(Date.now() - DAY), postingId],
  );
  await client.query("INSERT INTO job_requirements (job_id, ord, kind, text, category, skill_ids, span_start, span_end, extractor, confidence) VALUES ($1, 0, 'must', 'Python', 'skill', $2, 0, 10, 'rule', 0.9)", [id, ["python"]]);
  return id;
}

beforeAll(async () => {
  const db = await authTestDb("hirelane_student_load_test");
  client = db.client;
  close = db.close;
  process.env["DATABASE_URL"] = db.url;
  process.env["HIRELANE_MASTER_KEY"] = generateMasterKey();
  process.env["HIRELANE_STORAGE_DIR"] = mkdtempSync(join(tmpdir(), "hirelane-student-load-blobs-"));
  process.env["HIRELANE_ACCOUNTS"] = "1";
  closePool = (await import("@hirelane/db")).close;
  S = await import("@hirelane/services");
  ctxFor = (await import("../../lib/http/ctx")).serviceCtxFor;
  vi.stubEnv("NODE_ENV", "development");
  dev = await import("../../lib/student/load");
  vi.stubEnv("NODE_ENV", "production");
  vi.resetModules();
  prod = await import("../../lib/student/load");
  closeProdPool = (await import("@hirelane/db")).close;
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await closeProdPool();
  await closePool();
  await close();
  delete process.env["HIRELANE_ACCOUNTS"];
});
beforeEach(() => {
  jar.clear();
  process.env["HIRELANE_ACCOUNTS"] = "1";
});

describe("student loaders: who sees what", () => {
  it("signed out: development shows the labelled sample, production sends to /signin", async () => {
    expect(await dev.loadStudentHome()).toEqual({ source: "sample" });
    expect(await dev.loadStudentPicks()).toEqual({ source: "sample" });
    await expect(prod.loadStudentHome()).rejects.toThrow("NEXT_REDIRECT:/signin");
    await expect(prod.loadStudentPicks()).rejects.toThrow("NEXT_REDIRECT:/signin");
    await expect(prod.loadStudentTracker({})).rejects.toThrow("NEXT_REDIRECT:/signin");
    await expect(prod.loadStudentDrives()).rejects.toThrow("NEXT_REDIRECT:/signin");
    await expect(prod.loadOnboarding()).rejects.toThrow("NEXT_REDIRECT:/signin");
  });

  it("a brand-new student: production shows real zeros, never sample numbers", async () => {
    signIn(await mkWho("Asha Verma"));
    const home = await prod.loadStudentHome();
    expect(home.source).toBe("real");
    if (home.source !== "real") return;
    expect(home.data).toMatchObject({ sample: false, firstName: "Asha", initial: "A", cards: [], newCount: 0, badge: 0, finish: [], codes: [], drives: [], resume: null, marks: null, week: { applied: 0, replies: 0, replyLine: null } });
    const tr = await prod.loadStudentTracker({});
    expect(tr.source).toBe("real");
    if (tr.source === "real") {
      expect(tr.data.selected).toBeNull();
      expect(tr.data.view.groups.every((g) => g.rows.length === 0)).toBe(true);
    }
  });
});

describe("student loaders: picks", () => {
  it("today's picks are the picks service's own roles, with the job id the swipe needs and no score", async () => {
    const student = await mkStudent("Rahul Verma");
    const job = await mkJob("Graduate Engineer Trainee");
    signIn(student);
    for (const load of [dev, prod]) {
      const p = await load.loadStudentPicks();
      expect(p.source).toBe("real");
      if (p.source !== "real") continue;
      const card = p.data.cards.find((c) => c.jobId === job);
      expect(card).toBeDefined();
      expect(card).toMatchObject({ role: "Graduate Engineer Trainee", tone: "lime", pay: { stated: false, headline: "Pay not stated", monthly: null }, href: expect.stringMatching(/^\/job\/load-job-/) });
      expect(JSON.stringify(card)).not.toMatch(/score|percent/i);
      expect(card!.mustHaves).toEqual({ met: 1, total: 1 });
    }
    const home = await prod.loadStudentHome();
    if (home.source !== "real") throw new Error("expected real");
    expect(home.data.cards.some((c) => c.jobId === job)).toBe(true);
    expect(home.data.newCount).toBeGreaterThanOrEqual(1);
  });

  it("a job the student already applied to is not offered again", async () => {
    const student = await mkStudent("Meera Iyer");
    const job = await mkJob("Support Associate Trainee");
    await S.swipeRight(ctxFor(student.id), { jobId: job });
    signIn(student);
    const p = await prod.loadStudentPicks();
    if (p.source !== "real") throw new Error("expected real");
    expect(p.data.cards.some((c) => c.jobId === job)).toBe(false);
  });

  it("before the pilot (apply mode off) the picks say ready and do not apply", async () => {
    const student = await mkStudent("Kabir Shah");
    await S.setAutoApply(ctxFor(student.id), { granted: true });
    signIn(student);
    vi.stubEnv("HIRELANE_AUTO_APPLY", "off");
    try {
      const off = await prod.loadStudentPicks();
      if (off.source !== "real") throw new Error("expected real");
      expect(off.data).toMatchObject({ pilot: false, autoApply: false });
    } finally {
      vi.unstubAllEnvs();
    }
    vi.stubEnv("HIRELANE_AUTO_APPLY", "fixture");
    try {
      const on = await prod.loadStudentPicks();
      if (on.source !== "real") throw new Error("expected real");
      expect(on.data).toMatchObject({ pilot: true, autoApply: true });
      expect(on.data.applyAddress).toMatch(/@/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("student loaders: needs you, tracker and finish", () => {
  async function blocked(student: Who, title: string) {
    const job = await mkJob(title);
    const r = await S.swipeRight(ctxFor(student.id), { jobId: job });
    await client.query("UPDATE applications SET undo_until = now() - interval '10 seconds' WHERE id = $1", [r.application.id]);
    await client.query("UPDATE applications SET status = 'submitting' WHERE id = $1", [r.application.id]);
    await client.query("UPDATE applications SET status = 'blocked_fallback', blocked_reason = 'login_wall' WHERE id = $1", [r.application.id]);
    return { id: r.application.id, job };
  }

  it("an application that stopped on a sign-in shows on Home, the Tracker badge and the Finish page, with the company's own form", async () => {
    const student = await mkStudent("Rahul Verma");
    const a = await blocked(student, "Customer Success Associate");
    signIn(student);
    const home = await prod.loadStudentHome();
    if (home.source !== "real") throw new Error("expected real");
    expect(home.data.finish.map((f) => f.id)).toContain(a.id);
    expect(home.data.badge).toBe(1);
    const tr = await prod.loadStudentTracker({});
    if (tr.source !== "real") throw new Error("expected real");
    expect(tr.data.view.groups.find((g) => g.id === "needs")!.rows.map((r) => r.id)).toEqual([a.id]);
    expect(tr.data.view.groups.find((g) => g.id === "needs")!.rows[0]!.finish).toBe(true);
    const f = await prod.loadFinish(a.id);
    if (f.source !== "real") throw new Error("expected real");
    expect(f.data.finish).toMatchObject({ id: a.id, role: "Customer Success Associate", url: expect.stringMatching(/^https:\/\/greenhouse\.fixture\.invalid\/.+\/apply$/), host: "greenhouse.fixture.invalid" });
    expect(f.data.chrome).toMatchObject({ initial: "R", badge: 1 });
  });

  it("someone else's application, and one that does not exist, are a 404", async () => {
    const owner = await mkStudent("Owner One");
    const other = await mkStudent("Other Two");
    const a = await blocked(owner, "Analyst Trainee");
    signIn(other);
    await expect(prod.loadFinish(a.id)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(prod.loadFinish(randomUUID())).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("an application that is not blocked has no finish view, so the page can send the student back to the Tracker", async () => {
    const student = await mkStudent("Sana Khan");
    const job = await mkJob("Operations Trainee");
    const r = await S.swipeRight(ctxFor(student.id), { jobId: job });
    signIn(student);
    const f = await prod.loadStudentTracker({ a: r.application.id });
    if (f.source !== "real") throw new Error("expected real");
    expect(f.data.selected).toMatchObject({ id: r.application.id, receipt: null });
    const fin = await prod.loadFinish(r.application.id);
    if (fin.source !== "real") throw new Error("expected real");
    expect(fin.data.finish).toBeNull();
  });

  it("recorded offers appear in the Offer stage", async () => {
    const student = await mkStudent("Dev Patel");
    const campusId = randomUUID();
    const cohortId = randomUUID();
    await client.query("INSERT INTO campuses (id, name, code_hmac) VALUES ($1, $2, $3)", [campusId, `Student Load College ${campusId.slice(0, 6)}`, `hmac-${campusId}`]);
    await client.query("INSERT INTO cohorts (id, campus_id, passout_year, programme) VALUES ($1, $2, 2026, 'B.Com')", [cohortId, campusId]);
    await client.query("INSERT INTO cohort_members (user_id, campus_id, cohort_id, verified_via, verified_at, email_hmac, share_level) VALUES ($1, $2, $3, 'email', now(), $4, 'aggregate')", [student.id, campusId, cohortId, `m-${student.id}`]);
    await S.reportOutcome(ctxFor(student.id), { kind: "offer", employer: "Saarthi Health", roleTitle: "Patient Support Executive" });
    signIn(student);
    const tr = await prod.loadStudentTracker({});
    if (tr.source !== "real") throw new Error("expected real");
    const offer = tr.data.view.groups.find((g) => g.id === "offer")!;
    expect(offer.rows.map((r) => [r.company, r.pill])).toEqual([["Saarthi Health", "Offer"]]);
    const ob = await prod.loadOnboarding();
    if (ob.source !== "real") throw new Error("expected real");
    expect(ob.data.joined).toBe(true);
  });
});
