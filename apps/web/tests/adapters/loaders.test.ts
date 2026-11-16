import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateMasterKey } from "@hirelane/vault";
import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authTestDb } from "../helpers/auth-db";

// The loaders end to end: a real migrated database, real sessions, real services, real RLS. Only the Next request
// plumbing is faked. Synthetic data only; 0 LLM calls; no network.
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
let n = 0;

type Who = { id: string; token: string };
async function mkWho(name: string | null): Promise<Who> {
  const id = randomUUID();
  await client.query(
    `WITH u AS (INSERT INTO users (id, email, display_name, email_verified_at) VALUES ($1, $2, $3, now()) RETURNING id)
     INSERT INTO consents (user_id, kind, granted, doc_version) SELECT id, 'age_18_plus', true, 'test' FROM u`,
    [id, `loader-fixture-${++n}-${id.slice(0, 6)}@example.test`, name],
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
  await client.query("INSERT INTO campuses (id, name, code_hmac) VALUES ($1, $2, $3)", [campusId, `Fixture College ${campusId.slice(0, 6)}`, `hmac-${campusId}`]);
  await client.query("INSERT INTO cohorts (id, campus_id, passout_year, programme) VALUES ($1, $2, 2026, 'B.Com')", [cohortId, campusId]);
  return { campusId, cohortId };
}
async function mkStaff(w: World): Promise<Who> {
  const u = await mkWho("Tara Officer");
  await client.query("INSERT INTO tpo_members (campus_id, user_id, email_hmac, role, claimed_at) VALUES ($1, $2, $3, 'owner', now())", [w.campusId, u.id, `staff-${u.id}`]);
  return u;
}
async function mkStudent(w: World, name: string | null, share = "aggregate"): Promise<Who> {
  const u = await mkWho(name);
  await client.query("INSERT INTO cohort_members (user_id, campus_id, cohort_id, verified_via, verified_at, email_hmac, share_level) VALUES ($1, $2, $3, 'email', now(), $4, $5)", [u.id, w.campusId, w.cohortId, `m-${u.id}`, share]);
  await client.query(
    "INSERT INTO eligibility_profiles (user_id, confirmed_at, pct_10, secondary_kind, pct_secondary, grad_pct_equiv, grad_scale, grad_score, active_backlogs, passout_year, degree) VALUES ($1, now(), 80, '12th', 78, 70, 100, 70, 0, 2026, 'B.Com')",
    [u.id],
  );
  return u;
}

beforeAll(async () => {
  const db = await authTestDb("hirelane_adapters_loaders_test");
  client = db.client;
  close = db.close;
  process.env["DATABASE_URL"] = db.url;
  process.env["HIRELANE_MASTER_KEY"] = generateMasterKey();
  process.env["HIRELANE_STORAGE_DIR"] = mkdtempSync(join(tmpdir(), "hirelane-loaders-blobs-"));
  process.env["HIRELANE_ACCOUNTS"] = "1";
  closePool = (await import("@hirelane/db")).close;
  S = await import("@hirelane/services");
  ctxFor = (await import("../../lib/http/ctx")).serviceCtxFor;
  // Samples are for NODE_ENV=development only (a host with NODE_ENV unset or "test" must not show them).
  vi.stubEnv("NODE_ENV", "development");
  dev = await import("../../lib/adapters/load");
  vi.stubEnv("NODE_ENV", "production");
  vi.resetModules();
  prod = await import("../../lib/adapters/load");
  closeProdPool = (await import("@hirelane/db")).close; // the reset gave production its own module graph and pool
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

describe("student screens", () => {
  it("signed out: dev shows the sample, production sends to /signin", async () => {
    expect(await dev.loadHome()).toEqual({ source: "sample" });
    await expect(prod.loadHome()).rejects.toThrow("NEXT_REDIRECT:/signin");
    await expect(prod.loadDrives()).rejects.toThrow("NEXT_REDIRECT:/signin");
  });

  it("accounts flag off: dev shows the sample, production is a 404", async () => {
    process.env["HIRELANE_ACCOUNTS"] = "0";
    expect(await dev.loadTracker()).toEqual({ source: "sample" });
    await expect(prod.loadTracker()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a signed-in student with nothing yet: dev shows the sample, production shows real zeros", async () => {
    signIn(await mkWho("Asha Verma"));
    expect(await dev.loadHome()).toEqual({ source: "sample" });
    expect(await dev.loadDrives()).toEqual({ source: "sample" });
    const home = await prod.loadHome();
    expect(home.source).toBe("real");
    if (home.source === "real") expect(home.data.home).toMatchObject({ sample: false, firstName: "Asha", college: null, resume: null, drives: [], week: { handedOff: 0, replies: 0 } });
    const tr = await prod.loadTracker();
    expect(tr).toEqual({ source: "real", data: { initial: "A", items: [] } });
  });

  it("a student in a campus sees the published drive, judged against their own confirmed marks", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const student = await mkStudent(w, "Asha Verma");
    const pub = await S.publishDrive(ctxFor(staff.id), { cohortId: w.cohortId, title: "Process Associate", noticeText: "Eligibility: 55% throughout, no active backlogs. Apply by 31 Dec 2099." });
    signIn(student);
    for (const load of [dev, prod]) {
      const d = await load.loadDrives();
      expect(d.source).toBe("real");
      if (d.source !== "real") continue;
      expect(d.data.initial).toBe("A");
      expect(d.data.drives).toHaveLength(1);
      expect(d.data.drives[0]).toMatchObject({ id: pub.id, role: "Process Associate", status: "eligible", ctc: null });
      expect(d.data.drives[0]!.daysLeft).toBeGreaterThan(1000);
    }
    const home = await prod.loadHome();
    if (home.source !== "real") throw new Error("expected real");
    expect(home.data.home.college).toBe((await client.query("SELECT name FROM campuses WHERE id = $1", [w.campusId])).rows[0].name);
    expect(home.data.home.drives.map((x) => x.id)).toEqual([pub.id]);
  });
});

describe("console screens", () => {
  it("a TPO sees their cohort's totals, withheld cells are not invented, and a student gets the sample in dev", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const put = (metric: string, nn: number, p: number) => client.query("INSERT INTO cohort_stats_daily (cohort_id, day, metric, n, p) VALUES ($1, '2026-10-29', $2, $3, $4)", [w.cohortId, metric, nn, p]);
    await put("joined_verified", 43, 43);
    await put("stage_confirmed", 25, 43);
    await put("stage_no_resume", 4, 43);
    signIn(staff);

    const inProd = await prod.loadCampusStudents(); // production-ready: the screen prints no figure it does not have
    expect(inProd.source).toBe("real");
    const st = await dev.loadCampusStudents();
    expect(st.source).toBe("real");
    if (st.source === "real") {
      expect(st.data.college).toMatch(/^Fixture College/);
      expect(st.data.rows).toEqual([{ programme: "B.Com (2026)", finalYears: 0, joined: 45, ready: 0, // 25 is withheld by the database (complementary suppression with the hidden 4), so it shows as 0 = "under 10"
         eligible: 0, applied: 0, interviews: 0, offers: 0 }]);
    }

    const student = await mkStudent(w, "Asha Verma");
    signIn(student);
    expect(await dev.loadCampusStudents()).toEqual({ source: "sample" });
  });

  it("the overview, students and outcomes are real in production for staff, and a 404 for a student or a stranger", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    signIn(staff);
    for (const load of [prod.loadCampusOverview, prod.loadCampusOutcomes, prod.loadCampusStudents, prod.loadCampusDrives, prod.loadCampusSettings]) expect((await load()).source).toBe("real");
    signIn(await mkStudent(w, "Asha Verma"));
    for (const load of [prod.loadCampusOverview, prod.loadCampusOutcomes, prod.loadCampusStudents, prod.loadCampusDrives, prod.loadCampusSettings]) await expect(load()).rejects.toThrow("NEXT_NOT_FOUND");
    signIn(await mkWho("Stranger"));
    await expect(prod.loadCampusOutcomes()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("no console screen names a student or writes to the access log on a page view; naming is the explicit reveal call", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const student = await mkStudent(w, "Asha Verma", "full");
    await S.reportOutcome(ctxFor(student.id), { kind: "offer", employer: "Retail chain", packageLpa: 3.2 });
    const logged = async () => Number((await client.query("SELECT count(*)::int AS n FROM tpo_access_log WHERE subject_user_id = $1", [student.id])).rows[0].n);
    const before = await logged();
    signIn(staff);
    await dev.loadCampusOverview();
    await dev.loadCampusStudents();
    expect(await logged()).toBe(before);
    const out = await dev.loadCampusOutcomes();
    expect(out.source).toBe("real");
    if (out.source === "real") {
      expect(out.data.offers).toMatchObject([{ employer: "Retail chain", lpa: 3.2, status: "waiting", source: "Hirelane" }]);
      expect(JSON.stringify(out.data)).not.toContain("Asha");
    }
    await dev.loadCampusOutcomes(); // a refresh adds nothing
    expect(await logged()).toBe(before);
    await S.revealOutcomes(ctxFor(staff.id), {}); // the explicit action is what logs
    expect(await logged()).toBe(before + 1);
  });
});
