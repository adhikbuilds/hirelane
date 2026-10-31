import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { generateMasterKey, LocalBlobStore, open } from "@hirelane/vault";
import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authTestDb } from "./helpers/auth-db";

// /api/v1 and the matching server actions, end to end against a real migrated database (RLS applies).
// Only the Next request plumbing and the job queue are faked. Synthetic data only.
const jar = new Map<string, string>();
let reqHeaders: Record<string, string> = {};
const addJob = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => undefined));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(reqHeaders),
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: () => undefined,
  }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
vi.mock("@hirelane/db", async (orig) => ({ ...(await orig<typeof import("@hirelane/db")>()), addJob }));

const ORIGIN = "http://localhost:3001";
const PDF_MIME = "application/pdf";
const pdfBytes = (tag = "a") => Buffer.from(`%PDF-1.4\n% synthetic ${tag} ${randomUUID()}\n%%EOF\n`);
const docxBytes = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(`synthetic ${randomUUID()}`)]);

let client: Client;
let close: () => Promise<void>;
let closePool: () => Promise<void>;
let storage: string;
let n = 0;

type Who = { id: string; token: string };
let alice: Who;
let bob: Who;

async function mkWho(): Promise<Who> {
  const id = randomUUID();
  await client.query(
    `WITH u AS (INSERT INTO users (id, email, email_verified_at) VALUES ($1, $2, now()) RETURNING id)
     INSERT INTO consents (user_id, kind, granted, doc_version) SELECT id, 'age_18_plus', true, 'test' FROM u`,
    [id, `v1-fixture-${++n}-${id.slice(0, 6)}@example.test`],
  );
  const { startSession, defaultAuthDeps } = await import("../lib/auth/session");
  const s = await startSession(defaultAuthDeps(), { userId: id });
  return { id, token: s.token };
}

type Opts = { who?: Who | null; origin?: string | null; idem?: string | null; body?: unknown; raw?: Buffer | string; type?: string; headers?: Record<string, string> };
let keyN = 0;
async function call(handler: (r: Request, c: { params: Promise<any> }) => Promise<Response>, method: string, path: string, o: Opts = {}, params?: Record<string, string>) {
  const who = o.who === undefined ? alice : o.who;
  const h: Record<string, string> = { host: "localhost:3001", ...(o.headers ?? {}) };
  if (who) h["cookie"] = `__Host-hl_session=${who.token}`;
  if (o.origin !== null && method !== "GET") h["origin"] = o.origin ?? ORIGIN;
  if (method !== "GET" && o.idem !== null) h["idempotency-key"] = o.idem ?? `key-${++keyN}-${randomUUID()}`;
  let body: BodyInit | undefined;
  if (o.body !== undefined) {
    h["content-type"] = "application/json";
    body = JSON.stringify(o.body);
  } else if (o.raw !== undefined) {
    h["content-type"] = o.type ?? PDF_MIME;
    body = new Uint8Array(typeof o.raw === "string" ? Buffer.from(o.raw) : o.raw);
  }
  const req = new Request(`${ORIGIN}${path}`, { method, headers: h, ...(body !== undefined ? { body } : {}) });
  const res = await handler(req, { params: Promise.resolve(params ?? {}) });
  const text = await res.clone().text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { res, json, status: res.status };
}

const routes = async () => ({
  resumes: await import("../app/api/v1/resumes/route"),
  resume: await import("../app/api/v1/resumes/[id]/route"),
  confirm: await import("../app/api/v1/resumes/[id]/confirm/route"),
  file: await import("../app/api/v1/resumes/[id]/file/route"),
  elig: await import("../app/api/v1/eligibility/route"),
  steps: await import("../app/api/v1/builder/steps/route"),
  finish: await import("../app/api/v1/builder/finish/route"),
  me: await import("../app/api/v1/me/route"),
  consents: await import("../app/api/v1/me/consents/route"),
  export: await import("../app/api/v1/me/export/route"),
  openapi: await import("../app/api/v1/openapi.json/route"),
});
type Routes = Awaited<ReturnType<typeof routes>>;
let R: Routes;

const upload = (o: Opts = {}) => call(R.resumes.POST, "POST", "/api/v1/resumes", { raw: pdfBytes(), headers: { "x-file-name": encodeURIComponent("Asha Rao CV.pdf") }, ...o });

/** What the extractor worker would do: write the masked parse as the owner role. */
async function markParsed(who: Who, id: string, over: Record<string, unknown> = {}) {
  const { sealJson, parsedAad } = await import("@hirelane/services");
  const { serviceCtxFor } = await import("../lib/http/ctx");
  const enc = await sealJson(serviceCtxFor(who.id), parsedAad(who.id, id), {
    v: 1,
    fileName: "Asha Rao CV.pdf",
    text: "Education ... XXXXXXXXXXXX ...",
    education: [{ level: "ug", board: null, score: { kind: "cgpa", value: 8.1, scale: 10 }, startYear: 2021, passoutYear: 2025, degree: "B.Tech", branch: "CSE", confidence: "high", evidence: [] }],
    backlogs: { active: 0, history: 1 },
    findings: [{ kind: "aadhaar", start: 10, end: 22, severity: "high" }],
    sections: [],
    ...over,
  });
  await client.query(
    `UPDATE resumes SET parse_status = 'parsed', parsed_version = 1, parsed_enc = $2, pages = 1, text_layer = 'readable', producer_family = 'word',
       health = '[]'::jsonb, health_passed = 6, health_total = 9, sensitive_kinds = ARRAY['aadhaar'] WHERE id = $1`,
    [id, enc],
  );
}

const ELIG = { pct_10: 82.5, board_10: "CBSE", secondary_kind: "12th", pct_secondary: 78, grad_score: 8.1, grad_scale: 10, grad_conversion: "unknown", active_backlogs: 0, backlog_history: 1, passout_year: 2025, degree: "B.Tech", branch_code: "CSE" };

beforeAll(async () => {
  const db = await authTestDb("hirelane_api_vone_test");
  client = db.client;
  close = db.close;
  storage = mkdtempSync(join(tmpdir(), "hirelane-v1-"));
  process.env["DATABASE_URL"] = db.url;
  process.env["HIRELANE_MASTER_KEY"] = generateMasterKey();
  process.env["HIRELANE_STORAGE_DIR"] = storage;
  process.env["HIRELANE_ACCOUNTS"] = "1";
  closePool = (await import("@hirelane/db")).close;
  R = await routes();
  alice = await mkWho();
  bob = await mkWho();
});
afterAll(async () => {
  await closePool();
  await close();
  rmSync(storage, { recursive: true, force: true });
  delete process.env["HIRELANE_ACCOUNTS"];
});
beforeEach(async () => {
  addJob.mockClear();
  jar.clear();
  process.env["HIRELANE_ACCOUNTS"] = "1";
  reqHeaders = { origin: ORIGIN, host: "localhost:3001", "user-agent": "vitest" };
  // Each test starts with no resumes (the owner role may delete; the app role cannot).
  await client.query("DELETE FROM resumes");
  await client.query("DELETE FROM eligibility_profiles");
  await client.query("DELETE FROM idempotency_keys");
  await client.query("DELETE FROM file_access_log");
  await client.query("DELETE FROM rate_limits");
  rmSync(join(storage, "resumes"), { recursive: true, force: true });
});

describe("v1 wrapper", () => {
  it("flag off: 404 problem+json", async () => {
    process.env["HIRELANE_ACCOUNTS"] = "0";
    const r = await call(R.me.GET, "GET", "/api/v1/me");
    expect(r.status).toBe(404);
    expect(r.res.headers.get("content-type")).toMatch(/application\/problem\+json/);
    expect(r.json.code).toBe("not_found");
  });

  it("no session, a garbage cookie and a Bearer header are all 401", async () => {
    expect((await call(R.me.GET, "GET", "/api/v1/me", { who: null })).status).toBe(401);
    expect((await call(R.me.GET, "GET", "/api/v1/me", { who: { id: alice.id, token: "hl_s_nope" } })).status).toBe(401);
    const b = await call(R.me.GET, "GET", "/api/v1/me", { who: null, headers: { authorization: "Bearer hl_at_aaaaaaaaaaaaaaaaaaaaaaaa" } });
    expect(b.status).toBe(401);
    expect(b.json.code).toBe("unauthenticated");
  });

  it("mutations need the same Origin and an Idempotency-Key; reads need neither", async () => {
    expect((await call(R.elig.PUT, "PUT", "/api/v1/eligibility", { body: { values: ELIG }, origin: null })).status).toBe(403);
    expect((await call(R.elig.PUT, "PUT", "/api/v1/eligibility", { body: { values: ELIG }, origin: "https://evil.example.test" })).status).toBe(403);
    const noKey = await call(R.elig.PUT, "PUT", "/api/v1/eligibility", { body: { values: ELIG }, idem: null });
    expect([noKey.status, noKey.json.code]).toEqual([400, "idempotency_key_required"]);
    expect((await call(R.elig.GET, "GET", "/api/v1/eligibility")).status).toBe(200);
  });

  it("rate limits per user with Retry-After", async () => {
    await client.query("DELETE FROM rate_limits");
    let last = 0;
    let retry: string | null = null;
    for (let i = 0; i < 125; i++) {
      const r = await call(R.me.GET, "GET", "/api/v1/me");
      last = r.status;
      if (last === 429) {
        retry = r.res.headers.get("retry-after");
        break;
      }
    }
    expect(last).toBe(429);
    expect(Number(retry)).toBeGreaterThan(0);
    // another user is unaffected
    expect((await call(R.me.GET, "GET", "/api/v1/me", { who: bob })).status).toBe(200);
  });

  it("a replayed Idempotency-Key returns the stored response; the same key on another body is 422", async () => {
    const key = `replay-${randomUUID()}`;
    const a = await call(R.elig.PUT, "PUT", "/api/v1/eligibility", { body: { values: ELIG }, idem: key });
    const b = await call(R.elig.PUT, "PUT", "/api/v1/eligibility", { body: { values: ELIG }, idem: key });
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(b.res.headers.get("idempotent-replayed")).toBe("true");
    expect(b.json).toEqual(a.json);
    const c = await call(R.elig.PUT, "PUT", "/api/v1/eligibility", { body: { values: { ...ELIG, pct_10: 50 } }, idem: key });
    expect([c.status, c.json.code]).toEqual([422, "idempotency_key_reuse"]);
  });

  it("the stored replay body is sealed: no response value is readable in idempotency_keys", async () => {
    const key = `sealed-${randomUUID()}`;
    const a = await call(R.elig.PUT, "PUT", "/api/v1/eligibility", { body: { values: ELIG }, idem: key });
    expect(a.status).toBe(200);
    const row = (await client.query("SELECT response FROM idempotency_keys WHERE key = $1", [key])).rows[0];
    expect(row.response.state).toBe("done");
    expect(row.response.body).toBeUndefined();
    expect(typeof row.response.sealed).toBe("string");
    expect(JSON.stringify(row.response)).not.toContain(JSON.stringify(a.json).slice(1, 40));
  });

  it("an unknown failure is a bare 500 with no message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await client.query("ALTER TABLE eligibility_profiles RENAME TO eligibility_profiles_x");
    try {
      const r = await call(R.elig.GET, "GET", "/api/v1/eligibility");
      expect(r.status).toBe(500);
      expect(Object.keys(r.json).sort()).toEqual(["code", "requestId", "status", "title", "type"]);
      expect(JSON.stringify(r.json)).not.toMatch(/relation|eligibility/);
    } finally {
      await client.query("ALTER TABLE eligibility_profiles_x RENAME TO eligibility_profiles");
      spy.mockRestore();
    }
  });
});

describe("upload", () => {
  it("202, sealed blob under the agreed AAD, id-only job after commit, file name only inside parsed_enc", async () => {
    const bytes = pdfBytes("hello");
    const r = await upload({ raw: bytes });
    expect(r.status).toBe(202);
    expect(r.json.status).toBe("uploaded");
    const id = r.json.id as string;
    const row = (await client.query("SELECT * FROM resumes WHERE id = $1", [id])).rows[0];
    expect(row.user_id).toBe(alice.id);
    expect(row.parse_status).toBe("uploaded");
    expect(row.size_bytes).toBe(bytes.length);
    expect(row.blob_key).toBe(`resumes/${alice.id}/${id}`);
    expect(JSON.stringify(row)).not.toContain("Asha");
    expect(Buffer.from(row.parsed_enc).includes(Buffer.from("Asha"))).toBe(false);

    const stored = await new LocalBlobStore(storage).get(row.blob_key);
    expect(stored.includes(bytes)).toBe(false);
    const { EnvKeyProvider } = await import("@hirelane/vault");
    expect((await open(new EnvKeyProvider(), stored, { aad: `resumes:${id}:${alice.id}:file` })).equals(bytes)).toBe(true);
    await expect(open(new EnvKeyProvider(), stored, { aad: `resumes:${id}:${bob.id}:file` })).rejects.toThrow();

    expect(addJob).toHaveBeenCalledTimes(1);
    expect(addJob).toHaveBeenCalledWith("resume:extract", { resumeId: id }, { jobKey: `resume:extract:${id}` });
  });

  it("accepts DOCX; rejects the wrong magic for the declared type (415) and unknown types", async () => {
    const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect((await upload({ raw: docxBytes(), type: DOCX })).status).toBe(202);
    expect((await upload({ raw: pdfBytes(), type: DOCX })).status).toBe(415);
    expect((await upload({ raw: docxBytes(), type: PDF_MIME })).status).toBe(415);
    const t = await upload({ raw: pdfBytes(), type: "image/png" });
    expect([t.status, t.json.code]).toEqual([400, "invalid_input"]);
    expect(addJob).toHaveBeenCalledTimes(1);
  });

  it("413 on a declared length over 5 MB and on a stream that crosses the cap", async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, 0x61);
    big.write("%PDF-", 0);
    const declared = await upload({ raw: big });
    expect([declared.status, declared.json.code]).toEqual([413, "file_too_large"]);

    // No Content-Length: chunked stream, the reader cuts it off.
    const chunk = Buffer.alloc(1024 * 1024, 0x61);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(ctl) {
        if (sent++ >= 7) return ctl.close();
        ctl.enqueue(new Uint8Array(chunk));
      },
    });
    const req = new Request(`${ORIGIN}/api/v1/resumes`, {
      method: "POST",
      headers: { host: "localhost:3001", origin: ORIGIN, cookie: `__Host-hl_session=${alice.token}`, "content-type": PDF_MIME, "idempotency-key": `stream-${randomUUID()}` },
      body: stream,
      duplex: "half",
    } as RequestInit);
    const res = await R.resumes.POST(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(8);
    expect((await client.query("SELECT count(*)::int AS n FROM resumes")).rows[0].n).toBe(0);
  });

  it("the same file twice is 409; a 4th resume is 409 and leaves no blob behind", async () => {
    const same = pdfBytes("same");
    expect((await upload({ raw: same })).status).toBe(202);
    const dup = await upload({ raw: same });
    expect([dup.status, dup.json.code]).toEqual([409, "duplicate_resume"]);
    expect((await upload()).status).toBe(202);
    expect((await upload()).status).toBe(202);
    const fourth = await upload();
    expect([fourth.status, fourth.json.code]).toEqual([409, "too_many_resumes"]);
    expect((await client.query("SELECT count(*)::int AS n FROM resumes")).rows[0].n).toBe(3);
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(join(storage, "resumes", alice.id)).length).toBe(3);
  });

  it("an Idempotency-Key repeat does not store a second copy or queue a second job", async () => {
    const key = `up-${randomUUID()}`;
    const raw = pdfBytes("idem");
    const a = await upload({ raw, idem: key });
    const b = await upload({ raw, idem: key });
    expect(b.json).toEqual(a.json);
    expect(b.res.headers.get("idempotent-replayed")).toBe("true");
    expect(addJob).toHaveBeenCalledTimes(1);
  });

  it("a failed enqueue is a 503 (the row exists and can be re-queued)", async () => {
    addJob.mockRejectedValueOnce(new Error("db down: asha@example.test"));
    const r = await upload();
    expect([r.status, r.json.code]).toEqual([503, "queue_unavailable"]);
    expect(JSON.stringify(r.json)).not.toContain("asha");
  });
});

describe("read, confirm, eligibility", () => {
  it("get returns the opened, masked parse; list returns summaries only; both match the contract", async () => {
    const { ResumeViewSchema, ResumeListSchema } = await import("@hirelane/services");
    const up = await upload();
    const id = up.json.id as string;
    const pre = await call(R.resume.GET, "GET", `/api/v1/resumes/${id}`, {}, { id });
    expect(pre.status).toBe(200);
    expect(ResumeViewSchema.parse(pre.json).parseStatus).toBe("uploaded");
    await markParsed(alice, id);
    const got = await call(R.resume.GET, "GET", `/api/v1/resumes/${id}`, {}, { id });
    const view = ResumeViewSchema.parse(got.json);
    expect(view.parsed?.fileName).toBe("Asha Rao CV.pdf");
    expect(view.parsed?.findings[0]).not.toHaveProperty("value");
    expect(view.sensitiveKinds).toEqual(["aadhaar"]);
    const list = await call(R.resumes.GET, "GET", "/api/v1/resumes");
    const parsed = ResumeListSchema.parse(list.json);
    expect(parsed.resumes).toHaveLength(1);
    expect(JSON.stringify(list.json)).not.toContain("Asha");
    expect(JSON.stringify(list.json)).not.toContain("blob");
  });

  it("confirm creates a new version, makes it the default, upserts eligibility and checks parsed_version", async () => {
    const { ConfirmResultSchema, EligibilityViewSchema } = await import("@hirelane/services");
    const id = (await upload()).json.id as string;
    await markParsed(alice, id);

    const stale = await call(R.confirm.POST, "POST", `/api/v1/resumes/${id}/confirm`, { body: { parsedVersion: 0, eligibility: ELIG } }, { id });
    expect([stale.status, stale.json.code]).toEqual([409, "stale_parse"]);
    expect((await client.query("SELECT count(*)::int AS n FROM eligibility_profiles")).rows[0].n).toBe(0);

    const ok = await call(R.confirm.POST, "POST", `/api/v1/resumes/${id}/confirm`, { body: { parsedVersion: 1, skills: ["sql", "java"], eligibility: ELIG } }, { id });
    expect(ok.status).toBe(201);
    const v = ConfirmResultSchema.parse(ok.json);
    expect(v.parentId).toBe(id);
    expect(v.parseStatus).toBe("confirmed");
    expect(v.isDefault).toBe(true);
    expect(v.parsedVersion).toBe(2);
    expect(v.skills).toEqual(["sql", "java"]);

    const rows = (await client.query("SELECT id, parent_id, is_default, blob_key FROM resumes ORDER BY created_at")).rows;
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.is_default).map((r) => r.id)).toEqual([v.id]);
    expect(rows[1].blob_key).toBe(rows[0].blob_key);

    const e = await call(R.elig.GET, "GET", "/api/v1/eligibility");
    const prof = EligibilityViewSchema.parse(e.json.eligibility);
    expect(prof.pct_10).toBe(82.5); // numeric arrives as a string from pg; the service converts
    expect(prof.grad_scale).toBe(10);
    expect(prof.source_resume_id).toBe(v.id);
    // Provenance is decided against the parse, not by the client: the parse has no 10th percentage, so 82.5 is the student's.
    expect(prof.field_meta["pct_10"]).toEqual({ source: "user", confidence: "high" });
    expect(prof.field_meta["grad_score"]).toEqual({ source: "resume", confidence: "high" });
    expect(prof.field_meta["passout_year"]).toEqual({ source: "resume", confidence: "high" });

    // a version is the same file: it reports the root's health counts and sensitive kinds (the app role cannot write them)
    const gotV = await call(R.resume.GET, "GET", `/api/v1/resumes/${v.id}`, {}, { id: v.id });
    expect(gotV.json).toMatchObject({ sensitiveKinds: ["aadhaar"], healthPassed: 6, healthTotal: 9, pages: 1, textLayer: "readable" });
    expect(v).toMatchObject({ sensitiveKinds: ["aadhaar"], healthPassed: 6, healthTotal: 9 });
    const listed = (await call(R.resumes.GET, "GET", "/api/v1/resumes")).json.resumes as { id: string; sensitiveKinds: string[] }[];
    expect(listed.map((r) => [r.id === v.id, r.sensitiveKinds])).toEqual(expect.arrayContaining([[true, ["aadhaar"]]]));

    // the same screen confirming twice: the second sees the version the first made
    const twice = await call(R.confirm.POST, "POST", `/api/v1/resumes/${id}/confirm`, { body: { parsedVersion: 1, eligibility: ELIG } }, { id });
    expect([twice.status, twice.json.code]).toEqual([409, "stale_parse"]);

    // confirming the new version again makes a third row and a new default
    const again = await call(R.confirm.POST, "POST", `/api/v1/resumes/${v.id}/confirm`, { body: { parsedVersion: 2, eligibility: { ...ELIG, pct_10: 83 } } }, { id: v.id });
    expect(again.status).toBe(201);
    expect(again.json.parentId).toBe(id);
    expect((await client.query("SELECT count(*)::int AS n FROM resumes WHERE is_default")).rows[0].n).toBe(1);
  });

  it("confirm refuses a resume that has not been parsed, and bad numbers", async () => {
    const id = (await upload()).json.id as string;
    const early = await call(R.confirm.POST, "POST", `/api/v1/resumes/${id}/confirm`, { body: { parsedVersion: 0, eligibility: ELIG } }, { id });
    expect([early.status, early.json.code]).toEqual([409, "not_confirmable"]);
    await markParsed(alice, id);
    const bad = await call(R.confirm.POST, "POST", `/api/v1/resumes/${id}/confirm`, { body: { parsedVersion: 1, eligibility: { pct_10: 101 } } }, { id });
    expect([bad.status, bad.json.code]).toEqual([400, "invalid_input"]);
    expect(bad.json.issues).toEqual([{ path: "eligibility.pct_10", code: "too_big" }]);
    const extra = await call(R.confirm.POST, "POST", `/api/v1/resumes/${id}/confirm`, { body: { parsedVersion: 1, eligibility: {}, role: "admin" } }, { id });
    expect(extra.status).toBe(400);
  });

  it("PUT eligibility validates, stores numbers and moves confirmed_at; values never appear in errors", async () => {
    const { EligibilityViewSchema } = await import("@hirelane/services");
    const bad = [
      { grad_score: 9, grad_scale: 5 },
      { grad_scale: 7 },
      { grad_conversion: "campus:not-a-uuid" },
      { active_backlogs: -1 },
      { passout_year: 1800 },
      { unknown_field: 1 },
    ];
    for (const values of bad) {
      const r = await call(R.elig.PUT, "PUT", "/api/v1/eligibility", { body: { values } });
      expect(r.status, JSON.stringify(values)).toBe(400);
      expect(JSON.stringify(r.json)).not.toMatch(/1800|not-a-uuid/);
    }
    const ok = await call(R.elig.PUT, "PUT", "/api/v1/eligibility", { body: { values: { ...ELIG, grad_conversion: `campus:${randomUUID()}` } } });
    expect(ok.status).toBe(200);
    const view = EligibilityViewSchema.parse(ok.json);
    expect(view.field_meta["pct_10"]?.source).toBe("user");
    expect(typeof view.grad_pct_equiv).toBe("undefined");
    const again = await call(R.elig.PUT, "PUT", "/api/v1/eligibility", { body: { values: { pct_10: 70 } } });
    expect(EligibilityViewSchema.parse(again.json).board_10).toBeUndefined(); // omitted means unknown
  });

  it("a non-JSON or oversized body is refused", async () => {
    expect((await call(R.elig.PUT, "PUT", "/api/v1/eligibility", { raw: "{}", type: "text/plain" })).status).toBe(415);
    const r = await call(R.elig.PUT, "PUT", "/api/v1/eligibility", { raw: "{nope", type: "application/json" });
    expect([r.status, r.json.code]).toEqual([400, "invalid_json"]);
    const huge = await call(R.elig.PUT, "PUT", "/api/v1/eligibility", { raw: " ".repeat(70_000), type: "application/json" });
    expect(huge.status).toBe(413);
  });
});

describe("download and delete", () => {
  it("download returns the original bytes and writes file_access_log in the same transaction", async () => {
    const bytes = pdfBytes("dl");
    const id = (await upload({ raw: bytes })).json.id as string;
    const r = await call(R.file.GET, "GET", `/api/v1/resumes/${id}/file`, { headers: { "x-forwarded-for": "10.9.8.7" } }, { id });
    expect(r.status).toBe(200);
    expect(Buffer.from(await r.res.arrayBuffer()).equals(bytes)).toBe(true);
    expect(r.res.headers.get("content-disposition")).toMatch(/^attachment; filename="resume-[0-9a-f]{8}\.pdf"$/);
    expect(r.res.headers.get("content-disposition")).not.toContain("Asha");
    const log = (await client.query("SELECT user_id, resume_id, action, ip_hash FROM file_access_log")).rows;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ user_id: alice.id, resume_id: id, action: "download" });
    expect(log[0].ip_hash === null || /^[0-9a-f]{64}$/.test(log[0].ip_hash)).toBe(true);
    expect(JSON.stringify(log)).not.toContain("10.9.8.7");
  });

  it("a missing blob is a 404 and leaves no audit row", async () => {
    const id = (await upload()).json.id as string;
    rmSync(join(storage, "resumes", alice.id, id));
    const r = await call(R.file.GET, "GET", `/api/v1/resumes/${id}/file`, {}, { id });
    expect(r.status).toBe(404);
    expect((await client.query("SELECT count(*)::int AS n FROM file_access_log")).rows[0].n).toBe(0);
  });

  it("delete sets deleted_at and purge_after together, takes the versions too, hides the resume and queues the purge", async () => {
    const { DeleteResultSchema } = await import("@hirelane/services");
    const id = (await upload()).json.id as string;
    await markParsed(alice, id);
    await call(R.confirm.POST, "POST", `/api/v1/resumes/${id}/confirm`, { body: { parsedVersion: 1, eligibility: ELIG } }, { id });
    addJob.mockClear();
    const d = await call(R.resume.DELETE, "DELETE", `/api/v1/resumes/${id}`, {}, { id });
    expect(d.status).toBe(200);
    DeleteResultSchema.parse(d.json);
    const rows = (await client.query("SELECT deleted_at, purge_after FROM resumes")).rows;
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.deleted_at).not.toBeNull();
      expect(r.purge_after).not.toBeNull();
      expect(r.purge_after.getTime() - r.deleted_at.getTime()).toBeLessThan(24 * 3600_000);
    }
    expect(addJob).toHaveBeenCalledWith("resume:purge", { resumeId: id }, { jobKey: `resume:purge:${id}` });
    expect((await call(R.resume.GET, "GET", `/api/v1/resumes/${id}`, {}, { id })).status).toBe(404);
    expect((await call(R.resume.DELETE, "DELETE", `/api/v1/resumes/${id}`, {}, { id })).status).toBe(404);
    expect((await call(R.file.GET, "GET", `/api/v1/resumes/${id}/file`, {}, { id })).status).toBe(404);
    expect((await call(R.resumes.GET, "GET", "/api/v1/resumes")).json.resumes).toEqual([]);
    // the slot is free again
    expect((await upload()).status).toBe(202);
  });
});

describe("versions share their root's file", () => {
  async function confirmed() {
    const id = (await upload()).json.id as string;
    await markParsed(alice, id);
    const v = (await call(R.confirm.POST, "POST", `/api/v1/resumes/${id}/confirm`, { body: { parsedVersion: 1, eligibility: ELIG } }, { id })).json.id as string;
    addJob.mockClear();
    return { root: id, version: v };
  }

  it("deleting a version deletes the whole family and purges via the root, so the root's file is never orphaned", async () => {
    const { root, version } = await confirmed();
    const d = await call(R.resume.DELETE, "DELETE", `/api/v1/resumes/${version}`, {}, { id: version });
    expect(d.status).toBe(200);
    const rows = (await client.query("SELECT id, deleted_at, purge_after FROM resumes")).rows;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.deleted_at && r.purge_after)).toBe(true);
    expect(addJob).toHaveBeenCalledTimes(1);
    expect(addJob).toHaveBeenCalledWith("resume:purge", { resumeId: root }, { jobKey: `resume:purge:${root}` });
  });

  it("a version whose root was deleted or replaced is hidden", async () => {
    const { root, version } = await confirmed();
    await client.query("UPDATE resumes SET deleted_at = now(), purge_after = now() WHERE id = $1", [root]);
    expect((await call(R.resume.GET, "GET", `/api/v1/resumes/${version}`, {}, { id: version })).status).toBe(404);
    expect((await call(R.file.GET, "GET", `/api/v1/resumes/${version}/file`, {}, { id: version })).status).toBe(404);
    expect((await call(R.resumes.GET, "GET", "/api/v1/resumes")).json.resumes).toEqual([]);
  });
});

describe("builder", () => {
  const CONTACT = { name: "Asha Rao", email: "asha.rao@example.test", phone: "90000 00001" };
  const EDU = { education: [{ qualification: "B.Tech CSE", institution: "Example Institute", year: "2025", score: "8.1 CGPA" }] };
  const SKILLS = { skills: ["Java", "SQL", "Git"] };
  const PROJECTS = { projects: [{ title: "Library app", bullets: ["Built a catalogue used by 3 teams"] }] };
  const step = (body: unknown) => call(R.steps.POST, "POST", "/api/v1/builder/steps", { body });

  it("steps build a sealed draft; finish needs the required answers, then queues the render with the id only", async () => {
    const { BuilderStateSchema, BuilderFinishSchema } = await import("@hirelane/services");
    const s1 = await step({ step: "contact", data: CONTACT });
    expect(s1.status).toBe(200);
    const st = BuilderStateSchema.parse(s1.json);
    expect(st.answered).toEqual(["contact"]);
    expect(st.missing).toEqual(["education", "skills", "projects"]);
    const draft = (await client.query("SELECT source, mime, parse_status, blob_key, file_hmac, size_bytes, parsed_enc FROM resumes WHERE id = $1", [st.draftId])).rows[0];
    expect(draft).toMatchObject({ source: "builder", mime: PDF_MIME, parse_status: "draft", blob_key: null, file_hmac: null, size_bytes: null });
    expect(Buffer.from(draft.parsed_enc).includes(Buffer.from("asha.rao"))).toBe(false);

    const early = await call(R.finish.POST, "POST", "/api/v1/builder/finish", { body: { draftId: st.draftId } });
    expect([early.status, early.json.code]).toEqual([422, "incomplete_draft"]);
    expect(early.json.issues.map((i: { path: string }) => i.path)).toEqual(["education", "skills", "projects"]);
    expect(addJob).not.toHaveBeenCalled();

    for (const [name, data] of [["education", EDU], ["skills", SKILLS], ["projects", PROJECTS]] as const) {
      expect((await step({ draftId: st.draftId, step: name, data })).status).toBe(200);
    }
    const done = await call(R.finish.POST, "POST", "/api/v1/builder/finish", { body: { draftId: st.draftId } });
    expect(done.status).toBe(202);
    BuilderFinishSchema.parse(done.json);
    expect(addJob).toHaveBeenCalledWith("resume:render", { resumeId: st.draftId }, { jobKey: `resume:render:${st.draftId}` });

    const got = await call(R.resume.GET, "GET", `/api/v1/resumes/${st.draftId}`, {}, { id: st.draftId });
    expect(got.json.parsed.answers.skills).toEqual(["Java", "SQL", "Git"]);
    expect(got.json.parseStatus).toBe("draft");
  });

  it("answers are validated to the renderer's limits and never echoed", async () => {
    for (const bad of [
      { step: "contact", data: { ...CONTACT, email: "not-an-email" } },
      { step: "contact", data: { ...CONTACT, phone: "12345" } },
      { step: "skills", data: { skills: ["Java"] } },
      { step: "projects", data: { projects: [{ title: "x", bullets: [] }] } },
      { step: "salary", data: {} },
      { step: "skills", data: SKILLS, userId: bob.id },
    ]) {
      const r = await step(bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(JSON.stringify(r.json)).not.toMatch(/not-an-email|12345/);
    }
  });

  it("a draft counts toward the 3-resume cap", async () => {
    for (let i = 0; i < 3; i++) expect((await step({ step: "skills", data: SKILLS })).status).toBe(200);
    const r = await step({ step: "skills", data: SKILLS });
    expect([r.status, r.json.code]).toEqual([409, "too_many_resumes"]);
  });

  it("only the owner's draft can be edited or finished", async () => {
    const id = (await step({ step: "contact", data: CONTACT })).json.draftId as string;
    const r = await call(R.steps.POST, "POST", "/api/v1/builder/steps", { who: bob, body: { draftId: id, step: "skills", data: SKILLS } });
    expect(r.status).toBe(404);
    expect((await call(R.finish.POST, "POST", "/api/v1/builder/finish", { who: bob, body: { draftId: id } })).status).toBe(404);
  });
});

describe("me", () => {
  it("get and export; the export has the opened parse but no blob key or file hash", async () => {
    const { MeSchema } = await import("@hirelane/services");
    const id = (await upload()).json.id as string;
    await markParsed(alice, id);
    MeSchema.parse((await call(R.me.GET, "GET", "/api/v1/me")).json);
    const ex = await call(R.export.GET, "GET", "/api/v1/me/export");
    expect(ex.status).toBe(200);
    expect(ex.json.user.id).toBe(alice.id);
    expect(ex.json.resumes).toHaveLength(1);
    expect(ex.json.resumes[0].parsed.fileName).toBe("Asha Rao CV.pdf");
    expect(ex.json.resumes[0]).not.toHaveProperty("blob_key");
    expect(ex.json.resumes[0]).not.toHaveProperty("file_hmac");
    expect(ex.json.resumes[0]).not.toHaveProperty("parsed_enc");
    expect(JSON.stringify(ex.json)).not.toContain(bob.id);
  });
});

describe("isolation: user B never sees user A's data (404, never 403)", () => {
  async function aliceResume() {
    const id = (await upload()).json.id as string;
    await markParsed(alice, id);
    return id;
  }

  it("through /api/v1", async () => {
    const id = await aliceResume();
    const b = { who: bob };
    for (const r of [
      await call(R.resume.GET, "GET", `/api/v1/resumes/${id}`, b, { id }),
      await call(R.file.GET, "GET", `/api/v1/resumes/${id}/file`, b, { id }),
      await call(R.confirm.POST, "POST", `/api/v1/resumes/${id}/confirm`, { ...b, body: { parsedVersion: 1, eligibility: ELIG } }, { id }),
      await call(R.resume.DELETE, "DELETE", `/api/v1/resumes/${id}`, b, { id }),
    ]) {
      expect(r.status).toBe(404);
      expect(r.json.code).toBe("not_found");
    }
    const missing = await call(R.resume.GET, "GET", `/api/v1/resumes/${randomUUID()}`, b, { id: randomUUID() });
    expect(missing.json).toMatchObject({ status: 404, code: "not_found", title: "not_found" }); // same shape as not-yours
    expect((await call(R.resumes.GET, "GET", "/api/v1/resumes", b)).json.resumes).toEqual([]);
    expect((await call(R.elig.GET, "GET", "/api/v1/eligibility", b)).json.eligibility).toBeNull();
    // nothing changed for A
    expect((await client.query("SELECT count(*)::int AS n FROM resumes WHERE deleted_at IS NULL AND user_id = $1", [alice.id])).rows[0].n).toBe(1);
    expect((await client.query("SELECT count(*)::int AS n FROM file_access_log")).rows[0].n).toBe(0);
    expect((await client.query("SELECT count(*)::int AS n FROM eligibility_profiles")).rows[0].n).toBe(0);
  });

  it("through the server actions", async () => {
    const id = await aliceResume();
    const actions = await import("../app/(app)/resume/actions");
    const eligActions = await import("../app/(app)/you/eligibility/actions");
    jar.set("__Host-hl_session", bob.token);
    for (const res of [
      await actions.confirmResumeAction({ id, parsedVersion: 1, eligibility: ELIG }),
      await actions.deleteResumeAction({ id }),
      await actions.finishBuilderAction({ draftId: id }),
      await actions.saveBuilderStepAction({ draftId: id, step: "skills", data: { skills: ["Java", "SQL", "Git"] } }),
    ]) {
      expect(res).toEqual({ ok: false, status: 404, code: "not_found" });
    }
    expect((await client.query("SELECT count(*)::int AS n FROM resumes WHERE deleted_at IS NULL AND user_id = $1", [alice.id])).rows[0].n).toBe(1);

    // the owner can use them
    jar.set("__Host-hl_session", alice.token);
    const ok = await actions.confirmResumeAction({ id, parsedVersion: 1, eligibility: ELIG });
    expect(ok.ok).toBe(true);
    // eligibility is per user: Bob's save does not touch Alice's row
    jar.set("__Host-hl_session", bob.token);
    expect((await eligActions.saveEligibilityAction({ values: { pct_10: 61 } })).ok).toBe(true);
    const rows = (await client.query("SELECT user_id, pct_10 FROM eligibility_profiles ORDER BY user_id")).rows;
    expect(rows.find((r) => r.user_id === alice.id).pct_10).toBe("82.50");
    expect(rows.find((r) => r.user_id === bob.id).pct_10).toBe("61.00");
  });

  it("actions: signed out is 401, cross-origin is 403, flag off is a Next 404", async () => {
    const eligActions = await import("../app/(app)/you/eligibility/actions");
    expect(await eligActions.saveEligibilityAction({ values: {} })).toEqual({ ok: false, status: 401, code: "unauthenticated" });
    jar.set("__Host-hl_session", alice.token);
    reqHeaders["origin"] = "https://evil.example.test";
    expect(await eligActions.saveEligibilityAction({ values: {} })).toEqual({ ok: false, status: 403, code: "bad_origin" });
    reqHeaders["origin"] = ORIGIN;
    process.env["HIRELANE_ACCOUNTS"] = "0";
    await expect(eligActions.saveEligibilityAction({ values: {} })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a forged user id in a body or a blob key cannot reach another user", async () => {
    const id = await aliceResume();
    const r = await call(R.confirm.POST, "POST", `/api/v1/resumes/${id}/confirm`, { who: bob, body: { parsedVersion: 1, eligibility: ELIG, userId: alice.id } }, { id });
    expect(r.status).toBe(400); // strict input: userId is not a field
    // a row pointing at someone else's blob cannot be downloaded
    await client.query("UPDATE resumes SET blob_key = $2 WHERE id = $1", [id, `resumes/${bob.id}/${randomUUID()}`]);
    expect((await call(R.file.GET, "GET", `/api/v1/resumes/${id}/file`, {}, { id })).status).toBe(404);
  });
});

describe("openapi and contract", () => {
  it("serves a separate v1 document that lists every operation and is built from the zod schemas", async () => {
    const { V1_OPERATIONS } = await import("../lib/openapi-v1");
    const res = await R.openapi.GET(new Request(`${ORIGIN}/api/v1/openapi.json`));
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(doc.openapi).toBe("3.1.0");
    for (const op of V1_OPERATIONS) {
      const o = doc.paths[op.path]?.[op.method];
      expect(o?.operationId, op.operationId).toBe(op.operationId);
      expect(o.responses[String(op.success.status)], op.operationId).toBeDefined();
      if (op.mutation && op.idempotent !== false) expect(o.parameters.some((p: { name: string }) => p.name === "Idempotency-Key")).toBe(true);
    }
    expect(doc.paths["/api/v1/resumes/{id}/confirm"].post.requestBody.content["application/json"].schema.properties).not.toHaveProperty("id");
    expect(doc.paths["/api/v1/eligibility"].put.requestBody.content["application/json"].schema.properties.values.properties.grad_scale).toBeDefined();
    expect(doc.components.schemas.Problem.properties.code).toBeDefined();
    // not the public document
    const pub = await import("../lib/openapi");
    expect(Object.keys(pub.buildOpenApi(ORIGIN).paths ?? {}).some((p) => p.startsWith("/api/v1/"))).toBe(false);
  });

  it("every error is problem+json with a request id", async () => {
    const { ProblemSchema } = await import("@hirelane/services");
    const r = await call(R.resume.GET, "GET", `/api/v1/resumes/not-a-uuid`, {}, { id: "not-a-uuid" });
    expect(r.status).toBe(400);
    const p = ProblemSchema.parse(r.json);
    expect(p.requestId).toBe(r.res.headers.get("x-request-id"));
    expect(r.res.headers.get("content-type")).toMatch(/problem\+json/);
    expect(r.res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("openapi is not published while the accounts flag is off", () => {
  it("404 with no cache headers when off, 200 when on", async () => {
    process.env["HIRELANE_ACCOUNTS"] = "0";
    const off = await R.openapi.GET(new Request(`${ORIGIN}/api/v1/openapi.json`));
    expect(off.status).toBe(404);
    expect(off.headers.get("cache-control")).not.toMatch(/public/);
    process.env["HIRELANE_ACCOUNTS"] = "1";
    expect((await R.openapi.GET(new Request(`${ORIGIN}/api/v1/openapi.json`))).status).toBe(200);
  });
});

describe("idempotency is bound to the query string too", () => {
  it("the same key with a different ?label= is a client bug (422), not a replay", async () => {
    const key = `idem-label-${randomUUID()}`;
    const raw = pdfBytes("q");
    const a = await call(R.resumes.POST, "POST", "/api/v1/resumes?label=One", { raw, idem: key });
    expect(a.status).toBe(202);
    const b = await call(R.resumes.POST, "POST", "/api/v1/resumes?label=Two", { raw, idem: key });
    expect(b.status).toBe(422);
  });
});

describe("account and consent over v1 (twins of the /you server actions)", () => {
  it("POST /me/consents records an append-only choice and refuses unknown kinds", async () => {
    const ok = await call(R.consents.POST, "POST", "/api/v1/me/consents", { body: { kind: "analytics", granted: true } });
    expect([ok.status, ok.json]).toEqual([200, { ok: true }]);
    await call(R.consents.POST, "POST", "/api/v1/me/consents", { body: { kind: "analytics", granted: false } });
    const rows = await client.query("SELECT granted FROM consents WHERE user_id = $1 AND kind = 'analytics' ORDER BY created_at, id", [alice.id]).catch(() => client.query("SELECT granted FROM consents WHERE user_id = $1 AND kind = 'analytics'", [alice.id]));
    expect(rows.rows.map((r) => r.granted).sort()).toEqual([false, true]);
    const bad = await call(R.consents.POST, "POST", "/api/v1/me/consents", { body: { kind: "age_18_plus", granted: true } });
    expect(bad.status).toBe(400);
  });

  it("DELETE /me needs confirm:true; then removes the account, its rows and its files", async () => {
    const who = await mkWho();
    const up = await call(R.resumes.POST, "POST", "/api/v1/resumes", { who, raw: pdfBytes("del"), headers: { "x-file-name": "x.pdf" } });
    expect(up.status).toBe(202);
    const key = (await client.query("SELECT blob_key FROM resumes WHERE user_id = $1", [who.id])).rows[0].blob_key as string;
    expect(existsSync(join(storage, key))).toBe(true);

    const refused = await call(R.me.DELETE, "DELETE", "/api/v1/me", { who, body: { confirm: false } });
    expect(refused.status).toBe(400);
    expect(existsSync(join(storage, key))).toBe(true);

    const done = await call(R.me.DELETE, "DELETE", "/api/v1/me", { who, idem: null, body: { confirm: true } });
    expect([done.status, done.json]).toEqual([200, { deleted: true }]);
    expect(existsSync(join(storage, key))).toBe(false);
    expect((await client.query("SELECT 1 FROM users WHERE id = $1", [who.id])).rowCount).toBe(0);
    expect((await client.query("SELECT 1 FROM resumes WHERE user_id = $1", [who.id])).rowCount).toBe(0);
    expect((await call(R.me.GET, "GET", "/api/v1/me", { who })).status).toBe(401);
  });
});

describe("confirm never adds a version under a deleted root", () => {
  it("a live version whose root was soft-deleted is 404 on confirm and gains no row", async () => {
    const id = (await upload()).json.id as string;
    await markParsed(alice, id);
    const v = (await call(R.confirm.POST, "POST", `/api/v1/resumes/${id}/confirm`, { body: { parsedVersion: 1, eligibility: ELIG } }, { id })).json.id as string;
    await client.query("UPDATE resumes SET deleted_at = now(), purge_after = now() WHERE id = $1", [id]);
    const before = (await client.query("SELECT count(*)::int AS n FROM resumes")).rows[0].n;
    const r = await call(R.confirm.POST, "POST", `/api/v1/resumes/${v}/confirm`, { body: { parsedVersion: 2, eligibility: ELIG } }, { id: v });
    expect(r.status).toBe(404);
    expect((await client.query("SELECT count(*)::int AS n FROM resumes")).rows[0].n).toBe(before);
  });
});
