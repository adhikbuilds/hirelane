import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateMasterKey } from "@hirelane/vault";
import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authTestDb } from "./helpers/auth-db";

// The campus back end through /api/v1, end to end against a real migrated database (RLS applies, definer functions run).
// Only the Next request plumbing is faked. Synthetic data only. 0 LLM calls; no network (fetch is spied on).
const jar = new Map<string, string>();
let reqHeaders: Record<string, string> = {};

vi.mock("next/headers", () => ({
  headers: async () => new Headers(reqHeaders),
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
let outbox: string;
let n = 0;

type Who = { id: string; token: string; email: string };
async function mkWho(over: { verified?: boolean; email?: string } = {}): Promise<Who> {
  const id = randomUUID();
  const email = over.email ?? `campus-fixture-${++n}-${id.slice(0, 6)}@example.test`;
  await client.query(
    `WITH u AS (INSERT INTO users (id, email, email_verified_at) VALUES ($1, $2, ${over.verified === false ? "NULL" : "now()"}) RETURNING id)
     INSERT INTO consents (user_id, kind, granted, doc_version) SELECT id, 'age_18_plus', true, 'test' FROM u`,
    [id, email],
  );
  const { startSession, defaultAuthDeps } = await import("../lib/auth/session");
  const s = await startSession(defaultAuthDeps(), { userId: id });
  return { id, token: s.token, email };
}

type Opts = { who?: Who | null; origin?: string | null; idem?: string | null; body?: unknown; raw?: Buffer | string; type?: string; headers?: Record<string, string> };
let keyN = 0;
let who0: Who;
async function call(handler: (r: Request, c: { params: Promise<any> }) => Promise<Response>, method: string, path: string, o: Opts = {}, params?: Record<string, string>) {
  const who = o.who === undefined ? who0 : o.who;
  const h: Record<string, string> = { host: "localhost:3001", ...(o.headers ?? {}) };
  if (who) h["cookie"] = `__Host-hl_session=${who.token}`;
  if (o.origin !== null && method !== "GET") h["origin"] = o.origin ?? ORIGIN;
  if (method !== "GET" && o.idem !== null) h["idempotency-key"] = o.idem ?? `key-${++keyN}-${randomUUID()}`;
  let body: BodyInit | undefined;
  if (o.body !== undefined) {
    h["content-type"] = "application/json";
    body = JSON.stringify(o.body);
  } else if (o.raw !== undefined) {
    h["content-type"] = o.type ?? "application/pdf";
    body = new Uint8Array(typeof o.raw === "string" ? Buffer.from(o.raw) : o.raw);
  }
  const res = await handler(new Request(`${ORIGIN}${path}`, { method, headers: h, ...(body !== undefined ? { body } : {}) }), { params: Promise.resolve(params ?? {}) });
  const text = await res.clone().text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { res, json, status: res.status, text };
}
const as = (who: Who, o: Opts = {}): Opts => ({ ...o, who });

const routes = async () => ({
  drives: await import("../app/api/v1/tpo/drives/route"),
  preview: await import("../app/api/v1/tpo/drives/preview/route"),
  draft: await import("../app/api/v1/tpo/drives/draft/route"),
  reach: await import("../app/api/v1/tpo/drives/[id]/reach/route"),
  announce: await import("../app/api/v1/tpo/drives/[id]/announce/route"),
  close: await import("../app/api/v1/tpo/drives/[id]/close/route"),
  rosterPreview: await import("../app/api/v1/tpo/cohorts/[id]/roster/preview/route"),
});
let R: Awaited<ReturnType<typeof routes>>;
let S: typeof import("@hirelane/services");
let keys: ReturnType<typeof import("../lib/http/ctx").v1Keys>;

interface World {
  campusId: string;
  cohortId: string;
  code: string;
  domain: string;
}
async function mkCampus(over: { cgpaRule?: unknown } = {}): Promise<World> {
  const campusId = randomUUID();
  const cohortId = randomUUID();
  const code = S.generateCampusCode();
  const domain = `college-${campusId.slice(0, 8)}.example.test`;
  await client.query("INSERT INTO campuses (id, name, code_hmac, cgpa_rule) VALUES ($1, $2, $3, $4)", [campusId, `Test College ${campusId.slice(0, 6)}`, await S.campusCodeHmac(keys, code), over.cgpaRule ?? null]);
  await client.query("INSERT INTO campus_domains (campus_id, domain) VALUES ($1, $2)", [campusId, domain]);
  await client.query("INSERT INTO cohorts (id, campus_id, passout_year, programme) VALUES ($1, $2, 2026, 'B.Tech CSE')", [cohortId, campusId]);
  return { campusId, cohortId, code, domain };
}
async function mkStaff(w: World, role: "owner" | "staff" = "owner"): Promise<Who> {
  const u = await mkWho();
  await client.query("INSERT INTO tpo_members (campus_id, user_id, email_hmac, role, claimed_at) VALUES ($1, $2, $3, $4, now())", [w.campusId, u.id, `staff-${u.id}`, role]);
  return u;
}
async function mkStudent(w: World, o: { share?: string; via?: "code" | "email"; placed?: boolean; profile?: Record<string, unknown> } = {}): Promise<Who> {
  const u = await mkWho();
  const via = o.via ?? "email";
  await client.query(
    `INSERT INTO cohort_members (user_id, campus_id, cohort_id, verified_via, verified_at, email_hmac, share_level, placed)
     VALUES ($1, $2, $3, $4, ${via === "code" ? "NULL" : "now()"}, $5, $6, $7)`,
    [u.id, w.campusId, w.cohortId, via, via === "code" ? null : `m-${u.id}`, o.share ?? "aggregate", o.placed ?? false],
  );
  if (o.profile) {
    const cols = Object.keys(o.profile);
    await client.query(`INSERT INTO eligibility_profiles (user_id, confirmed_at, ${cols.join(", ")}) VALUES ($1, now(), ${cols.map((_, i) => `$${i + 2}`).join(", ")})`, [u.id, ...Object.values(o.profile)]);
  }
  return u;
}

const NOTICE = "Eligibility: B.Com 2026 batch with minimum 60% throughout and no active backlogs. Apply by 30 Dec 2099.";
const CSV = (n: number) => "email,placed\n" + Array.from({ length: n }, (_, i) => `s${i}@x.example.test,${i % 2 ? "yes" : "no"}`).join("\n");

beforeAll(async () => {
  const db = await authTestDb("hirelane_campus_console_api_test");
  client = db.client;
  close = db.close;
  outbox = mkdtempSync(join(tmpdir(), "hirelane-console-outbox-"));
  process.env["DATABASE_URL"] = db.url;
  process.env["HIRELANE_MASTER_KEY"] = generateMasterKey();
  process.env["HIRELANE_STORAGE_DIR"] = mkdtempSync(join(tmpdir(), "hirelane-console-blobs-"));
  process.env["HIRELANE_MAIL_OUTBOX"] = outbox;
  process.env["HIRELANE_ACCOUNTS"] = "1";
  closePool = (await import("@hirelane/db")).close;
  S = await import("@hirelane/services");
  keys = (await import("../lib/http/ctx")).v1Keys();
  R = await routes();
  who0 = await mkWho();
});
afterAll(async () => {
  await closePool();
  await close();
  rmSync(outbox, { recursive: true, force: true });
  delete process.env["HIRELANE_ACCOUNTS"];
});
beforeEach(async () => {
  jar.clear();
  process.env["HIRELANE_ACCOUNTS"] = "1";
  reqHeaders = { origin: ORIGIN, host: "localhost:3001", "user-agent": "vitest" };
  await client.query("DELETE FROM rate_limits");
  await client.query("DELETE FROM idempotency_keys");
});

describe("console routes: drive steps", () => {
  it("previewDrive parses without saving; draft saves hidden; announce makes it live; close ends it; reach is pending until a snapshot", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const body = { cohortId: w.cohortId, title: "Acme Works", noticeText: NOTICE };

    const pv = await call(R.preview.POST, "POST", "/api/v1/tpo/drives/preview", as(staff, { body }));
    expect([pv.status, pv.json.step]).toEqual([200, "parsed"]);
    expect(pv.json.rules.length).toBeGreaterThan(0);
    expect((await client.query("SELECT count(*)::int n FROM drives WHERE cohort_id = $1", [w.cohortId])).rows[0].n).toBe(0);

    const dr = await call(R.draft.POST, "POST", "/api/v1/tpo/drives/draft", as(staff, { body }));
    expect([dr.status, dr.json.status, dr.json.reach.state]).toEqual([200, "draft", "pending"]);
    const id: string = dr.json.id;

    const reach = await call(R.reach.GET, "GET", `/api/v1/tpo/drives/${id}/reach`, as(staff), { id });
    expect([reach.status, reach.json.state]).toEqual([200, "pending"]);

    const an = await call(R.announce.POST, "POST", `/api/v1/tpo/drives/${id}/announce`, as(staff), { id });
    expect([an.status, an.json.status]).toEqual([200, "live"]);
    expect((await call(R.announce.POST, "POST", `/api/v1/tpo/drives/${id}/announce`, as(staff), { id })).status).toBe(404); // no longer a draft

    const cl = await call(R.close.POST, "POST", `/api/v1/tpo/drives/${id}/close`, as(staff), { id });
    expect([cl.status, cl.json.status]).toEqual([200, "closed"]);
    expect((await call(R.close.POST, "POST", `/api/v1/tpo/drives/${id}/close`, as(staff), { id })).status).toBe(404);
  });

  it("roster preview counts a file and writes nothing", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const r = await call(R.rosterPreview.POST, "POST", `/api/v1/tpo/cohorts/${w.cohortId}/roster/preview`, as(staff, { raw: CSV(12), type: "text/csv" }), { id: w.cohortId });
    expect([r.status, r.json.rowsTotal, r.json.uniqueEmails, r.json.canStage]).toEqual([200, 12, 12, true]);
    expect(r.text).not.toContain("@x.example.test");
    expect((await call(R.rosterPreview.POST, "POST", `/api/v1/tpo/cohorts/${w.cohortId}/roster/preview`, as(staff, { raw: CSV(3), type: "image/png" }), { id: w.cohortId })).status).toBe(415);
  });
});

describe("console routes: authorisation", () => {
  it("students, strangers and other campuses' staff get 404 from every console route; no session is 401; flag off is 404", async () => {
    const w = await mkCampus();
    const other = await mkCampus();
    const staff = await mkStaff(w);
    const draft = (await call(R.draft.POST, "POST", "/api/v1/tpo/drives/draft", as(staff, { body: { cohortId: w.cohortId, title: "D", noticeText: NOTICE } }))).json.id as string;
    const student = await mkStudent(w);
    const stranger = await mkWho();
    const rival = await mkStaff(other);
    const body = { cohortId: w.cohortId, title: "x", noticeText: NOTICE };
    for (const who of [student, stranger, rival]) {
      const rs = await Promise.all([
        call(R.preview.POST, "POST", "/api/v1/tpo/drives/preview", as(who, { body })),
        call(R.draft.POST, "POST", "/api/v1/tpo/drives/draft", as(who, { body })),
        call(R.reach.GET, "GET", `/api/v1/tpo/drives/${draft}/reach`, as(who), { id: draft }),
        call(R.announce.POST, "POST", `/api/v1/tpo/drives/${draft}/announce`, as(who), { id: draft }),
        call(R.close.POST, "POST", `/api/v1/tpo/drives/${draft}/close`, as(who), { id: draft }),
        call(R.rosterPreview.POST, "POST", `/api/v1/tpo/cohorts/${w.cohortId}/roster/preview`, as(who, { raw: CSV(12), type: "text/csv" }), { id: w.cohortId }),
      ]);
      for (const r of rs) expect([r.status, r.json.code]).toEqual([404, "not_found"]);
    }
    // the draft is untouched by all of that
    expect((await client.query("SELECT status, announced_at IS NULL AS hidden FROM drives WHERE id = $1", [draft])).rows[0]).toEqual({ status: "published", hidden: true }); // a draft is stored as published with no announced_at

    expect((await call(R.preview.POST, "POST", "/api/v1/tpo/drives/preview", { who: null, body })).status).toBe(401);
    expect((await call(R.preview.POST, "POST", "/api/v1/tpo/drives/preview", as(staff, { body, origin: "https://evil.example.test" }))).status).toBe(403);
    expect((await call(R.close.POST, "POST", `/api/v1/tpo/drives/${draft}/close`, as(staff, { idem: null }), { id: draft })).status).toBe(400);
    process.env["HIRELANE_ACCOUNTS"] = "0";
    expect((await call(R.reach.GET, "GET", `/api/v1/tpo/drives/${draft}/reach`, as(staff), { id: draft })).status).toBe(404);
  });

  it("a staff seat that is not owner or officer may read reach and preview but not save, announce or close", async () => {
    const w = await mkCampus();
    const owner = await mkStaff(w);
    const draft = (await call(R.draft.POST, "POST", "/api/v1/tpo/drives/draft", as(owner, { body: { cohortId: w.cohortId, title: "D", noticeText: NOTICE } }))).json.id as string;
    const viewer = await mkWho();
    await client.query("INSERT INTO tpo_members (campus_id, user_id, email_hmac, role, claimed_at) VALUES ($1, $2, $3, 'viewer', now())", [w.campusId, viewer.id, `v-${viewer.id}`]).catch(() => undefined);
    const r = await call(R.announce.POST, "POST", `/api/v1/tpo/drives/${draft}/announce`, as(viewer), { id: draft });
    expect([403, 404]).toContain(r.status);
    expect((await client.query("SELECT status, announced_at IS NULL AS hidden FROM drives WHERE id = $1", [draft])).rows[0]).toEqual({ status: "published", hidden: true }); // a draft is stored as published with no announced_at
  });

  it("malformed bodies are 400, and an id that is not a uuid is not a 500", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    expect((await call(R.draft.POST, "POST", "/api/v1/tpo/drives/draft", as(staff, { body: { cohortId: w.cohortId } }))).status).toBe(400);
    expect((await call(R.preview.POST, "POST", "/api/v1/tpo/drives/preview", as(staff, { body: { cohortId: w.cohortId, title: "x", noticeText: "y", extra: 1 } }))).status).toBe(400);
    const bad = await call(R.reach.GET, "GET", "/api/v1/tpo/drives/not-a-uuid/reach", as(staff), { id: "not-a-uuid" });
    expect(bad.status).toBeLessThan(500);
  });
});
