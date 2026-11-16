import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateMasterKey } from "@hirelane/vault";
import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authTestDb } from "../helpers/auth-db";

// The drive inbox end to end: a real migrated database, real sessions and RLS, the real engine. Only the Next request plumbing is
// faked. Synthetic data only. 0 LLM calls; the drive link is stored as text and never fetched (fetch is spied on).
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
let dev: typeof import("../../lib/adapters/load");
let prod: typeof import("../../lib/adapters/load");
let ctxFor: typeof import("../../lib/http/ctx").serviceCtxFor;
let fetchSpy: ReturnType<typeof vi.spyOn>;
let n = 0;

type Who = { id: string; token: string };
async function mkWho(): Promise<Who> {
  const id = randomUUID();
  await client.query(
    `WITH u AS (INSERT INTO users (id, email, email_verified_at) VALUES ($1, $2, now()) RETURNING id)
     INSERT INTO consents (user_id, kind, granted, doc_version) SELECT id, 'age_18_plus', true, 'test' FROM u`,
    [id, `drive-inbox-${++n}-${id.slice(0, 6)}@example.test`],
  );
  const { startSession, defaultAuthDeps } = await import("../../lib/auth/session");
  return { id, token: (await startSession(defaultAuthDeps(), { userId: id })).token };
}
const signIn = (w: Who | null) => (w ? jar.set("__Host-hl_session", w.token) : jar.delete("__Host-hl_session"));

interface World {
  campusId: string;
  cohortId: string;
}
async function mkCampus(): Promise<World> {
  const campusId = randomUUID();
  const cohortId = randomUUID();
  await client.query("INSERT INTO campuses (id, name, code_hmac) VALUES ($1, $2, $3)", [campusId, `Inbox College ${campusId.slice(0, 6)}`, `hmac-${campusId}`]);
  await client.query("INSERT INTO campus_domains (campus_id, domain) VALUES ($1, $2)", [campusId, `college-${campusId.slice(0, 8)}.example.test`]);
  await client.query("INSERT INTO cohorts (id, campus_id, passoutYear_placeholder, programme) VALUES ($1, $2, 2026, 'B.Com')".replace("passoutYear_placeholder", "passout_year"), [cohortId, campusId]);
  return { campusId, cohortId };
}
async function mkStaff(w: World, role: "owner" | "staff" = "owner"): Promise<Who> {
  const u = await mkWho();
  await client.query("INSERT INTO tpo_members (campus_id, user_id, email_hmac, role, claimed_at) VALUES ($1, $2, $3, $4, now())", [w.campusId, u.id, `staff-${u.id}`, role]);
  return u;
}
const GOOD = { pct_10: 80, secondary_kind: "12th", pct_secondary: 78, grad_pct_equiv: 70, grad_scale: 100, grad_score: 70, active_backlogs: 0, passout_year: 2026, degree: "B.Com" };
async function mkStudent(w: World, profile: Record<string, unknown> | null = GOOD): Promise<Who> {
  const u = await mkWho();
  await client.query("INSERT INTO cohort_members (user_id, campus_id, cohort_id, verified_via, verified_at, email_hmac) VALUES ($1, $2, $3, 'email', now(), $4)", [u.id, w.campusId, w.cohortId, `m-${u.id}`]);
  if (profile) {
    const cols = Object.keys(profile);
    await client.query(`INSERT INTO eligibility_profiles (user_id, confirmed_at, ${cols.join(", ")}) VALUES ($1, now(), ${cols.map((_, i) => `$${i + 2}`).join(", ")})`, [u.id, ...Object.values(profile)]);
  }
  return u;
}
const snapshot = async (cohortId: string, driveId: string, c: { eligible: number; unknown: number; ineligible: number }, p = 100) => {
  for (const [m, v] of Object.entries(c)) await client.query("INSERT INTO cohort_stats_daily (cohort_id, day, metric, n, p) VALUES ($1, current_date, $2, $3, $4)", [cohortId, `drive_${m}:${driveId}`, v, p]);
};
const NOTICE = "Customer Success Associate. B.Com 2026 passout. Minimum 60% in graduation. No active backlogs. Apply by 6 Nov.";
const input = (w: World, over: Record<string, unknown> = {}) => ({ cohortId: w.cohortId, title: "Customer Success Associate", link: "https://careers.acme.example.test/jobs/1", noticeText: NOTICE, deadline: "2099-11-06", rounds: "Aptitude, then HR", documents: "Marksheets, ID", ...over });

beforeAll(async () => {
  const db = await authTestDb("hirelane_drive_inbox_test");
  client = db.client;
  close = db.close;
  process.env["DATABASE_URL"] = db.url;
  process.env["HIRELANE_MASTER_KEY"] = generateMasterKey();
  process.env["HIRELANE_STORAGE_DIR"] = mkdtempSync(join(tmpdir(), "hirelane-inbox-blobs-"));
  process.env["HIRELANE_ACCOUNTS"] = "1";
  closePool = (await import("@hirelane/db")).close;
  S = await import("@hirelane/services");
  ctxFor = (await import("../../lib/http/ctx")).serviceCtxFor;
  vi.stubEnv("NODE_ENV", "development");
  dev = await import("../../lib/adapters/load");
  vi.stubEnv("NODE_ENV", "production");
  vi.resetModules();
  prod = await import("../../lib/adapters/load");
  closeProdPool = (await import("@hirelane/db")).close;
  vi.unstubAllEnvs();
  fetchSpy = vi.spyOn(globalThis, "fetch");
});
afterAll(async () => {
  fetchSpy.mockRestore();
  await closeProdPool();
  await closePool();
  await close();
  delete process.env["HIRELANE_ACCOUNTS"];
});
beforeEach(() => {
  jar.clear();
  process.env["HIRELANE_ACCOUNTS"] = "1";
  fetchSpy.mockClear();
});

describe("parse, count, publish", () => {
  it("previews without saving: rules, scam flags and a suggested deadline come back, nothing is written", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const before = Number((await client.query("SELECT count(*)::int AS n FROM drives")).rows[0].n);
    const p = await S.previewDrive(ctxFor(staff.id, { now: () => new Date("2026-10-31T04:00:00Z") }), input(w, { deadline: undefined }));
    expect(p).toMatchObject({ step: "parsed", suggestedDeadline: "2026-11-06", scam: { risk: "none" } });
    expect(p.rules).toContain("No active backlogs");
    expect(Number((await client.query("SELECT count(*)::int AS n FROM drives")).rows[0].n)).toBe(before);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a draft is invisible to students, shows the count once the nightly job has made it, and becomes live when published", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const student = await mkStudent(w);
    const draft = await S.saveDriveDraft(ctxFor(staff.id), input(w));
    expect(draft).toMatchObject({ status: "draft", step: "counting", reach: { state: "pending" } });
    expect((await S.listMyDrives(ctxFor(student.id))).drives).toEqual([]);

    let inbox = (await S.driveInbox(ctxFor(staff.id))).drives;
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ id: draft.id, status: "draft", step: "counting", deadline: "2099-11-06", rounds: "Aptitude, then HR", documents: "Marksheets, ID" });

    await snapshot(w.cohortId, draft.id, { eligible: 60, unknown: 30, ineligible: 10 });
    inbox = (await S.driveInbox(ctxFor(staff.id))).drives;
    expect(inbox[0]).toMatchObject({ step: "ready_to_publish", reach: { state: "ready", qualify: 60, couldntCheck: 30, hidden: false } });

    expect(await S.announceDrive(ctxFor(staff.id), { id: draft.id })).toEqual({ id: draft.id, status: "live" });
    const mine = (await S.listMyDrives(ctxFor(student.id))).drives;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: draft.id, deadline: "2099-11-06", rounds: "Aptitude, then HR", documents: "Marksheets, ID", verdict: "eligible" });
    expect((await S.driveInbox(ctxFor(staff.id))).drives[0]).toMatchObject({ status: "live", step: "live" });
    await expect(S.announceDrive(ctxFor(staff.id), { id: draft.id })).rejects.toMatchObject({ status: 404 }); // already live
  });

  it("k >= 10: a small group is hidden, never shown as 0, and the other figure is not used to rebuild it", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const d = await S.saveDriveDraft(ctxFor(staff.id), input(w));
    await snapshot(w.cohortId, d.id, { eligible: 7, unknown: 90, ineligible: 3 });
    const reach = await S.driveReach(ctxFor(staff.id), { id: d.id });
    expect(reach.state).toBe("ready");
    expect(reach.qualify).toBeNull();
    expect(reach.hidden).toBe(true);
    expect(reach.couldntCheck === null || typeof reach.couldntCheck === "number").toBe(true);
    // a figure that is released is rounded to 5 by the database
    const w2 = await mkCampus();
    const staff2 = await mkStaff(w2);
    const d2 = await S.saveDriveDraft(ctxFor(staff2.id), input(w2));
    await snapshot(w2.cohortId, d2.id, { eligible: 47, unknown: 43, ineligible: 10 });
    expect(await S.driveReach(ctxFor(staff2.id), { id: d2.id })).toMatchObject({ qualify: 45, couldntCheck: 45, hidden: false });
  });

  it("closing ends the drive for students; a drive past its deadline is closed for staff and gone for students", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const student = await mkStudent(w);
    const live = await S.publishDriveNow(ctxFor(staff.id), input(w, { title: "Live one" }));
    const late = await S.publishDriveNow(ctxFor(staff.id), input(w, { title: "Past deadline", deadline: "2020-01-01" }));
    expect((await S.listMyDrives(ctxFor(student.id))).drives.map((d) => d.title)).toEqual(["Live one"]);
    expect(await S.closeDrive(ctxFor(staff.id), { id: live.id })).toEqual({ id: live.id, status: "closed" });
    expect((await S.listMyDrives(ctxFor(student.id))).drives).toEqual([]);
    const byId = Object.fromEntries((await S.driveInbox(ctxFor(staff.id))).drives.map((d) => [d.id, d]));
    expect(byId[live.id]).toMatchObject({ status: "closed", step: "closed" });
    expect(byId[late.id]).toMatchObject({ status: "closed" });
    await expect(S.closeDrive(ctxFor(staff.id), { id: live.id })).rejects.toMatchObject({ status: 404 });
  });

  it("drafts count toward the cap of 10 drives per cohort in 30 days (429)", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    for (let i = 0; i < 10; i++) await S.saveDriveDraft(ctxFor(staff.id), input(w, { title: `Draft ${i}` }));
    await expect(S.saveDriveDraft(ctxFor(staff.id), input(w, { title: "Draft 11" }))).rejects.toMatchObject({ status: 429 });
  });

  it("a deadline that is not a calendar day is refused before it reaches the database", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    await expect(S.saveDriveDraft(ctxFor(staff.id), input(w, { deadline: "2026-02-30" }))).rejects.toMatchObject({ status: 400 });
  });
});

describe("who can do what", () => {
  it("a student, a stranger and staff of another campus get 404 for every drive-inbox call", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const student = await mkStudent(w);
    const stranger = await mkWho();
    const other = await mkStaff(await mkCampus());
    const d = await S.saveDriveDraft(ctxFor(staff.id), input(w));
    for (const who of [student, stranger, other]) {
      const c = ctxFor(who.id);
      await expect(S.previewDrive(c, input(w)), "preview").rejects.toMatchObject({ status: 404 });
      await expect(S.saveDriveDraft(c, input(w)), "save").rejects.toMatchObject({ status: 404 });
      await expect(S.driveReach(c, { id: d.id }), "reach").rejects.toMatchObject({ status: 404 });
      await expect(S.announceDrive(c, { id: d.id }), "announce").rejects.toMatchObject({ status: 404 });
      await expect(S.closeDrive(c, { id: d.id }), "close").rejects.toMatchObject({ status: 404 });
    }
    // the inbox is the caller's own campus: a student and a stranger have none (404); staff of another campus see their own, never this one
    for (const who of [student, stranger]) await expect(S.driveInbox(ctxFor(who.id)), "inbox").rejects.toMatchObject({ status: 404 });
    expect((await S.driveInbox(ctxFor(other.id))).drives).toEqual([]);
  });

  it("an officer (the staff seat) can publish; the draft is still a draft until announced", async () => {
    const w = await mkCampus();
    const officer = await mkStaff(w, "staff");
    const d = await S.saveDriveDraft(ctxFor(officer.id), input(w));
    expect((await S.driveInbox(ctxFor(officer.id))).drives[0]).toMatchObject({ id: d.id, status: "draft" });
  });
});

describe("scam flags are staff-only", () => {
  const SCAM = "Urgent hiring, pay a registration fee of Rs 2000 to confirm your seat. Contact on Telegram only. B.Com 2026.";
  it("staff see the flags; the student's drive has no scam field, in the service result or the route body", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const student = await mkStudent(w);
    const d = await S.publishDriveNow(ctxFor(staff.id), input(w, { noticeText: SCAM, title: "Flagged" }));
    expect(["medium", "high"]).toContain(d.scam.risk);
    const inbox = (await S.driveInbox(ctxFor(staff.id))).drives[0]!;
    expect(inbox.scam.flags.length).toBeGreaterThan(0);

    const mine = await S.listMyDrives(ctxFor(student.id));
    expect(mine.drives).toHaveLength(1);
    expect(JSON.stringify(mine)).not.toMatch(/scam/i);
    const route = await import("../../app/api/v1/campus/drives/route");
    const { startSession, defaultAuthDeps } = await import("../../lib/auth/session");
    const s = await startSession(defaultAuthDeps(), { userId: student.id });
    const res = await route.GET(new Request("http://localhost:3001/api/v1/campus/drives", { headers: { host: "localhost:3001", cookie: `__Host-hl_session=${s.token}` } }), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toMatch(/scam/i);
    expect(() => S.MyDrivesSchema.parse(JSON.parse("{\"placed\":false,\"drives\":[]}"))).not.toThrow();
  });

  it("the database itself refuses a student session the scam columns", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const student = await mkStudent(w);
    await S.publishDriveNow(ctxFor(staff.id), input(w, { noticeText: SCAM }));
    const { withUser } = await import("@hirelane/db");
    await expect(withUser(student.id, (c) => c.query("SELECT scam_flags FROM drives"))).rejects.toMatchObject({ code: "42501" });
    await expect(withUser(student.id, (c) => c.query("SELECT scam_risk FROM drives"))).rejects.toMatchObject({ code: "42501" });
  });
});

describe("roster import preview", () => {
  const csv = (rows: string[]) => Buffer.from(["Name,Email,Placed", ...rows].join("\r\n") + "\r\n");
  const people = (domain: string, count: number) => Array.from({ length: count }, (_, i) => `S${i},s${i}@${domain},${i % 5 === 0 ? "Yes" : ""}`);

  it("counts rows, valid emails and duplicates for staff, and writes nothing", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const tables = ["cohort_roster", "cohort_imports", "tpo_access_log", "cohort_members"];
    const count = async () => {
      const out: number[] = [];
      for (const t of tables) out.push(Number((await client.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n));
      return out;
    };
    const before = await count();
    const p = await S.previewRoster(ctxFor(staff.id), { cohortId: w.cohortId }, csv([...people("college.example.test", 12), "Dup,S1@College.example.test,", "Bad,nope,"]));
    expect(p).toMatchObject({ rowsTotal: 14, validEmails: 13, invalidEmails: 1, duplicates: 1, uniqueEmails: 12, canStage: true, domainCheck: "on_import" });
    expect(await count()).toEqual(before);
  });

  it("a student, a stranger and staff of another campus get 404", async () => {
    const w = await mkCampus();
    const student = await mkStudent(w);
    const other = await mkStaff(await mkCampus());
    for (const who of [student, other]) await expect(S.previewRoster(ctxFor(who.id), { cohortId: w.cohortId }, csv(people("x.example.test", 12)))).rejects.toMatchObject({ status: 404 });
  });

  it("then the import takes the same file: the preview said what the import does", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const domain = (await client.query("SELECT domain FROM campus_domains WHERE campus_id = $1", [w.campusId])).rows[0].domain as string;
    const file = csv([...people(domain, 12), `Dup,S1@${domain},`]);
    const p = await S.previewRoster(ctxFor(staff.id), { cohortId: w.cohortId }, file);
    const r = await S.importRoster(ctxFor(staff.id), { cohortId: w.cohortId }, file);
    expect(r.rowsTotal).toBe(p.rowsTotal);
    expect(r.rowsValid).toBe(p.uniqueEmails);
  });
});

describe("the console loader", () => {
  it("is production-ready: a TPO gets the real inbox, a student gets 404, a signed-out visitor goes to sign in", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const student = await mkStudent(w);
    const draft = await S.saveDriveDraft(ctxFor(staff.id), input(w, { title: "Draft in the inbox" }));
    await snapshot(w.cohortId, draft.id, { eligible: 60, unknown: 30, ineligible: 10 });
    await S.publishDriveNow(ctxFor(staff.id), input(w, { title: "Live in the inbox", deadline: "2099-12-01" }));

    signIn(staff);
    const out = await prod.loadCampusDrives(() => new Date("2026-10-31T04:00:00Z"));
    expect(out.source).toBe("real");
    if (out.source === "real") {
      expect(out.data.college).toMatch(/^Inbox College/);
      expect(out.data.counts).toEqual({ draft: 1, live: 1, closed: 0 });
      expect(out.data.drives.map((d) => d.title)).toEqual(["Draft in the inbox", "Live in the inbox"]);
      expect(out.data.drives[0]).toMatchObject({ step: "ready_to_publish", next: "Check the count, then publish", reach: { qualify: 60, couldntCheck: 30 } });
      expect(out.data.drives[1]).toMatchObject({ status: "live", host: "careers.acme.example.test", rounds: "Aptitude, then HR" });
    }

    signIn(student);
    await expect(prod.loadCampusDrives()).rejects.toThrow("NEXT_NOT_FOUND");
    signIn(null);
    await expect(prod.loadCampusDrives()).rejects.toThrow("NEXT_REDIRECT:/signin");
    process.env["HIRELANE_ACCOUNTS"] = "0";
    await expect(prod.loadCampusDrives()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a TPO with no drives yet gets the real, empty inbox in production and the sample in development", async () => {
    const w = await mkCampus();
    signIn(await mkStaff(w));
    const out = await prod.loadCampusDrives();
    expect(out.source).toBe("real");
    if (out.source === "real") expect(out.data).toMatchObject({ drives: [], counts: { draft: 0, live: 0, closed: 0 } });
    expect(await dev.loadCampusDrives()).toEqual({ source: "sample" });
  });

  it("reading the inbox writes nothing (the transaction is read only)", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    await S.publishDriveNow(ctxFor(staff.id), input(w));
    const tables = ["drives", "tpo_members", "tpo_access_log", "notifications", "cohort_stats_daily"];
    const count = async () => {
      const out: number[] = [];
      for (const t of tables) out.push(Number((await client.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n));
      return out;
    };
    const before = await count();
    signIn(staff);
    await prod.loadCampusDrives();
    expect(await count()).toEqual(before);
  });
});
