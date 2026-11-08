import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateMasterKey, seal } from "@hirelane/vault";
import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkJob } from "../../../packages/db/test/apply-helpers";
import { authTestDb } from "./helpers/auth-db";

// The apply pipeline through /api/v1, end to end against a real migrated database (RLS applies, triggers run).
// Only the Next request plumbing and the job queue are faked. Synthetic data only. 0 LLM calls; no network (fetch is spied on).
const jar = new Map<string, string>();
let reqHeaders: Record<string, string> = {};
const addJob = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => undefined));

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
vi.mock("@hirelane/db", async (orig) => ({ ...(await orig<typeof import("@hirelane/db")>()), addJob }));

const ORIGIN = "http://localhost:3001";
let client: Client;
let close: () => Promise<void>;
let closePool: () => Promise<void>;
let storage: string;
let n = 0;

type Who = { id: string; token: string; email: string };
async function mkWho(name: string | null = "Asha Kulkarni"): Promise<Who> {
  const id = randomUUID();
  const email = `apply-fixture-${++n}-${id.slice(0, 6)}@example.test`;
  await client.query(
    `WITH u AS (INSERT INTO users (id, email, email_verified_at, display_name) VALUES ($1, $2, now(), $3) RETURNING id)
     INSERT INTO consents (user_id, kind, granted, doc_version) SELECT id, 'age_18_plus', true, 'test' FROM u`,
    [id, email, name],
  );
  const { startSession, defaultAuthDeps } = await import("../lib/auth/session");
  const s = await startSession(defaultAuthDeps(), { userId: id });
  return { id, token: s.token, email };
}

type Opts = { who?: Who | null; origin?: string | null; idem?: string | null; body?: unknown; query?: string };
let keyN = 0;
let who0: Who;
async function call(handler: (r: Request, c: { params: Promise<any> }) => Promise<Response>, method: string, path: string, o: Opts = {}, params?: Record<string, string>) {
  const who = o.who === undefined ? who0 : o.who;
  const h: Record<string, string> = { host: "localhost:3001" };
  if (who) h["cookie"] = `__Host-hl_session=${who.token}`;
  if (o.origin !== null && method !== "GET") h["origin"] = o.origin ?? ORIGIN;
  if (method !== "GET" && o.idem !== null) h["idempotency-key"] = o.idem ?? `key-${++keyN}-${randomUUID()}`;
  let body: BodyInit | undefined;
  if (o.body !== undefined) {
    h["content-type"] = "application/json";
    body = JSON.stringify(o.body);
  }
  const res = await handler(new Request(`${ORIGIN}${path}${o.query ?? ""}`, { method, headers: h, ...(body !== undefined ? { body } : {}) }), { params: Promise.resolve(params ?? {}) });
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
  swipe: await import("../app/api/v1/apply/swipe/route"),
  create: await import("../app/api/v1/apply/applications/route"),
  list: await import("../app/api/v1/apply/applications/route"),
  one: await import("../app/api/v1/apply/applications/[id]/route"),
  undo: await import("../app/api/v1/apply/applications/[id]/undo/route"),
  rearm: await import("../app/api/v1/apply/applications/[id]/rearm/route"),
  finish: await import("../app/api/v1/apply/applications/[id]/finish/route"),
  inbox: await import("../app/api/v1/apply/inbox/route"),
  answers: await import("../app/api/v1/apply/answers/route"),
  answer: await import("../app/api/v1/apply/answers/[id]/route"),
  consent: await import("../app/api/v1/apply/consent/route"),
  openapi: await import("../app/api/v1/openapi.json/route"),
});
let R: Awaited<ReturnType<typeof routes>>;
let S: typeof import("@hirelane/services");
let keys: ReturnType<typeof import("../lib/http/ctx").v1Keys>;

beforeAll(async () => {
  const db = await authTestDb("hirelane_apply_api_test");
  client = db.client;
  close = db.close;
  storage = mkdtempSync(join(tmpdir(), "hirelane-apply-blobs-"));
  process.env["DATABASE_URL"] = db.url;
  process.env["HIRELANE_MASTER_KEY"] = generateMasterKey();
  process.env["HIRELANE_STORAGE_DIR"] = storage;
  process.env["HIRELANE_ACCOUNTS"] = "1";
  process.env["HIRELANE_APPLY_DOMAIN"] = "apply.example.test";
  closePool = (await import("@hirelane/db")).close;
  S = await import("@hirelane/services");
  keys = (await import("../lib/http/ctx")).v1Keys();
  R = await routes();
  who0 = await mkWho();
});
afterAll(async () => {
  await closePool();
  await close();
  rmSync(storage, { recursive: true, force: true });
  delete process.env["HIRELANE_ACCOUNTS"];
  delete process.env["HIRELANE_APPLY_DOMAIN"];
});
beforeEach(async () => {
  jar.clear();
  process.env["HIRELANE_ACCOUNTS"] = "1";
  reqHeaders = { origin: ORIGIN, host: "localhost:3001", "user-agent": "vitest" };
  addJob.mockClear();
  await client.query("DELETE FROM rate_limits");
  await client.query("DELETE FROM idempotency_keys");
});

const swipe = (who: Who, jobId: string, extra: Record<string, unknown> = {}) => call(R.swipe.POST, "POST", "/api/v1/apply/swipe", as(who, { body: { jobId, ...extra } }));
const expire = (id: string) => client.query("UPDATE applications SET undo_until = now() - interval '1 second' WHERE id = $1", [id]);

describe("wrapper rules and the document", () => {
  it("flag off is 404, no session is 401, a cross-origin mutation is 403, a missing Idempotency-Key is 400", async () => {
    process.env["HIRELANE_ACCOUNTS"] = "0";
    expect((await call(R.list.GET, "GET", "/api/v1/apply/applications")).status).toBe(404);
    process.env["HIRELANE_ACCOUNTS"] = "1";
    expect((await call(R.list.GET, "GET", "/api/v1/apply/applications", { who: null })).status).toBe(401);
    expect((await call(R.consent.PUT, "PUT", "/api/v1/apply/consent", { body: { granted: true }, origin: "https://evil.example.test" })).status).toBe(403);
    const noKey = await call(R.swipe.POST, "POST", "/api/v1/apply/swipe", { body: { jobId: randomUUID() }, idem: null });
    expect([noKey.status, noKey.json.code]).toEqual([400, "idempotency_key_required"]);
  });

  it("every apply operation is in the v1 OpenAPI document", async () => {
    const doc = (await call(R.openapi.GET, "GET", "/api/v1/openapi.json", { who: null })).json;
    for (const [p, methods] of [
      ["/api/v1/apply/swipe", ["post"]],
      ["/api/v1/apply/applications", ["get", "post"]],
      ["/api/v1/apply/applications/{id}", ["get"]],
      ["/api/v1/apply/applications/{id}/undo", ["post"]],
      ["/api/v1/apply/applications/{id}/rearm", ["post"]],
      ["/api/v1/apply/applications/{id}/finish", ["post"]],
      ["/api/v1/apply/inbox", ["get", "put"]],
      ["/api/v1/apply/answers", ["get", "put"]],
      ["/api/v1/apply/answers/{id}", ["delete"]],
      ["/api/v1/apply/consent", ["get", "put"]],
    ] as const) {
      for (const m of methods) expect(doc.paths[p]?.[m], `${m} ${p}`).toBeDefined();
    }
  });
});

describe("apply alias", () => {
  it("POST /api/v1/apply/applications applies exactly like the deprecated /swipe, and shares its rate bucket", async () => {
    const u = await mkWho();
    const j = await mkJob(client, { ats: "ashby" });
    const r = await call(R.create.POST, "POST", "/api/v1/apply/applications", as(u, { body: { jobId: j.jobId } }));
    expect(r.status).toBe(201);
    expect(S.SwipeResultSchema.parse(r.json).application).toMatchObject({ status: "ready", created: true });
    const again = await call(R.swipe.POST, "POST", "/api/v1/apply/swipe", as(u, { body: { jobId: j.jobId } }));
    expect(again.status).toBe(200);
    const rows = (await client.query("SELECT bucket FROM rate_limits")).rows.map((x: { bucket: string }) => x.bucket);
    expect(rows).toContain(`v1:apply-create:${u.id}`);
  });

  it("the document says apply, and marks /swipe deprecated", async () => {
    const doc = (await call(R.openapi.GET, "GET", "/api/v1/openapi.json", { who: null })).json;
    expect(doc.paths["/api/v1/apply/applications"].post.summary).toMatch(/apply/i);
    expect(doc.paths["/api/v1/apply/applications"].post.deprecated).toBeUndefined();
    expect(doc.paths["/api/v1/apply/swipe"].post.deprecated).toBe(true);
    expect(JSON.stringify(doc.paths["/api/v1/apply/applications"])).not.toMatch(/swip/i);
  });
});

describe("consent", () => {
  it("is off until the student says yes, then creates the apply address, and a withdrawal is a new row", async () => {
    const u = await mkWho("Rohan Mehta");
    const before = await call(R.consent.GET, "GET", "/api/v1/apply/consent", as(u));
    expect(S.ApplySettingsSchema.parse(before.json)).toEqual({ autoApply: false, decidedAt: null, applyAddress: null });
    const on = await call(R.consent.PUT, "PUT", "/api/v1/apply/consent", as(u, { body: { granted: true } }));
    expect(on.status).toBe(200);
    const settings = S.ApplySettingsSchema.parse(on.json);
    expect(settings.autoApply).toBe(true);
    expect(settings.applyAddress).toMatch(/^rohan\.mehta\.[a-z2-9]{3}\+[a-z0-9]{12}@apply\.example\.test$/);
    const off = await call(R.consent.PUT, "PUT", "/api/v1/apply/consent", as(u, { body: { granted: false } }));
    expect(S.ApplySettingsSchema.parse(off.json)).toMatchObject({ autoApply: false, applyAddress: settings.applyAddress });
    const again = await call(R.consent.GET, "GET", "/api/v1/apply/consent", as(u));
    expect(again.json).toMatchObject({ autoApply: false, applyAddress: settings.applyAddress });
    const rows = (await client.query("SELECT granted, doc_version FROM consents WHERE user_id = $1 AND kind = 'auto_apply' ORDER BY at, id", [u.id])).rows;
    expect(rows.map((r) => r.granted)).toEqual([true, false]);
    expect(rows[0].doc_version).toBe(S.AUTO_APPLY_DOC_VERSION);
  });

  it("rejects anything but a strict { granted: boolean }", async () => {
    for (const body of [{}, { granted: "yes" }, { granted: true, extra: 1 }, []]) {
      const r = await call(R.consent.PUT, "PUT", "/api/v1/apply/consent", { body });
      expect([r.status, r.json.code], JSON.stringify(body)).toEqual([400, "invalid_input"]);
    }
  });
});

describe("swipe right and undo", () => {
  it("creates the application with a 4 second window, queues the submit and returns the address used", async () => {
    const u = await mkWho();
    const j = await mkJob(client, { ats: "ashby" });
    const r = await swipe(u, j.jobId);
    expect(r.status).toBe(201);
    const v = S.SwipeResultSchema.parse(r.json);
    expect(v.application).toMatchObject({ status: "ready", created: true });
    expect(v.autoApply).toBe(false);
    expect(v.applyAddress).toMatch(/@apply\.example\.test$/);
    const secs = (Date.parse(v.application.undoUntil) - Date.now()) / 1000;
    expect(secs).toBeGreaterThan(2.5);
    expect(secs).toBeLessThanOrEqual(4.1);
    expect(addJob).toHaveBeenCalledTimes(1);
    expect(addJob).toHaveBeenCalledWith("apply:submit", { applicationId: v.application.id }, { jobKey: `apply:submit:${v.application.id}` });
    const row = (await client.query("SELECT platform, status, company_name FROM applications WHERE id = $1", [v.application.id])).rows[0];
    expect(row).toMatchObject({ platform: "ashby", status: "ready" });
  });

  it("HIRELANE_AUTO_APPLY=off: no application is created and nothing is queued (503 auto_apply_off); production defaults to off", async () => {
    const u = await mkWho();
    const j = await mkJob(client);
    const prev = process.env.HIRELANE_AUTO_APPLY;
    process.env.HIRELANE_AUTO_APPLY = "off";
    try {
      const r = await swipe(u, j.jobId);
      expect([r.status, r.json.code]).toEqual([503, "auto_apply_off"]);
      expect((await client.query("SELECT 1 FROM applications WHERE user_id = $1", [u.id])).rowCount).toBe(0);
      expect(addJob).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.HIRELANE_AUTO_APPLY;
      else process.env.HIRELANE_AUTO_APPLY = prev;
    }
    expect((await swipe(u, j.jobId)).status).toBe(201);
  });

  it("swiping the same job again changes nothing and queues nothing", async () => {
    const u = await mkWho();
    const j = await mkJob(client);
    const first = await swipe(u, j.jobId);
    addJob.mockClear();
    const second = await swipe(u, j.jobId);
    expect(second.status).toBe(200);
    expect(second.json.application).toMatchObject({ id: first.json.application.id, created: false });
    expect(addJob).not.toHaveBeenCalled();
    expect((await client.query("SELECT count(*)::int AS n FROM applications WHERE user_id = $1", [u.id])).rows[0].n).toBe(1);
  });

  it("a queue outage after the commit is not the student's problem (the sweep re-queues)", async () => {
    const u = await mkWho();
    const j = await mkJob(client);
    addJob.mockRejectedValueOnce(new Error("db down: asha@example.test"));
    const r = await swipe(u, j.jobId);
    expect(r.status).toBe(201);
    expect(r.text).not.toContain("db down");
    expect((await client.query("SELECT status FROM applications WHERE id = $1", [r.json.application.id])).rows[0].status).toBe("ready");
  });

  it("refuses an unknown job (404), a closed job (409), and bad input (400)", async () => {
    const u = await mkWho();
    expect((await swipe(u, randomUUID())).json).toMatchObject({ code: "job_not_applicable" });
    const closed = await mkJob(client, { closed: true });
    const c = await swipe(u, closed.jobId);
    expect([c.status, c.json.code]).toEqual([409, "job_closed"]);
    for (const body of [{}, { jobId: "x" }, { jobId: randomUUID(), extra: 1 }]) {
      const r = await call(R.swipe.POST, "POST", "/api/v1/apply/swipe", as(u, { body }));
      expect([r.status, r.json.code], JSON.stringify(body)).toEqual([400, "invalid_input"]);
    }
    expect(addJob).not.toHaveBeenCalled();
  });

  it("takes only the student's own resume", async () => {
    const a = await mkWho();
    const b = await mkWho();
    const j = await mkJob(client);
    const rid = randomUUID();
    await client.query(
      "INSERT INTO resumes (id, user_id, source, mime, size_bytes, file_hmac, blob_key) VALUES ($1, $2, 'upload', 'application/pdf', 10, $3, $4)",
      [rid, b.id, `h-${rid}`, `resumes/${b.id}/${rid}`],
    );
    const r = await swipe(a, j.jobId, { resumeId: rid });
    expect([r.status, r.json.code]).toEqual([404, "not_found"]);
    const mine = await swipe(b, j.jobId, { resumeId: rid });
    expect(mine.status).toBe(201);
    expect((await client.query("SELECT resume_id FROM applications WHERE id = $1", [mine.json.application.id])).rows[0].resume_id).toBe(rid);
  });

  it("undo inside the window works, then reopens on a fresh swipe", async () => {
    const u = await mkWho();
    const j = await mkJob(client);
    const id = (await swipe(u, j.jobId)).json.application.id as string;
    const undo = await call(R.undo.POST, "POST", `/api/v1/apply/applications/${id}/undo`, as(u), { id });
    expect([undo.status, undo.json]).toEqual([200, { id, status: "undone" }]);
    const again = await call(R.undo.POST, "POST", `/api/v1/apply/applications/${id}/undo`, as(u), { id });
    expect([again.status, again.json.code]).toEqual([409, "undo_window_closed"]);
    addJob.mockClear();
    const re = await swipe(u, j.jobId);
    expect(re.status).toBe(201);
    expect(re.json.application).toMatchObject({ id, status: "ready", created: true });
    expect(addJob).toHaveBeenCalledTimes(1);
  });

  it("undo after the window is 409 and changes nothing; undo of another student's application is 404", async () => {
    const a = await mkWho();
    const b = await mkWho();
    const j = await mkJob(client);
    const id = (await swipe(a, j.jobId)).json.application.id as string;
    const foreign = await call(R.undo.POST, "POST", `/api/v1/apply/applications/${id}/undo`, as(b), { id });
    expect([foreign.status, foreign.json.code]).toEqual([404, "not_found"]);
    await expire(id);
    const late = await call(R.undo.POST, "POST", `/api/v1/apply/applications/${id}/undo`, as(a), { id });
    expect([late.status, late.json.code]).toEqual([409, "undo_window_closed"]);
    expect((await client.query("SELECT status FROM applications WHERE id = $1", [id])).rows[0].status).toBe("ready");
    expect((await call(R.undo.POST, "POST", `/api/v1/apply/applications/not-a-uuid/undo`, as(a), { id: "not-a-uuid" })).status).toBe(400);
  });

  it("once the worker has claimed it, undo is refused", async () => {
    const u = await mkWho();
    const id = (await swipe(u, (await mkJob(client)).jobId)).json.application.id as string;
    await expire(id);
    await client.query("UPDATE applications SET status = 'submitting' WHERE id = $1", [id]);
    const r = await call(R.undo.POST, "POST", `/api/v1/apply/applications/${id}/undo`, as(u), { id });
    expect([r.status, r.json.code]).toEqual([409, "undo_window_closed"]);
  });

  it("replaying an Idempotency-Key returns the stored response and queues once", async () => {
    const u = await mkWho();
    const j = await mkJob(client);
    const key = `swipe-${randomUUID()}`;
    const a = await call(R.swipe.POST, "POST", "/api/v1/apply/swipe", as(u, { body: { jobId: j.jobId }, idem: key }));
    const b = await call(R.swipe.POST, "POST", "/api/v1/apply/swipe", as(u, { body: { jobId: j.jobId }, idem: key }));
    expect(b.status).toBe(a.status);
    expect(b.json).toEqual(a.json);
    expect(b.res.headers.get("idempotent-replayed")).toBe("true");
    expect(addJob).toHaveBeenCalledTimes(1);
  });
});

/** Writes what the worker would: sealed answers, a receipt and an outcome. */
async function finishAs(appId: string, userId: string, outcome: "submitted" | "blocked_fallback" | "failed") {
  await expire(appId);
  await client.query("UPDATE applications SET status = 'submitting' WHERE id = $1", [appId]);
  const sealJson = (aad: string, v: unknown) => seal(keys, Buffer.from(JSON.stringify(v)), { aad });
  const filled = randomUUID();
  await client.query(
    `INSERT INTO application_answers (id, application_id, user_id, field_id, label, question_key, required, needs_you, answer_enc, evidence_enc, evidence_sources)
     VALUES ($1, $2, $3, 'question_1002', 'What is your notice period?', 'notice_period', true, false, $4, $5, '{answer_bank:notice_period}')`,
    [filled, appId, userId, await sealJson(S.applyAnswerAad(userId, filled), "30 days"), await sealJson(S.applyEvidenceAad(userId, filled), [{ source: "answer_bank", field: "notice_period" }])],
  );
  await client.query("INSERT INTO application_answers (application_id, user_id, field_id, label, required, needs_you, reason) VALUES ($1, $2, 'q9', 'Why us?', true, true, 'We have no line about the company')", [appId, userId]);
  await client.query("INSERT INTO receipts (application_id, user_id, answers_hash, platform, result_code, sent, http_status) VALUES ($1, $2, repeat('a', 64), 'greenhouse', $3, $4, $5)", [
    appId,
    userId,
    outcome === "submitted" ? "accepted" : "needs_you",
    outcome === "submitted",
    outcome === "submitted" ? 200 : null,
  ]);
  await client.query(
    "UPDATE applications SET status = $2, blocked_reason = $3, fallback_note = $4 WHERE id = $1",
    [appId, outcome, outcome === "submitted" ? null : "needs_you", outcome === "blocked_fallback" ? "finish on their site" : null],
  );
}

describe("tracker, detail and inbox", () => {
  it("lists newest first, filters by status, and shows the fallback link only for a blocked application", async () => {
    const u = await mkWho();
    const ids: string[] = [];
    for (const o of ["submitted", "blocked_fallback", "failed"] as const) {
      const id = (await swipe(u, (await mkJob(client)).jobId)).json.application.id as string;
      await finishAs(id, u.id, o);
      ids.push(id);
    }
    const open = (await swipe(u, (await mkJob(client)).jobId)).json.application.id as string;
    const all = S.ApplicationListSchema.parse((await call(R.list.GET, "GET", "/api/v1/apply/applications", as(u))).json);
    expect(all.applications.map((a) => a.id)).toEqual([open, ...ids.slice().reverse()]);
    expect(all.applications[0]).toMatchObject({ status: "ready", canUndo: true, fallback: null });
    const blocked = all.applications.find((a) => a.status === "blocked_fallback")!;
    expect(blocked.fallback).toEqual({ message: "Finish on their site", url: expect.stringMatching(/^https:\/\/greenhouse\.fixture\.invalid\//) });
    expect(blocked).toMatchObject({ blockedReason: "needs_you", needsYouCount: 1, canUndo: false });
    expect(all.applications.find((a) => a.status === "submitted")!.fallback).toBeNull();
    const only = await call(R.list.GET, "GET", "/api/v1/apply/applications", as(u, { query: "?status=failed&limit=5" }));
    expect(only.json.applications.map((a: { id: string }) => a.id)).toEqual([ids[2]]);
    expect((await call(R.list.GET, "GET", "/api/v1/apply/applications", as(u, { query: "?status=nope" }))).status).toBe(400);
    expect((await call(R.list.GET, "GET", "/api/v1/apply/applications", as(u, { query: "?limit=1000" }))).status).toBe(400);
  });

  it("the detail opens the sealed answers for their owner, with sources and the receipt, and hides everything from others", async () => {
    const a = await mkWho();
    const b = await mkWho();
    const id = (await swipe(a, (await mkJob(client)).jobId)).json.application.id as string;
    await finishAs(id, a.id, "blocked_fallback");
    const r = await call(R.one.GET, "GET", `/api/v1/apply/applications/${id}`, as(a), { id });
    const d = S.ApplicationDetailSchema.parse(r.json);
    expect(d.application).toMatchObject({ id, status: "blocked_fallback" });
    expect(d.answers).toEqual([
      { fieldId: "q9", questionKey: null, label: "Why us?", required: true, needsYou: true, reason: "We have no line about the company", answer: null, suggestion: null, sources: [] },
      { fieldId: "question_1002", questionKey: "notice_period", label: "What is your notice period?", required: true, needsYou: false, reason: null, answer: "30 days", suggestion: null, sources: ["answer_bank:notice_period"] },
    ]);
    expect(d.receipt).toMatchObject({ platform: "greenhouse", resultCode: "needs_you", sent: false, httpStatus: null });
    expect(d.applyAddress).toMatch(/@apply\.example\.test$/);
    expect(r.text).not.toMatch(/answer_enc|evidence_enc|user_id/);
    const foreign = await call(R.one.GET, "GET", `/api/v1/apply/applications/${id}`, as(b), { id });
    expect([foreign.status, foreign.json.code]).toEqual([404, "not_found"]);
    expect((await call(R.one.GET, "GET", `/api/v1/apply/applications/${randomUUID()}`, as(a), { id: randomUUID() })).status).toBe(404);
  });

  it("a free-text draft the engine composed is shown to its owner as a suggestion (needs_you, never an answer), and to nobody else", async () => {
    const a = await mkWho();
    const b = await mkWho();
    const id = (await swipe(a, (await mkJob(client)).jobId)).json.application.id as string;
    await expire(id);
    await client.query("UPDATE applications SET status = 'submitting' WHERE id = $1", [id]);
    const rowId = randomUUID();
    const draft = "I am applying for the Engineer role at Acme. It fits my Intern experience at Beta, and I want to build on it.";
    await client.query(
      "INSERT INTO application_answers (id, application_id, user_id, field_id, label, question_key, required, needs_you, reason, suggestion_enc) VALUES ($1, $2, $3, 'why', 'Why this role?', 'why_role', true, true, 'confirm_draft', $4)",
      [rowId, id, a.id, await seal(keys, Buffer.from(JSON.stringify(draft)), { aad: S.applySuggestionAad(a.id, rowId) })],
    );
    await client.query("INSERT INTO receipts (application_id, user_id, answers_hash, platform, result_code, sent) VALUES ($1, $2, repeat('a', 64), 'greenhouse', 'needs_you', false)", [id, a.id]);
    await client.query("UPDATE applications SET status = 'blocked_fallback', blocked_reason = 'needs_you', fallback_note = 'finish on their site' WHERE id = $1", [id]);
    const d = S.ApplicationDetailSchema.parse((await call(R.one.GET, "GET", `/api/v1/apply/applications/${id}`, as(a), { id })).json);
    expect(d.answers).toEqual([{ fieldId: "why", questionKey: "why_role", label: "Why this role?", required: true, needsYou: true, reason: "confirm_draft", answer: null, suggestion: draft, sources: [] }]);
    const stored = (await client.query("SELECT suggestion_enc FROM application_answers WHERE id = $1", [rowId])).rows[0].suggestion_enc as Buffer;
    expect(stored.includes(Buffer.from("Engineer role"))).toBe(false); // sealed at rest
    const foreign = await call(R.one.GET, "GET", `/api/v1/apply/applications/${id}`, as(b), { id });
    expect(foreign.status).toBe(404);
  });

  it("the inbox opens the sealed excerpt, the detail lists the matched messages, and 'read' clears the unread count", async () => {
    const u = await mkWho();
    const other = await mkWho();
    const id = (await swipe(u, (await mkJob(client)).jobId)).json.application.id as string;
    const mid = randomUUID();
    const body = await seal(keys, Buffer.from(JSON.stringify({ subject: "Interview invitation", excerpt: "Are you free on Tuesday?" })), { aad: `inbound:${u.id}:${mid}` });
    await client.query(
      "INSERT INTO inbound_messages (id, user_id, application_id, message_id, employer, from_domain, kind, matched_by, excerpt_enc, received_at) VALUES ($1, $2, $3, 'm-1', 'Acme', 'acme.example.test', 'interview', 'domain', $4, now())",
      [mid, u.id, id, body],
    );
    await client.query("INSERT INTO notifications (user_id, kind, title, application_id, inbound_id) VALUES ($1, 'employer_message', 'Acme: interview invite', $2, $3)", [u.id, id, mid]);
    const inbox = S.InboxSchema.parse((await call(R.inbox.GET, "GET", "/api/v1/apply/inbox", as(u))).json);
    expect(inbox.unread).toBe(1);
    expect(inbox.messages).toEqual([expect.objectContaining({ id: mid, applicationId: id, employer: "Acme", kind: "interview", subject: "Interview invitation", excerpt: "Are you free on Tuesday?" })]);
    const detail = S.ApplicationDetailSchema.parse((await call(R.one.GET, "GET", `/api/v1/apply/applications/${id}`, as(u), { id })).json);
    expect(detail.messages.map((m) => m.id)).toEqual([mid]);
    expect(detail.application.lastReply).toBe("interview");
    expect((await call(R.inbox.GET, "GET", "/api/v1/apply/inbox", as(other))).json).toEqual({ unread: 0, messages: [] });
    expect((await call(R.inbox.PUT, "PUT", "/api/v1/apply/inbox", as(u))).json).toEqual({ marked: 1 });
    expect((await call(R.inbox.GET, "GET", "/api/v1/apply/inbox", as(u))).json.unread).toBe(0);
  });
});

describe("the answer bank", () => {
  it("creates, replaces in place, lists opened, seals at rest and deletes", async () => {
    const u = await mkWho();
    const put = (body: unknown) => call(R.answers.PUT, "PUT", "/api/v1/apply/answers", as(u, { body }));
    const created = await put({ questionKey: "notice_period", answer: "  30 days ", labelSeen: "Notice period" });
    expect(created.status).toBe(200);
    const e = S.AnswerBankEntrySchema.parse(created.json);
    expect(e).toMatchObject({ questionKey: "notice_period", answer: "30 days", labelSeen: "Notice period", sensitive: false, source: "user" });
    const stored = (await client.query("SELECT answer_enc FROM answer_bank WHERE id = $1", [e.id])).rows[0].answer_enc as Buffer;
    expect(stored.toString("utf8")).not.toContain("30 days");
    const replaced = S.AnswerBankEntrySchema.parse((await put({ questionKey: "notice_period", answer: "Immediately", sensitive: true })).json);
    expect(replaced).toMatchObject({ id: e.id, answer: "Immediately", sensitive: true, labelSeen: "Notice period" });
    await put({ questionKey: "relocation", answer: "Yes, anywhere in India" });
    const list = S.AnswerBankSchema.parse((await call(R.answers.GET, "GET", "/api/v1/apply/answers", as(u))).json);
    expect(list.answers.map((a) => [a.questionKey, a.answer])).toEqual([["notice_period", "Immediately"], ["relocation", "Yes, anywhere in India"]]);
    const del = await call(R.answer.DELETE, "DELETE", `/api/v1/apply/answers/${e.id}`, as(u), { id: e.id });
    expect([del.status, del.json]).toEqual([200, { deleted: true }]);
    expect((await call(R.answer.DELETE, "DELETE", `/api/v1/apply/answers/${e.id}`, as(u), { id: e.id })).status).toBe(404);
    expect((await call(R.answers.GET, "GET", "/api/v1/apply/answers", as(u))).json.answers).toHaveLength(1);
  });

  it("is per student: another student sees nothing and cannot delete", async () => {
    const a = await mkWho();
    const b = await mkWho();
    const id = (await call(R.answers.PUT, "PUT", "/api/v1/apply/answers", as(a, { body: { questionKey: "phone", answer: "+91 90000 00000" } }))).json.id as string;
    expect((await call(R.answers.GET, "GET", "/api/v1/apply/answers", as(b))).json).toEqual({ answers: [] });
    expect((await call(R.answer.DELETE, "DELETE", `/api/v1/apply/answers/${id}`, as(b), { id })).status).toBe(404);
    expect((await call(R.answers.GET, "GET", "/api/v1/apply/answers", as(a))).json.answers).toHaveLength(1);
  });

  it("validates the key and the answer", async () => {
    for (const body of [{}, { questionKey: "Bad Key", answer: "x" }, { questionKey: "ok", answer: "" }, { questionKey: "ok", answer: "   " }, { questionKey: "ok", answer: "x".repeat(2001) }, { questionKey: "ok", answer: "x", extra: true }, { questionKey: "k".repeat(81), answer: "x" }]) {
      const r = await call(R.answers.PUT, "PUT", "/api/v1/apply/answers", { body });
      expect([r.status, r.json.code], JSON.stringify(body).slice(0, 60)).toEqual([400, "invalid_input"]);
    }
  });

  it("the export of everything held about me opens these answers too (same sealing as the bank)", async () => {
    const u = await mkWho();
    await call(R.answers.PUT, "PUT", "/api/v1/apply/answers", as(u, { body: { questionKey: "expected_ctc", answer: "6 LPA" } }));
    const ctx = (await import("../lib/http/ctx")).serviceCtxFor(u.id);
    const out = (await S.exportMe(ctx)) as { answerBank: { questionKey: string; answer: unknown }[] };
    expect(out.answerBank).toEqual([expect.objectContaining({ questionKey: "expected_ctc", answer: "6 LPA" })]);
  });
});

describe("the access export covers every user-owned table", () => {
  // Tables with a user column that are deliberately NOT in the export, each with the reason.
  const EXCLUDED: Record<string, string> = {
    sessions: "credential material, not personal data held about the student",
    otp_challenges: "hashed one-time-code state, expires in minutes",
    join_attempts: "abuse-control counters holding hashed identifiers",
    idempotency_keys: "transient replay cache, purged after 24 h",
    auth_identities: "sign-in provider links; the provider and email are in `user`",
    notification_unsub: "hash of an unsubscribe token; the effect is in notificationPrefs",
    campus_otp_bindings: "single-use proof state for the college-email join",
    cohort_imports: "staff import audit, actor is staff",
    tpo_members: "staff roles",
    product_events: "pseudonymous product analytics without content",
    drives: "staff-authored; a student's own result is in driveChecks",
    feature_flags: "operator switches, not data about the student",
  };
  // export key -> table(s) it covers
  const COVERS: Record<string, string[]> = {
    profile: ["profiles"],
    eligibility: ["eligibility_profiles"],
    workAuthorizations: ["work_authorizations"],
    resumes: ["resumes"],
    answerBank: ["answer_bank"],
    consents: ["consents"],
    fileAccessLog: ["file_access_log"],
    applications: ["applications", "application_answers", "receipts"],
    applyAddress: ["apply_addresses"],
    inboundMessages: ["inbound_messages"],
    notifications: ["notifications"],
    notificationPrefs: ["notification_prefs"],
    outcomes: ["outcomes"],
    driveChecks: ["drive_checks"],
    cohortMemberships: ["cohort_members"],
    collegeAccessLog: ["tpo_access_log"],
  };

  it("fails if a table with a user_id or subject_user_id column is neither exported nor excluded with a reason", async () => {
    const tables = (
      await client.query(
        `SELECT DISTINCT table_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name IN ('user_id', 'subject_user_id', 'actor_id', 'created_by')
            AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE')`,
      )
    ).rows.map((r) => r.table_name as string);
    const known = new Set([...Object.keys(EXCLUDED), ...Object.values(COVERS).flat()]);
    expect(tables.filter((t) => !known.has(t)).sort()).toEqual([]);
    for (const t of Object.keys(EXCLUDED)) expect(Object.values(COVERS).flat(), t).not.toContain(t);
  });

  it("returns every export key, opens sealed columns, and includes applications, receipts, inbound mail and notifications", async () => {
    const u = await mkWho();
    const job = await mkJob(client);
    const id = (await swipe(u, job.jobId)).json.application.id as string;
    await finishAs(id, u.id, "submitted");
    const mid = randomUUID();
    const body = await seal(keys, Buffer.from(JSON.stringify({ subject: "Interview invitation", excerpt: "Are you free on Tuesday?" })), { aad: `inbound:${u.id}:${mid}` });
    await client.query(
      "INSERT INTO inbound_messages (id, user_id, application_id, message_id, employer, from_domain, kind, matched_by, excerpt_enc, received_at) VALUES ($1, $2, $3, 'm-x', 'Acme', 'acme.example.test', 'interview', 'domain', $4, now())",
      [mid, u.id, id, body],
    );
    await client.query("INSERT INTO notifications (user_id, kind, title, application_id, inbound_id) VALUES ($1, 'employer_message', 'Acme: interview invite', $2, $3)", [u.id, id, mid]);
    const ctx = (await import("../lib/http/ctx")).serviceCtxFor(u.id);
    const out = (await S.exportMe(ctx)) as Record<string, any>;
    for (const k of Object.keys(COVERS)) expect(out, k).toHaveProperty(k);
    expect(out.applications).toHaveLength(1);
    expect(out.applications[0]).toMatchObject({ id, status: "submitted" });
    const filled = out.applications[0].answers.find((a: { fieldId: string }) => a.fieldId === "question_1002");
    expect(filled).toMatchObject({ label: "What is your notice period?", answer: "30 days" });
    expect(out.applications[0].receipts.length).toBeGreaterThan(0);
    expect(out.inboundMessages).toEqual([expect.objectContaining({ id: mid, employer: "Acme", subject: "Interview invitation", excerpt: "Are you free on Tuesday?" })]);
    expect(out.notifications).toEqual([expect.objectContaining({ title: "Acme: interview invite" })]);
    expect(out.applyAddress).toMatchObject({ address: expect.stringMatching(/@apply\.example\.test$/) });
    expect(JSON.stringify(out)).not.toMatch(/answer_enc|excerpt_enc|evidence_enc|suggestion_enc|letter_enc/);
  });
});

describe("blocked applications are not a dead end", () => {
  const blockAs = async (userId: string, jobId: string, reason: string): Promise<string> => {
    const id = (await client.query("SELECT id FROM applications WHERE user_id = $1 AND job_id = $2", [userId, jobId])).rows[0].id as string;
    await client.query("UPDATE applications SET undo_until = now() - interval '1 second' WHERE id = $1", [id]);
    await client.query("UPDATE applications SET status = 'submitting' WHERE id = $1", [id]);
    await client.query("UPDATE applications SET status = 'blocked_fallback', blocked_reason = $2, fallback_note = 'finish on their site' WHERE id = $1", [id, reason]);
    return id;
  };

  it("re-arms an application blocked on a needs-you question: a fresh window, queued again; other blocks stay manual", async () => {
    const u = await mkWho();
    const ctx = (await import("../lib/http/ctx")).serviceCtxFor(u.id);
    const j = await mkJob(client);
    await swipe(u, j.jobId);
    const id = await blockAs(u.id, j.jobId, "needs_you");
    addJob.mockClear();
    const r = await S.rearmApplication(ctx, { id });
    expect(r).toMatchObject({ id, status: "ready" });
    expect((Date.parse(r.undoUntil) - Date.now()) / 1000).toBeGreaterThan(2.5);
    expect(addJob).toHaveBeenCalledWith("apply:submit", { applicationId: id }, { jobKey: `apply:submit:${id}` });
    expect((await client.query("SELECT status, blocked_reason FROM applications WHERE id = $1", [id])).rows[0]).toEqual({ status: "ready", blocked_reason: null });

    const j2 = await mkJob(client);
    await swipe(u, j2.jobId);
    const captcha = await blockAs(u.id, j2.jobId, "captcha");
    await expect(S.rearmApplication(ctx, { id: captcha })).rejects.toMatchObject({ code: "not_rearmable", status: 409 });
    const other = (await import("../lib/http/ctx")).serviceCtxFor((await mkWho()).id);
    await expect(S.rearmApplication(other, { id })).rejects.toMatchObject({ status: 404 });
  });

  it("lets the student mark a blocked application as finished on the employer site, once, and only their own", async () => {
    const u = await mkWho();
    const ctx = (await import("../lib/http/ctx")).serviceCtxFor(u.id);
    const j = await mkJob(client);
    await swipe(u, j.jobId);
    const id = await blockAs(u.id, j.jobId, "captcha");
    const other = (await import("../lib/http/ctx")).serviceCtxFor((await mkWho()).id);
    await expect(S.markFinishedByStudent(other, { id })).rejects.toMatchObject({ status: 404 });
    expect(await S.markFinishedByStudent(ctx, { id })).toEqual({ id, status: "submitted" });
    expect((await client.query("SELECT status, manual_finish, submitted_at IS NOT NULL AS at FROM applications WHERE id = $1", [id])).rows[0]).toEqual({ status: "submitted", manual_finish: true, at: true });
    await expect(S.markFinishedByStudent(ctx, { id })).rejects.toMatchObject({ code: "not_blocked", status: 409 });
  });

  it("POST /rearm: own needs_you application only; someone else's is 404, a captcha block is 409, no session is 401", async () => {
    const u = await mkWho();
    const j = await mkJob(client);
    await swipe(u, j.jobId);
    const id = await blockAs(u.id, j.jobId, "needs_you");
    const path = `/api/v1/apply/applications/${id}/rearm`;
    const stranger = await mkWho();
    const theirs = await call(R.rearm.POST, "POST", path, as(stranger), { id });
    expect([theirs.status, theirs.json.code]).toEqual([404, "not_found"]);
    expect((await client.query("SELECT status FROM applications WHERE id = $1", [id])).rows[0].status).toBe("blocked_fallback");
    expect((await call(R.rearm.POST, "POST", path, { who: null }, { id })).status).toBe(401);
    expect((await call(R.rearm.POST, "POST", path, as(u, { origin: "https://evil.example.test" }), { id })).status).toBe(403);
    expect((await call(R.rearm.POST, "POST", `/api/v1/apply/applications/not-a-uuid/rearm`, as(u), { id: "not-a-uuid" })).status).toBe(400);
    addJob.mockClear();
    const ok = await call(R.rearm.POST, "POST", path, as(u), { id });
    expect([ok.status, ok.json]).toEqual([200, { id, status: "ready", undoUntil: expect.any(String) }]);
    expect(S.ApplicationRearmedSchema.parse(ok.json).id).toBe(id);
    expect(addJob).toHaveBeenCalledWith("apply:submit", { applicationId: id }, { jobKey: `apply:submit:${id}` });
    const j2 = await mkJob(client);
    await swipe(u, j2.jobId);
    const captcha = await blockAs(u.id, j2.jobId, "captcha");
    const no = await call(R.rearm.POST, "POST", `/api/v1/apply/applications/${captcha}/rearm`, as(u), { id: captcha });
    expect([no.status, no.json.code]).toEqual([409, "not_rearmable"]);
  });

  it("POST /finish: own blocked application only, once; someone else's is 404 and stays blocked", async () => {
    const u = await mkWho();
    const j = await mkJob(client);
    await swipe(u, j.jobId);
    const id = await blockAs(u.id, j.jobId, "captcha");
    const path = `/api/v1/apply/applications/${id}/finish`;
    const stranger = await mkWho();
    const theirs = await call(R.finish.POST, "POST", path, as(stranger), { id });
    expect([theirs.status, theirs.json.code]).toEqual([404, "not_found"]);
    expect((await client.query("SELECT status FROM applications WHERE id = $1", [id])).rows[0].status).toBe("blocked_fallback");
    expect((await call(R.finish.POST, "POST", path, { who: null }, { id })).status).toBe(401);
    const ok = await call(R.finish.POST, "POST", path, as(u), { id });
    expect([ok.status, ok.json]).toEqual([200, { id, status: "submitted" }]);
    expect(S.ApplicationFinishedSchema.parse(ok.json).id).toBe(id);
    const again = await call(R.finish.POST, "POST", path, as(u), { id });
    expect([again.status, again.json.code]).toEqual([409, "not_blocked"]);
  });

  it("hands out a fallback link only when it is https", async () => {
    const u = await mkWho();
    const ctx = (await import("../lib/http/ctx")).serviceCtxFor(u.id);
    const j = await mkJob(client);
    await swipe(u, j.jobId);
    const id = await blockAs(u.id, j.jobId, "captcha");
    expect((await S.getApplication(ctx, { id })).application.fallback?.url).toMatch(/^https:\/\//);
    await client.query("ALTER TABLE applications DISABLE TRIGGER USER");
    await client.query("UPDATE applications SET apply_url = 'javascript:alert(1)' WHERE id = $1", [id]).finally(() => client.query("ALTER TABLE applications ENABLE TRIGGER USER"));
    expect((await S.getApplication(ctx, { id })).application.fallback).toBeNull();
  });
});

describe("no network, no LLM", () => {
  it("none of these calls touched fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const u = await mkWho();
    await swipe(u, (await mkJob(client)).jobId);
    await call(R.list.GET, "GET", "/api/v1/apply/applications", as(u));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("swipe rate limit (decision 2026-10-31): a bucket of its own per student", () => {
  it("allows 20 swipes a minute, then 429 with Retry-After; another student is not affected; other writes are not counted in it", async () => {
    const a = await mkWho();
    const b = await mkWho();
    const jobs = await Promise.all(Array.from({ length: 21 }, () => mkJob(client)));
    const codes: number[] = [];
    for (const j of jobs) codes.push((await swipe(a, j.jobId)).status);
    expect(codes.slice(0, 20).every((c) => c === 201)).toBe(true);
    expect(codes[20]).toBe(429);
    const limited = await swipe(a, (await mkJob(client)).jobId);
    expect(limited.json.code).toBe("rate_limited");
    expect(Number(limited.res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(limited.res.headers.get("ratelimit-limit")).toBe("20");
    // the refused swipe created nothing
    expect((await client.query("SELECT count(*)::int AS n FROM applications WHERE user_id = $1", [a.id])).rows[0].n).toBe(20);
    expect((await swipe(b, (await mkJob(client)).jobId)).status).toBe(201);
    // the bucket is the swipe's own: the general write budget (40 a minute) is untouched by 20 swipes
    const rows = (await client.query("SELECT bucket, count FROM rate_limits WHERE bucket LIKE $1", [`v1:%:${a.id}`])).rows.map((r) => r.bucket as string);
    expect(rows).toContain(`v1:apply-create:${a.id}`);
    expect(rows).not.toContain(`v1:write:${a.id}`);
  });

  it("a new window opens after the minute", async () => {
    const a = await mkWho();
    for (let i = 0; i < 20; i++) await swipe(a, (await mkJob(client)).jobId);
    expect((await swipe(a, (await mkJob(client)).jobId)).status).toBe(429);
    await client.query("UPDATE rate_limits SET window_start = window_start - interval '2 minutes' WHERE bucket = $1", [`v1:apply-create:${a.id}`]);
    expect((await swipe(a, (await mkJob(client)).jobId)).status).toBe(201);
  });
});
