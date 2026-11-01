import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
  me: await import("../app/api/v1/campus/me/route"),
  join: await import("../app/api/v1/campus/join/route"),
  joinEmail: await import("../app/api/v1/campus/join/email/route"),
  joinVerify: await import("../app/api/v1/campus/join/email/verify/route"),
  share: await import("../app/api/v1/campus/share/route"),
  log: await import("../app/api/v1/campus/access-log/route"),
  myDrives: await import("../app/api/v1/campus/drives/route"),
  myOutcomes: await import("../app/api/v1/campus/outcomes/route"),
  letter: await import("../app/api/v1/campus/outcomes/[id]/letter/route"),
  tpoMe: await import("../app/api/v1/tpo/me/route"),
  claim: await import("../app/api/v1/tpo/claim/route"),
  reveal: await import("../app/api/v1/tpo/outcomes/reveal/route"),
  cohorts: await import("../app/api/v1/tpo/cohorts/route"),
  stats: await import("../app/api/v1/tpo/cohorts/[id]/stats/route"),
  roster: await import("../app/api/v1/tpo/cohorts/[id]/roster/route"),
  drives: await import("../app/api/v1/tpo/drives/route"),
  drive: await import("../app/api/v1/tpo/drives/[id]/route"),
  outcomes: await import("../app/api/v1/tpo/outcomes/route"),
  verify: await import("../app/api/v1/tpo/outcomes/[id]/verify/route"),
  tpoLetter: await import("../app/api/v1/tpo/outcomes/[id]/letter/route"),
  naac: await import("../app/api/v1/tpo/export/naac/route"),
  staff: await import("../app/api/v1/tpo/staff/route"),
  staffMember: await import("../app/api/v1/tpo/staff/[id]/route"),
  transfer: await import("../app/api/v1/tpo/staff/[id]/transfer-ownership/route"),
  openapi: await import("../app/api/v1/openapi.json/route"),
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
const lastMailCode = (to: string): string => {
  const files = readdirSync(outbox).sort();
  for (const f of files.reverse()) {
    const text = readFileSync(join(outbox, f), "utf8");
    if (text.includes(`To: ${to}`)) return /^ {4}(\d{6})\s*$/m.exec(text)![1]!;
  }
  throw new Error("no mail for " + to);
};

const PASSING = { pct_10: 80, secondary_kind: "12th", pct_secondary: 78, grad_pct_equiv: 70, grad_scale: 100, grad_score: 70, active_backlogs: 0, passout_year: 2026, degree: "B.Tech" };
const FAILING = { ...PASSING, pct_secondary: 50, active_backlogs: 2 };
const NOTICE = "Eligibility: B.Tech 2026 batch with minimum 60% throughout and no active backlogs.";

beforeAll(async () => {
  const db = await authTestDb("hirelane_campus_api_test");
  client = db.client;
  close = db.close;
  outbox = mkdtempSync(join(tmpdir(), "hirelane-campus-outbox-"));
  process.env["DATABASE_URL"] = db.url;
  process.env["HIRELANE_MASTER_KEY"] = generateMasterKey();
  process.env["HIRELANE_STORAGE_DIR"] = mkdtempSync(join(tmpdir(), "hirelane-campus-blobs-"));
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

describe("campus routes: wrapper rules", () => {
  it("flag off is 404, no session is 401, a cross-origin mutation is 403, a missing Idempotency-Key is 400", async () => {
    process.env["HIRELANE_ACCOUNTS"] = "0";
    expect((await call(R.me.GET, "GET", "/api/v1/campus/me")).status).toBe(404);
    process.env["HIRELANE_ACCOUNTS"] = "1";
    expect((await call(R.me.GET, "GET", "/api/v1/campus/me", { who: null })).status).toBe(401);
    expect((await call(R.tpoMe.GET, "GET", "/api/v1/tpo/me", { who: null })).status).toBe(401);
    expect((await call(R.share.PUT, "PUT", "/api/v1/campus/share", { body: { level: "full" }, origin: "https://evil.example.test" })).status).toBe(403);
    const noKey = await call(R.share.PUT, "PUT", "/api/v1/campus/share", { body: { level: "full" }, idem: null });
    expect([noKey.status, noKey.json.code]).toEqual([400, "idempotency_key_required"]);
  });

  it("every campus and TPO operation is in the v1 OpenAPI document, and the document names the security scheme", async () => {
    const doc = (await call(R.openapi.GET, "GET", "/api/v1/openapi.json", { who: null })).json;
    for (const p of ["/api/v1/campus/join", "/api/v1/campus/join/email/verify", "/api/v1/tpo/cohorts/{id}/stats", "/api/v1/tpo/export/naac", "/api/v1/tpo/claim", "/api/v1/tpo/outcomes/reveal", "/api/v1/tpo/staff", "/api/v1/tpo/staff/{id}", "/api/v1/tpo/staff/{id}/transfer-ownership"]) expect(doc.paths[p], p).toBeDefined();
    expect(doc.paths["/api/v1/tpo/cohorts/{id}/roster"].post.requestBody.content["text/csv"]).toBeDefined();
    // Decision 2026-10-31: the CSV is an explicit action (POST); the GET is a preview with no student named.
    expect(doc.paths["/api/v1/tpo/export/naac"].post.responses["200"].content["text/csv"]).toBeDefined();
    expect(doc.paths["/api/v1/tpo/export/naac"].get.responses["200"].content["application/json"]).toBeDefined();
    expect(doc.paths["/api/v1/tpo/outcomes/{id}/letter"].get).toBeUndefined();
    expect(doc.paths["/api/v1/tpo/outcomes/{id}/letter"].post).toBeDefined();
  });
});

describe("join by code", () => {
  it("lists the cohorts for a good code, then joins as an unverified member", async () => {
    const w = await mkCampus();
    const u = await mkWho();
    const look = await call(R.join.POST, "POST", "/api/v1/campus/join", as(u, { body: { code: w.code } }));
    expect(look.status).toBe(200);
    expect(S.JoinResultSchema.parse(look.json)).toMatchObject({ status: "choose_cohort", cohorts: [{ id: w.cohortId, programme: "B.Tech CSE" }] });
    const joined = await call(R.join.POST, "POST", "/api/v1/campus/join", as(u, { body: { code: w.code.toLowerCase().replace(/^(.{4})/, "$1-"), cohortId: w.cohortId } }));
    expect(joined.json).toEqual({ status: "joined", verifiedVia: "code" });
    const me = await call(R.me.GET, "GET", "/api/v1/campus/me", as(u));
    const parsed = S.MyCampusSchema.parse(me.json);
    expect(parsed.membership).toMatchObject({ shareLevel: "aggregate", verified: false, verifiedVia: "code", placed: false, cohort: { programme: "B.Tech CSE" } });
    expect(JSON.stringify(me.json)).not.toContain("code_hmac");
    const again = await call(R.join.POST, "POST", "/api/v1/campus/join", as(u, { body: { code: w.code, cohortId: w.cohortId } }));
    expect([again.status, again.json.code]).toEqual([409, "already_member"]);
  });

  it("a wrong, malformed or other-campus code is one answer, and the attempts are rate limited", async () => {
    const w = await mkCampus();
    const other = await mkCampus();
    const u = await mkWho();
    for (const code of ["ZZZZZZZZ", "abc", "not a code at all!!"]) {
      const r = await call(R.join.POST, "POST", "/api/v1/campus/join", as(u, { body: { code } }));
      expect([r.status, r.json.code], code).toEqual([400, "invalid_code"]);
    }
    const mismatch = await call(R.join.POST, "POST", "/api/v1/campus/join", as(u, { body: { code: w.code, cohortId: other.cohortId } }));
    expect([mismatch.status, mismatch.json.code]).toEqual([400, "invalid_cohort"]);
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await call(R.join.POST, "POST", "/api/v1/campus/join", as(u, { body: { code: "ZZZZZZZY" } }))).status;
    expect(last).toBe(429);
    const blocked = await call(R.join.POST, "POST", "/api/v1/campus/join", as(u, { body: { code: w.code, cohortId: w.cohortId } }));
    expect(blocked.status).toBe(429);
    expect((await client.query("SELECT 1 FROM cohort_members WHERE user_id = $1", [u.id])).rowCount).toBe(0);
  });

  it("a code join never counts toward a TPO's numbers, however many join", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    for (let i = 0; i < 15; i++) await mkStudent(w, { via: "code" });
    for (let i = 0; i < 4; i++) await mkStudent(w, { via: "email" });
    await client.query("INSERT INTO cohort_stats_daily (cohort_id, day, metric, n, p) SELECT cohort_id, current_date, 'joined_verified', count(*) FILTER (WHERE verified_at IS NOT NULL), count(*) FILTER (WHERE verified_at IS NOT NULL) FROM cohort_members WHERE cohort_id = $1 GROUP BY cohort_id", [w.cohortId]);
    const r = await call(R.stats.GET, "GET", `/api/v1/tpo/cohorts/${w.cohortId}/stats`, as(staff), { id: w.cohortId });
    expect(S.CohortStatsSchema.parse(r.json).metrics.find((m) => m.metric === "joined_verified")).toMatchObject({ suppressed: true, value: null });
  });
});

describe("join by college email (OTP purpose campus_email)", () => {
  it("mails a code, verifies it once, and takes a verified seat; roster placed flag carries over", async () => {
    const w = await mkCampus();
    const u = await mkWho();
    const college = `Asha.Rao@${w.domain.toUpperCase()}`;
    await client.query("INSERT INTO cohort_roster (campus_id, cohort_id, email_hmac, placed) VALUES ($1, $2, $3, true)", [w.campusId, w.cohortId, await S.mailboxHmac(keys, `asha.rao@${w.domain}`)]);
    const sent = await call(R.joinEmail.POST, "POST", "/api/v1/campus/join/email", as(u, { body: { email: college } }));
    expect([sent.status, sent.json]).toEqual([200, { sent: true }]);
    const code = lastMailCode(`asha.rao@${w.domain}`);
    const bad = await call(R.joinVerify.POST, "POST", "/api/v1/campus/join/email/verify", as(u, { body: { email: college, code: code === "000000" ? "111111" : "000000", cohortId: w.cohortId } }));
    expect([bad.status, bad.json.code]).toEqual([400, "invalid_code"]);
    const ok = await call(R.joinVerify.POST, "POST", "/api/v1/campus/join/email/verify", as(u, { body: { email: ` ${college} `, code, cohortId: w.cohortId } }));
    expect([ok.status, ok.json]).toEqual([200, { status: "joined", verifiedVia: "email" }]);
    const m = S.MyCampusSchema.parse((await call(R.me.GET, "GET", "/api/v1/campus/me", as(u))).json).membership!;
    expect(m).toMatchObject({ verified: true, verifiedVia: "email", placed: true });
    // The same code does not work twice, and the mailbox is held.
    const second = await mkWho();
    await client.query("UPDATE otp_challenges SET created_at = created_at - interval '2 minutes'"); // past the per-mailbox cooldown
    await call(R.joinEmail.POST, "POST", "/api/v1/campus/join/email", as(second, { body: { email: college } }));
    const taken = await call(R.joinVerify.POST, "POST", "/api/v1/campus/join/email/verify", as(second, { body: { email: college, code: lastMailCode(`asha.rao@${w.domain}`), cohortId: w.cohortId } }));
    expect([taken.status, taken.json.code]).toEqual([409, "seat_taken"]);
  });

  it("several accounts cannot mail-bomb or brute-force one college mailbox", async () => {
    const w = await mkCampus();
    const addr = `victim@${w.domain}`;
    const accounts = [await mkWho(), await mkWho(), await mkWho()];
    expect((await call(R.joinEmail.POST, "POST", "/api/v1/campus/join/email", as(accounts[0]!, { body: { email: addr } }))).status).toBe(200);
    const second = await call(R.joinEmail.POST, "POST", "/api/v1/campus/join/email", as(accounts[1]!, { body: { email: addr } }));
    expect([second.status, second.json.code]).toEqual([429, "try_again_shortly"]);
    expect(readdirSync(outbox).filter((f) => readFileSync(join(outbox, f), "utf8").includes(`To: ${addr}`))).toHaveLength(1);
    // Guesses are budgeted per (mailbox, account): ten an hour each, so one account cannot use up another's budget.
    await client.query("UPDATE otp_challenges SET created_at = created_at - interval '2 minutes'");
    await client.query("UPDATE join_attempts SET at = at - interval '2 minutes'");
    expect((await call(R.joinEmail.POST, "POST", "/api/v1/campus/join/email", as(accounts[1]!, { body: { email: addr } }))).status).toBe(200);
    await client.query("UPDATE otp_challenges SET created_at = created_at - interval '2 minutes'");
    expect((await call(R.joinEmail.POST, "POST", "/api/v1/campus/join/email", as(accounts[2]!, { body: { email: addr } }))).status).toBe(200);
    const wrong = lastMailCode(addr) === "123456" ? "654321" : "123456";
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      for (const who of accounts) statuses.push((await call(R.joinVerify.POST, "POST", "/api/v1/campus/join/email/verify", as(who, { body: { email: addr, code: wrong, cohortId: w.cohortId } }))).status);
    }
    expect(statuses.filter((s) => s === 429)).toHaveLength(0); // five tries each, inside each account's own ten
    for (const who of accounts) {
      expect((await client.query("SELECT coalesce(sum(attempts), 0)::int AS n FROM otp_challenges WHERE purpose = 'campus_email' AND created_at > now() - interval '1 hour' AND user_id = $1 AND target_hmac = $2", [who.id, await S.mailboxHmac(keys, addr)])).rows[0].n).toBeLessThanOrEqual(10);
    }
  });

  it("refuses an address on a domain nobody registered, without sending mail", async () => {
    const u = await mkWho();
    const before = readdirSync(outbox).length;
    const r = await call(R.joinEmail.POST, "POST", "/api/v1/campus/join/email", as(u, { body: { email: "someone@gmail.com" } }));
    expect([r.status, r.json.code]).toEqual([422, "not_a_college_email"]);
    expect(readdirSync(outbox).length).toBe(before);
    expect((await call(R.joinEmail.POST, "POST", "/api/v1/campus/join/email", as(u, { body: { email: "not an email" } }))).status).toBe(400);
  });

  it("five wrong tries lock the code, even for the right one", async () => {
    const w = await mkCampus();
    const u = await mkWho();
    const addr = `s1@${w.domain}`;
    await call(R.joinEmail.POST, "POST", "/api/v1/campus/join/email", as(u, { body: { email: addr } }));
    const good = lastMailCode(addr);
    const wrong = good === "123456" ? "654321" : "123456";
    for (let i = 0; i < 5; i++) expect((await call(R.joinVerify.POST, "POST", "/api/v1/campus/join/email/verify", as(u, { body: { email: addr, code: wrong, cohortId: w.cohortId } }))).json.code).toBe("invalid_code");
    const locked = await call(R.joinVerify.POST, "POST", "/api/v1/campus/join/email/verify", as(u, { body: { email: addr, code: good, cohortId: w.cohortId } }));
    expect([locked.status, locked.json.code]).toEqual([400, "invalid_code"]);
  });
});

describe("share levels", () => {
  it("changing the level writes a consent row each time, with the level in doc_version", async () => {
    const w = await mkCampus();
    const u = await mkStudent(w);
    for (const level of ["outcomes", "full", "aggregate"]) {
      const r = await call(R.share.PUT, "PUT", "/api/v1/campus/share", as(u, { body: { level } }));
      expect([r.status, r.json]).toEqual([200, { shareLevel: level }]);
    }
    const rows = (await client.query("SELECT granted, doc_version FROM consents WHERE user_id = $1 AND kind = 'campus_share' ORDER BY at, id", [u.id])).rows;
    expect(rows).toEqual([
      { granted: true, doc_version: "share-v1:outcomes" },
      { granted: true, doc_version: "share-v1:full" },
      { granted: false, doc_version: "share-v1:aggregate" },
    ]);
    expect((await call(R.share.PUT, "PUT", "/api/v1/campus/share", as(u, { body: { level: "everything" } }))).status).toBe(400);
    const nobody = await mkWho();
    expect((await call(R.share.PUT, "PUT", "/api/v1/campus/share", as(nobody, { body: { level: "full" } }))).json.code).toBe("not_in_campus");
  });

  it("leaving a campus removes the seat and records it", async () => {
    const w = await mkCampus();
    const u = await mkStudent(w, { share: "full" });
    expect((await call(R.me.DELETE, "DELETE", "/api/v1/campus/me", as(u))).json).toEqual({ left: true });
    expect(S.MyCampusSchema.parse((await call(R.me.GET, "GET", "/api/v1/campus/me", as(u))).json).membership).toBeNull();
    expect((await client.query("SELECT doc_version FROM consents WHERE user_id = $1 AND kind = 'campus_share'", [u.id])).rows).toEqual([{ doc_version: "share-v1:left" }]);
  });
});

describe("the TPO door: staff only, one answer for everyone else", () => {
  it("a student, a stranger and another campus's staff all get 404 from every TPO read", async () => {
    const w = await mkCampus();
    const other = await mkCampus();
    const student = await mkStudent(w);
    const stranger = await mkWho();
    const otherStaff = await mkStaff(other);
    const drive = await call(R.drives.POST, "POST", "/api/v1/tpo/drives", as(await mkStaff(w), { body: { cohortId: w.cohortId, title: "D", noticeText: NOTICE } }));
    const driveId = drive.json.id as string;
    for (const who of [student, stranger, otherStaff]) {
      const checks = [
        call(R.cohorts.GET, "GET", `/api/v1/tpo/cohorts?campusId=${w.campusId}`, as(who)),
        call(R.stats.GET, "GET", `/api/v1/tpo/cohorts/${w.cohortId}/stats`, as(who), { id: w.cohortId }),
        call(R.drive.GET, "GET", `/api/v1/tpo/drives/${driveId}`, as(who), { id: driveId }),
        call(R.drives.GET, "GET", `/api/v1/tpo/drives?campusId=${w.campusId}`, as(who)),
        call(R.outcomes.GET, "GET", `/api/v1/tpo/outcomes?campusId=${w.campusId}`, as(who)),
        call(R.naac.GET, "GET", `/api/v1/tpo/export/naac?campusId=${w.campusId}`, as(who)),
        call(R.naac.POST, "POST", `/api/v1/tpo/export/naac?campusId=${w.campusId}`, as(who)),
        call(R.reveal.POST, "POST", "/api/v1/tpo/outcomes/reveal", as(who, { body: { campusId: w.campusId } })),
        call(R.staff.GET, "GET", `/api/v1/tpo/staff?campusId=${w.campusId}`, as(who)),
        call(R.cohorts.POST, "POST", "/api/v1/tpo/cohorts", as(who, { body: { campusId: w.campusId, passoutYear: 2027, programme: "MBA" } })),
        call(R.drives.POST, "POST", "/api/v1/tpo/drives", as(who, { body: { cohortId: w.cohortId, title: "x", noticeText: "y" } })),
        call(R.roster.POST, "POST", `/api/v1/tpo/cohorts/${w.cohortId}/roster`, as(who, { raw: "email\na@x.edu\n", type: "text/csv" }), { id: w.cohortId }),
        call(R.staff.POST, "POST", "/api/v1/tpo/staff", as(who, { body: { campusId: w.campusId, email: "x@y.edu" } })),
      ];
      for (const r of await Promise.all(checks)) expect([r.status, r.json.code]).toEqual([404, "not_found"]);
    }
    expect((await call(R.tpoMe.GET, "GET", "/api/v1/tpo/me", as(student))).json).toEqual({ campuses: [], pendingInvite: false });
  });

  it("staff of a campus sees it, and with one membership the campus need not be named", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w, "staff");
    const me = S.TpoMeSchema.parse((await call(R.tpoMe.GET, "GET", "/api/v1/tpo/me", as(staff))).json);
    expect(me.campuses).toEqual([{ campusId: w.campusId, campusName: expect.stringContaining("Test College"), role: "staff" }]);
    const list = S.TpoCohortsSchema.parse((await call(R.cohorts.GET, "GET", "/api/v1/tpo/cohorts", as(staff))).json);
    expect(list.cohorts.map((c) => c.id)).toEqual([w.cohortId]);
    const created = await call(R.cohorts.POST, "POST", "/api/v1/tpo/cohorts", as(staff, { body: { passoutYear: 2027, programme: "MBA" } }));
    expect([created.status, S.CohortCreatedSchema.parse(created.json).created]).toEqual([201, true]);
    const dup = await call(R.cohorts.POST, "POST", "/api/v1/tpo/cohorts", as(staff, { body: { passoutYear: 2027, programme: "mba" } }));
    expect([dup.status, dup.json.created]).toEqual([200, false]);
  });

  it("console sign-in is the ordinary email-code sign-in: a person who signs up that way and was invited is staff", async () => {
    const w = await mkCampus();
    const owner = await mkStaff(w, "owner");
    const addr = `kulkarni-${randomUUID().slice(0, 6)}@example.test`;
    const invite = await call(R.staff.POST, "POST", "/api/v1/tpo/staff", as(owner, { body: { email: addr.toUpperCase() } }));
    expect([invite.status, invite.json]).toEqual([201, { status: "invited" }]);
    expect((await call(R.staff.POST, "POST", "/api/v1/tpo/staff", as(owner, { body: { email: addr } }))).json).toEqual({ status: "exists" });
    const listed = await call(R.staff.GET, "GET", "/api/v1/tpo/staff", as(owner));
    expect(S.StaffListSchema.parse(listed.json).staff.filter((s) => !s.claimed)).toHaveLength(1);
    expect(listed.text).not.toContain(addr);
    expect((await client.query("SELECT 1 FROM tpo_members WHERE email_hmac = $1", [addr])).rowCount).toBe(0); // only a keyed hash is stored

    // The invitee signs in with the existing email-code flow (a new account, 18+ gate and all).
    const { requestEmailCode, verifyEmailCode } = await import("../lib/auth/email-code");
    const { completeSignup } = await import("../lib/auth/pending-signup");
    const sent: { to: string; code: string }[] = [];
    const deps = { db: <T,>(fn: (c: never) => Promise<T>) => fn(client as never), keys, now: () => new Date(), env: { NODE_ENV: "test" } as Record<string, string | undefined>, sendCode: async (to: string, code: string) => void sent.push({ to, code }) };
    await requestEmailCode(deps as never, { email: addr, ip: "10.9.9.9" });
    const v = await verifyEmailCode(deps as never, { email: addr, code: sent.at(-1)!.code, ip: "10.9.9.9" });
    if (v.kind !== "pending") throw new Error(`expected pending, got ${v.kind}`);
    const done = await completeSignup(deps as never, v.cookieValue, { over18: true, terms: true, privacy: true }, {});
    if (!done.ok) throw new Error("signup failed");
    const invitee: Who = { id: done.userId, token: done.session.token, email: addr };

    // Decision 2026-10-31: GETs write nothing. Reading /tpo/me reports the waiting invite; only POST /tpo/claim takes the seat.
    const open = () => client.query("SELECT user_id FROM tpo_members WHERE campus_id = $1 AND email_hmac <> ALL($2::text[]) AND user_id IS NULL", [w.campusId, [`staff-${owner.id}`]]);
    expect((await open()).rowCount).toBe(1);
    const waiting = S.TpoMeSchema.parse((await call(R.tpoMe.GET, "GET", "/api/v1/tpo/me", as(invitee))).json);
    expect(waiting).toEqual({ campuses: [], pendingInvite: true });
    expect((await call(R.cohorts.GET, "GET", "/api/v1/tpo/cohorts", as(invitee))).status).toBe(404); // a read does not claim
    expect((await open()).rowCount).toBe(1);
    const claimed = await call(R.claim.POST, "POST", "/api/v1/tpo/claim", as(invitee));
    expect([claimed.status, claimed.json]).toEqual([200, { claimed: 1 }]);
    expect((await call(R.claim.POST, "POST", "/api/v1/tpo/claim", as(invitee))).json).toEqual({ claimed: 0 }); // idempotent
    expect((await open()).rowCount).toBe(0);
    const me = S.TpoMeSchema.parse((await call(R.tpoMe.GET, "GET", "/api/v1/tpo/me", as(invitee))).json);
    expect(me).toEqual({ campuses: [{ campusId: w.campusId, campusName: expect.any(String), role: "staff" }], pendingInvite: false });
    // A staff (not owner) cannot invite or list staff.
    expect((await call(R.staff.POST, "POST", "/api/v1/tpo/staff", as(invitee, { body: { email: "z@example.test" } }))).status).toBe(404);
    expect((await call(R.staff.GET, "GET", "/api/v1/tpo/staff", as(invitee))).status).toBe(404);
  });

  it("owner removes a staff seat; staff and strangers get 404; the last owner cannot be removed (409)", async () => {
    const w = await mkCampus();
    const other = await mkCampus();
    const owner = await mkStaff(w, "owner");
    const staff = await mkStaff(w, "staff");
    const stranger = await mkWho();
    const seat = async (u: Who) => (await client.query("SELECT id FROM tpo_members WHERE campus_id = $1 AND user_id = $2", [w.campusId, u.id])).rows[0].id as string;
    const staffSeat = await seat(staff);
    const ownerSeat = await seat(owner);
    const del = (who: Who, id: string, q = "") => call(R.staffMember.DELETE, "DELETE", `/api/v1/tpo/staff/${id}${q}`, as(who), { id });
    for (const who of [staff, stranger, await mkStaff(other, "owner")]) {
      const r = await del(who, staffSeat, who === staff ? "" : `?campusId=${w.campusId}`);
      expect([r.status, r.json.code]).toEqual([404, "not_found"]);
    }
    expect((await client.query("SELECT 1 FROM tpo_members WHERE id = $1", [staffSeat])).rowCount).toBe(1);
    expect((await call(R.staffMember.DELETE, "DELETE", `/api/v1/tpo/staff/${staffSeat}`, { who: null }, { id: staffSeat })).status).toBe(401);
    expect((await call(R.staffMember.DELETE, "DELETE", `/api/v1/tpo/staff/${staffSeat}`, as(owner, { origin: "https://evil.example.test" }), { id: staffSeat })).status).toBe(403);
    const last = await del(owner, ownerSeat);
    expect([last.status, last.json.code]).toEqual([409, "last_owner"]);
    const ok = await del(owner, staffSeat);
    expect([ok.status, ok.json]).toEqual([200, { status: "removed" }]);
    expect(S.StaffRemovedSchema.parse(ok.json).status).toBe("removed");
    expect((await client.query("SELECT 1 FROM tpo_members WHERE id = $1", [staffSeat])).rowCount).toBe(0);
    expect((await del(owner, "not-a-uuid")).status).toBe(400);
  });

  it("only the owner transfers ownership, and only to a claimed staff member of the same campus", async () => {
    const w = await mkCampus();
    const owner = await mkStaff(w, "owner");
    const staff = await mkStaff(w, "staff");
    const stranger = await mkWho();
    const seat = async (u: Who) => (await client.query("SELECT id FROM tpo_members WHERE campus_id = $1 AND user_id = $2", [w.campusId, u.id])).rows[0].id as string;
    const staffSeat = await seat(staff);
    const post = (who: Who, id: string, body: unknown = {}) => call(R.transfer.POST, "POST", `/api/v1/tpo/staff/${id}/transfer-ownership`, as(who, { body }), { id });
    for (const who of [staff, stranger]) {
      const r = await post(who, staffSeat, { campusId: w.campusId });
      expect([r.status, r.json.code]).toEqual([404, "not_found"]);
    }
    const role = async (u: Who) => (await client.query("SELECT role FROM tpo_members WHERE campus_id = $1 AND user_id = $2", [w.campusId, u.id])).rows[0].role;
    expect([await role(owner), await role(staff)]).toEqual(["owner", "staff"]);
    expect((await call(R.transfer.POST, "POST", `/api/v1/tpo/staff/${staffSeat}/transfer-ownership`, { who: null, body: {} }, { id: staffSeat })).status).toBe(401);
    expect((await post(owner, "not-a-uuid")).status).toBe(400);
    const ok = await post(owner, staffSeat);
    expect([ok.status, ok.json]).toEqual([200, { status: "transferred" }]);
    expect(S.OwnershipTransferredSchema.parse(ok.json).status).toBe("transferred");
    expect([await role(owner), await role(staff)]).toEqual(["staff", "owner"]);
    // The former owner is now plain staff and can no longer remove anyone.
    const again = await call(R.staffMember.DELETE, "DELETE", `/api/v1/tpo/staff/${staffSeat}`, as(owner), { id: staffSeat });
    expect(again.status).toBe(404);
  });

  it("an invite is not claimable by an account whose email was never verified", async () => {
    const w = await mkCampus();
    const owner = await mkStaff(w, "owner");
    const mallory = await mkWho({ verified: false, email: `mallory-${randomUUID().slice(0, 6)}@example.test` });
    await call(R.staff.POST, "POST", "/api/v1/tpo/staff", as(owner, { body: { email: mallory.email } }));
    expect((await call(R.tpoMe.GET, "GET", "/api/v1/tpo/me", as(mallory))).json).toEqual({ campuses: [], pendingInvite: false });
    expect((await call(R.claim.POST, "POST", "/api/v1/tpo/claim", as(mallory))).json).toEqual({ claimed: 0 });
  });
});

describe("write roles (decision 2026-10-31): roster import and drive publishing are owner-or-officer only, no viewer role", () => {
  const csv = (w: World) => ["email", ...Array.from({ length: 10 }, (_, i) => `s${i}-${randomUUID().slice(0, 6)}@${w.domain}`)].join("\n");

  it("an owner and an officer (the staff seat) can import and publish", async () => {
    for (const role of ["owner", "staff"] as const) {
      const w = await mkCampus();
      const who = await mkStaff(w, role);
      const imp = await call(R.roster.POST, "POST", `/api/v1/tpo/cohorts/${w.cohortId}/roster`, as(who, { raw: csv(w), type: "text/csv" }), { id: w.cohortId });
      expect([role, imp.status]).toEqual([role, 200]);
      const pub = await call(R.drives.POST, "POST", "/api/v1/tpo/drives", as(who, { body: { cohortId: w.cohortId, title: "D", noticeText: NOTICE } }));
      expect([role, pub.status]).toEqual([role, 201]);
      // The roster tests below read these tables without a campus filter, so leave no rows behind.
      await client.query("DELETE FROM cohort_imports WHERE campus_id = $1", [w.campusId]);
      await client.query("DELETE FROM cohort_roster WHERE campus_id = $1", [w.campusId]);
    }
  });

  it("a seat with any other role is refused with 403 forbidden (not a 404: they are staff here), writes nothing, and can still read", async () => {
    const w = await mkCampus();
    const viewer = await mkStaff(w, "staff");
    const dropCheck = "ALTER TABLE tpo_members DROP CONSTRAINT tpo_members_role";
    try {
      await client.query(dropCheck);
      await client.query("UPDATE tpo_members SET role = 'viewer' WHERE user_id = $1", [viewer.id]);
      const imp = await call(R.roster.POST, "POST", `/api/v1/tpo/cohorts/${w.cohortId}/roster`, as(viewer, { raw: csv(w), type: "text/csv" }), { id: w.cohortId });
      expect([imp.status, imp.json.code]).toEqual([403, "forbidden"]);
      const pub = await call(R.drives.POST, "POST", "/api/v1/tpo/drives", as(viewer, { body: { cohortId: w.cohortId, title: "D", noticeText: NOTICE } }));
      expect([pub.status, pub.json.code]).toEqual([403, "forbidden"]);
      expect((await client.query("SELECT count(*)::int AS n FROM cohort_roster WHERE cohort_id = $1", [w.cohortId])).rows[0].n).toBe(0);
      expect((await client.query("SELECT count(*)::int AS n FROM drives WHERE cohort_id = $1", [w.cohortId])).rows[0].n).toBe(0);
      expect((await call(R.cohorts.GET, "GET", "/api/v1/tpo/cohorts", as(viewer))).status).toBe(200);
    } finally {
      await client.query("UPDATE tpo_members SET role = 'staff' WHERE role = 'viewer'");
      await client.query("ALTER TABLE tpo_members ADD CONSTRAINT tpo_members_role CHECK (role IN ('owner', 'staff'))");
    }
  });

  it("GET routes write no row: no access-log rows, no member changes, no import or roster rows", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w, "staff");
    const owner = await mkStaff(w, "owner");
    const st = await mkStudent(w, { share: "outcomes" });
    await client.query("INSERT INTO outcomes (user_id, campus_id, cohort_id, kind, employer, package_lpa) VALUES ($1, $2, $3, 'offer', 'Acme', 5)", [st.id, w.campusId, w.cohortId]);
    const snapshot = async () =>
      JSON.stringify(
        (
          await client.query(
            `SELECT (SELECT count(*) FROM tpo_access_log) AS log, (SELECT count(*) FROM tpo_members) AS members, (SELECT count(*) FROM tpo_members WHERE user_id IS NULL) AS open,
                    (SELECT count(*) FROM cohort_roster) AS roster, (SELECT count(*) FROM cohort_imports) AS imports, (SELECT count(*) FROM drives) AS drives, (SELECT count(*) FROM outcomes WHERE verification = 'tpo_verified') AS verified`,
          )
        ).rows[0],
      );
    const before = await snapshot();
    for (const [h, path] of [
      [R.tpoMe.GET, "/api/v1/tpo/me"],
      [R.cohorts.GET, "/api/v1/tpo/cohorts"],
      [R.drives.GET, "/api/v1/tpo/drives"],
      [R.outcomes.GET, "/api/v1/tpo/outcomes"],
      [R.naac.GET, "/api/v1/tpo/export/naac"],
      [R.staff.GET, "/api/v1/tpo/staff"],
    ] as const) {
      const r = await call(h as never, "GET", path, as(path.endsWith("staff") ? owner : staff));
      expect([path, r.status]).toEqual([path, 200]);
    }
    expect(await snapshot()).toBe(before);
  });
});

describe("cohort stats", () => {
  it("returns only the fixed metrics from the latest snapshot, suppressed and rounded; ?metric= names one; a free-form metric is 400", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const put = (day: string, metric: string, nn: number, p: number) => client.query("INSERT INTO cohort_stats_daily (cohort_id, day, metric, n, p) VALUES ($1, $2, $3, $4, $5)", [w.cohortId, day, metric, nn, p]);
    await put("2026-10-01", "joined_verified", 20, 20);
    await put("2026-10-02", "joined_verified", 43, 43);
    await put("2026-10-02", "stage_no_resume", 4, 43);
    await put("2026-10-02", "stage_resume_unconfirmed", 14, 43);
    await put("2026-10-02", "stage_confirmed", 25, 43);
    await put("2026-10-02", "ats_readable", 18, 39);
    const all = S.CohortStatsSchema.parse((await call(R.stats.GET, "GET", `/api/v1/tpo/cohorts/${w.cohortId}/stats`, as(staff), { id: w.cohortId })).json);
    expect(all.day).toBe("2026-10-02");
    const by = Object.fromEntries(all.metrics.map((m) => [m.metric, m]));
    expect(by["joined_verified"]).toMatchObject({ value: 45, suppressed: false });
    expect([by["stage_no_resume"]!.suppressed, by["stage_resume_unconfirmed"]!.suppressed]).toEqual([true, true]);
    expect(by["stage_confirmed"]).toMatchObject({ value: 25, suppressed: false });
    expect(by["ats_readable"]).toMatchObject({ value: 20, suppressed: false });
    const one = S.CohortStatsSchema.parse((await call(R.stats.GET, "GET", `/api/v1/tpo/cohorts/${w.cohortId}/stats?metric=ats_readable`, as(staff), { id: w.cohortId })).json);
    expect(one.metrics.map((m) => m.metric)).toEqual(["ats_readable"]);
    expect((await call(R.stats.GET, "GET", `/api/v1/tpo/cohorts/${w.cohortId}/stats?metric=email`, as(staff), { id: w.cohortId })).status).toBe(400);
    // No raw counts, populations or ids of people anywhere in the answer.
    expect(JSON.stringify(all)).not.toMatch(/"(n|p|user)"/);
    // The app role cannot read the snapshot table or the members behind it.
    await expect(client.query("SET ROLE hirelane_app; SELECT * FROM cohort_stats_daily").finally(() => client.query("RESET ROLE"))).rejects.toMatchObject({ code: "42501" });
  });

  it("a cohort with no snapshot yet says so, and a cohort of another campus is 404", async () => {
    const w = await mkCampus();
    const other = await mkCampus();
    const staff = await mkStaff(w);
    expect((await call(R.stats.GET, "GET", `/api/v1/tpo/cohorts/${w.cohortId}/stats`, as(staff), { id: w.cohortId })).json).toEqual({ day: null, metrics: [] });
    expect((await call(R.stats.GET, "GET", `/api/v1/tpo/cohorts/${other.cohortId}/stats`, as(staff), { id: other.cohortId })).status).toBe(404);
    expect((await call(R.stats.GET, "GET", "/api/v1/tpo/cohorts/not-a-uuid/stats", as(staff), { id: "not-a-uuid" })).status).toBe(400);
  });
});

describe("drive inbox: parse, publish, deliver", () => {
  it("publishes with parsed criteria and scam flags, never fetches the link, and delivers to eligible and unknown students but not to one who fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const pass = await mkStudent(w, { profile: PASSING });
    const fail = await mkStudent(w, { profile: FAILING });
    const unknown = await mkStudent(w);
    const placed = await mkStudent(w, { placed: true, profile: PASSING });
    const outsider = await mkStudent(await mkCampus(), { profile: PASSING });

    const pub = await call(R.drives.POST, "POST", "/api/v1/tpo/drives", as(staff, { body: { cohortId: w.cohortId, title: "Acme Works off-campus", noticeText: `${NOTICE} Pay a refundable registration fee of Rs 500 to confirm your seat. Contact hr.acme@gmail.com`, link: "https://bit.ly/acme-drive" } }));
    expect(pub.status).toBe(201);
    const drive = S.DrivePublishedSchema.parse(pub.json);
    expect((drive.criteria as { type: string }[]).map((c) => c.type)).toEqual(expect.arrayContaining(["min_score", "no_active_backlogs", "passout_years"]));
    expect(["medium", "high"]).toContain(drive.scamRisk);
    expect((drive.scamFlags as { id: string }[]).map((f) => f.id)).toEqual(expect.arrayContaining(["fee.upfront"]));

    const inbox = async (who: Who) => S.MyDrivesSchema.parse((await call(R.myDrives.GET, "GET", "/api/v1/campus/drives", as(who))).json);
    expect((await inbox(pass)).drives).toMatchObject([{ id: drive.id, verdict: "eligible", link: "https://bit.ly/acme-drive" }]);
    expect((await inbox(unknown)).drives).toMatchObject([{ id: drive.id, verdict: "unknown" }]);
    expect((await inbox(fail)).drives).toEqual([]);
    expect(await inbox(placed)).toEqual({ placed: true, drives: [] });
    expect((await inbox(outsider)).drives).toEqual([]);
    const reasons = (await inbox(pass)).drives[0]!.reasons.join(" ");
    expect(reasons).toMatch(/12th|backlog/i);
    // Each rule carries its own status: a passing drive shows only passes, and an unknown drive never marks a rule it passed as unknown.
    const passRules = (await inbox(pass)).drives[0]!.rules;
    expect(passRules.map((r) => r.text)).toEqual((await inbox(pass)).drives[0]!.reasons);
    expect(passRules.every((r) => r.status === "pass")).toBe(true);
    const unkRules = (await inbox(unknown)).drives[0]!.rules;
    expect(unkRules.some((r) => r.status === "unknown")).toBe(true);
    expect(unkRules.every((r) => r.status === "pass" || r.status === "unknown")).toBe(true);

    expect(fetchSpy.mock.calls.filter(([u]) => String(u).includes("acme") || String(u).includes("bit.ly"))).toEqual([]);
    fetchSpy.mockRestore();
    const list = S.DrivesListSchema.parse((await call(R.drives.GET, "GET", "/api/v1/tpo/drives", as(staff))).json);
    expect(list.drives.map((d) => d.id)).toEqual([drive.id]);
  });

  it("the campus CGPA rule is applied to a student with a CGPA only", async () => {
    const w = await mkCampus({ cgpaRule: { kind: "linear", a: 10, b: -7.5 } });
    const staff = await mkStaff(w);
    const cgpaOnly = await mkStudent(w, { profile: { grad_score: 6.5, grad_scale: 10, grad_conversion: `campus:${w.campusId}`, passout_year: 2026, degree: "B.Tech" } });
    await call(R.drives.POST, "POST", "/api/v1/tpo/drives", as(staff, { body: { cohortId: w.cohortId, title: "Needs 60", noticeText: "B.Tech 2026 batch. Minimum 60% in graduation." } }));
    // 6.5 CGPA = 57.5% by the campus rule: short of 60, so the drive is not offered.
    expect(S.MyDrivesSchema.parse((await call(R.myDrives.GET, "GET", "/api/v1/campus/drives", as(cgpaOnly))).json).drives).toEqual([]);
  });

  it("validates the input: no cohort of another campus, https links only, bounded text", async () => {
    const w = await mkCampus();
    const other = await mkCampus();
    const staff = await mkStaff(w);
    const post = (body: unknown) => call(R.drives.POST, "POST", "/api/v1/tpo/drives", as(staff, { body }));
    expect((await post({ cohortId: other.cohortId, title: "x", noticeText: "y" })).status).toBe(404);
    expect((await post({ cohortId: w.cohortId, title: "x", noticeText: "y", link: "javascript:alert(1)" })).status).toBe(400);
    expect((await post({ cohortId: w.cohortId, title: "", noticeText: "y" })).status).toBe(400);
    expect((await post({ cohortId: w.cohortId, title: "x", noticeText: "y".repeat(20_001) })).status).toBe(400);
    expect((await post({ cohortId: w.cohortId, title: "x", noticeText: "y", extra: 1 })).status).toBe(400);
  });
});

describe("outcomes: report, share, verify, letters, export", () => {
  const pdf = () => Buffer.from(`%PDF-1.4\n% synthetic offer ${randomUUID()}\n%%EOF\n`);
  const report = (who: Who, body: unknown) => call(R.myOutcomes.POST, "POST", "/api/v1/campus/outcomes", as(who, { body }));

  it("a student reports; the TPO sees it only at outcomes or full; verifying is logged; the student can read that log", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w, "staff");
    const agg = await mkStudent(w, { share: "aggregate" });
    const out = await mkStudent(w, { share: "outcomes" });
    const full = await mkStudent(w, { share: "full" });
    await client.query("UPDATE users SET display_name = 'Asha Test' WHERE id = $1", [out.id]);
    for (const [who, employer] of [[agg, "Hidden Co"], [out, "Shared Co"], [full, "Full Co"]] as const) {
      const r = await report(who, { kind: "offer", employer, packageLpa: 4.5, roleTitle: "Trainee" });
      expect(r.status).toBe(201);
      expect(S.OutcomeSchema.parse(r.json)).toMatchObject({ verification: "student_reported", employer });
    }
    // Decision 2026-10-31: the GET names nobody and writes nothing; so the students' logs are still empty after it.
    const redacted = await call(R.outcomes.GET, "GET", "/api/v1/tpo/outcomes", as(staff));
    expect(S.TpoOutcomesSchema.parse(redacted.json).outcomes.map((o) => o.employer).sort()).toEqual(["Full Co", "Shared Co"]);
    expect(S.TpoOutcomesSchema.parse(redacted.json).outcomes.every((o) => o.studentName === null && o.studentEmail === null)).toBe(true);
    expect(redacted.text).not.toContain("Asha Test");
    expect(redacted.text).not.toContain(full.email);
    expect(S.AccessLogSchema.parse((await call(R.log.GET, "GET", "/api/v1/campus/access-log", as(out))).json).entries).toEqual([]);
    // Naming a student is an explicit action, and it is logged for each student named.
    const named = await call(R.reveal.POST, "POST", "/api/v1/tpo/outcomes/reveal", as(staff, { body: {} }));
    expect(named.status).toBe(200);
    const seen = S.TpoOutcomesSchema.parse(named.json).outcomes;
    expect(seen.map((o) => o.employer).sort()).toEqual(["Full Co", "Shared Co"]);
    expect(seen.find((o) => o.employer === "Shared Co")).toMatchObject({ studentName: "Asha Test", studentEmail: null, memberVerified: true });
    expect(seen.find((o) => o.employer === "Full Co")!.studentEmail).toBe(full.email);
    const target = seen.find((o) => o.employer === "Shared Co")!;
    const v = await call(R.verify.POST, "POST", `/api/v1/tpo/outcomes/${target.id}/verify`, as(staff), { id: target.id });
    expect([v.status, S.OutcomeVerifiedSchema.parse(v.json).verification]).toEqual([200, "tpo_verified"]);
    expect((await call(R.verify.POST, "POST", `/api/v1/tpo/outcomes/${(await client.query("SELECT id FROM outcomes WHERE user_id = $1", [agg.id])).rows[0].id}/verify`, as(staff), { id: (await client.query("SELECT id FROM outcomes WHERE user_id = $1", [agg.id])).rows[0].id })).status).toBe(404);

    const log = S.AccessLogSchema.parse((await call(R.log.GET, "GET", "/api/v1/campus/access-log", as(out))).json).entries.map((e) => e.action).sort();
    expect(log).toEqual(["outcome_verify", "outcomes_list"]);
    expect(S.AccessLogSchema.parse((await call(R.log.GET, "GET", "/api/v1/campus/access-log", as(agg))).json).entries).toEqual([]);
    const mine = S.MyOutcomesSchema.parse((await call(R.myOutcomes.GET, "GET", "/api/v1/campus/outcomes", as(out))).json).outcomes;
    expect(mine).toMatchObject([{ employer: "Shared Co", verification: "tpo_verified" }]);
  });

  it("only a member can report, input is bounded, and there is a cap per student", async () => {
    const w = await mkCampus();
    const nobody = await mkWho();
    expect((await report(nobody, { kind: "offer", employer: "X" })).json.code).toBe("not_in_campus");
    const u = await mkStudent(w);
    for (const bad of [{ kind: "rejected", employer: "X" }, { kind: "offer", employer: "" }, { kind: "offer", employer: "X", packageLpa: -1 }, { kind: "offer", employer: "X", verification: "tpo_verified" }]) {
      expect((await report(u, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    await client.query("INSERT INTO outcomes (user_id, campus_id, cohort_id, kind, employer) SELECT $1, $2, $3, 'interview', 'Bulk ' || g FROM generate_series(1, 50) g", [u.id, w.campusId, w.cohortId]);
    expect((await report(u, { kind: "offer", employer: "One too many" })).json.code).toBe("too_many_outcomes");
  });

  it("the offer letter is sealed at rest, and a TPO gets it only with the share level, the consent, and an audit row", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w, "staff");
    const u = await mkStudent(w, { share: "outcomes" });
    const id = (await report(u, { kind: "offer", employer: "Letter Co" })).json.id as string;
    const bytes = pdf();
    const up = await call(R.letter.POST, "POST", `/api/v1/campus/outcomes/${id}/letter`, as(u, { raw: bytes, type: "application/pdf" }), { id });
    expect([up.status, up.json]).toEqual([200, { id, hasLetter: true }]);
    const stored = (await client.query("SELECT letter_enc FROM outcomes WHERE id = $1", [id])).rows[0].letter_enc as Buffer;
    expect(stored.includes(Buffer.from("synthetic offer"))).toBe(false); // sealed, not plaintext

    // Decision 2026-10-31: viewing the letter is an explicit action (POST): the view is logged for the student in the same call.
    const get = () => call(R.tpoLetter.POST, "POST", `/api/v1/tpo/outcomes/${id}/letter`, as(staff), { id });
    expect((R.tpoLetter as Record<string, unknown>)["GET"]).toBeUndefined();
    expect((await get()).status).toBe(404); // no consent yet
    await client.query("INSERT INTO consents (user_id, kind, granted, doc_version) VALUES ($1, 'offer_letter_tpo', true, 'v1')", [u.id]);
    const ok = await get();
    expect(ok.status).toBe(200);
    expect(ok.res.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await ok.res.arrayBuffer()).equals(bytes)).toBe(true);
    expect((await call(R.log.GET, "GET", "/api/v1/campus/access-log", as(u))).json.entries.map((e: { action: string }) => e.action)).toContain("letter_view");
    // A copy of the sealed bytes under another outcome or user does not open.
    const other = await mkStudent(w, { share: "outcomes" });
    const otherId = (await report(other, { kind: "offer", employer: "Other Co" })).json.id as string;
    await client.query("UPDATE outcomes SET letter_enc = $2, letter_mime = 'application/pdf' WHERE id = $1", [otherId, stored]);
    await client.query("INSERT INTO consents (user_id, kind, granted, doc_version) VALUES ($1, 'offer_letter_tpo', true, 'v1')", [other.id]);
    const swapped = await call(R.tpoLetter.POST, "POST", `/api/v1/tpo/outcomes/${otherId}/letter`, as(staff), { id: otherId });
    expect([swapped.status, swapped.json.code]).toEqual([500, "unreadable_record"]);
    // Withdrawing the consent closes it again.
    await client.query("INSERT INTO consents (user_id, kind, granted, doc_version) VALUES ($1, 'offer_letter_tpo', false, 'v1')", [u.id]);
    expect((await get()).status).toBe(404);
  });

  it("letter uploads are PDFs under 2 MB; other types, big files and other people's outcomes are refused", async () => {
    const w = await mkCampus();
    const u = await mkStudent(w);
    const thief = await mkStudent(w);
    const id = (await report(u, { kind: "offer", employer: "Co" })).json.id as string;
    const up = (who: Who, raw: Buffer | string, type = "application/pdf") => call(R.letter.POST, "POST", `/api/v1/campus/outcomes/${id}/letter`, as(who, { raw, type }), { id });
    expect((await up(u, Buffer.from("not a pdf at all"))).status).toBe(415);
    expect((await up(u, pdf(), "image/png")).status).toBe(415);
    expect((await up(u, Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(2 * 1024 * 1024 + 1)]))).status).toBe(413);
    expect((await up(thief, pdf())).status).toBe(404);
    expect((await up(u, pdf())).status).toBe(200);
    await client.query("UPDATE outcomes SET verification = 'tpo_verified', verified_at = now() WHERE id = $1", [id]);
    expect((await up(u, pdf())).status).toBe(404); // locked once verified
  });

  it("the NAAC export has the 5.2.1 shape, only verified members at outcomes or full, neutralises formulas, and is audited", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w, "staff");
    const ok = await mkStudent(w, { share: "outcomes" });
    const code = await mkStudent(w, { share: "outcomes", via: "code" });
    const private_ = await mkStudent(w, { share: "aggregate" });
    await client.query("UPDATE users SET display_name = $2 WHERE id = $1", [ok.id, '=HYPERLINK("http://evil.example.test","click")']);
    await report(ok, { kind: "offer", employer: "+cmd|' /C calc'!A0", packageLpa: 6.25 });
    await report(ok, { kind: "interview", employer: "Interview Only" });
    await report(code, { kind: "offer", employer: "Unverified Seat Co" });
    await report(private_, { kind: "offer", employer: "Private Co" });
    // The GET is a preview: a count and the headers, no student named, nothing logged.
    const preview = await call(R.naac.GET, "GET", `/api/v1/tpo/export/naac?passoutYear=2026`, as(staff));
    expect(S.NaacPreviewSchema.parse(preview.json)).toMatchObject({ rows: 1, header: [...S.NAAC_HEADER] });
    expect(preview.text).not.toContain("HYPERLINK");
    expect(S.AccessLogSchema.parse((await call(R.log.GET, "GET", "/api/v1/campus/access-log", as(ok))).json).entries).toEqual([]);
    // The file is an explicit action (POST), audited per student in the same call.
    const res = await call(R.naac.POST, "POST", `/api/v1/tpo/export/naac?passoutYear=2026`, as(staff));
    expect(res.status).toBe(200);
    expect(res.res.headers.get("content-type")).toMatch(/^text\/csv/);
    expect(res.res.headers.get("content-disposition")).toMatch(/^attachment; filename="naac-5\.2\.1-2026-\d{4}-\d{2}-\d{2}\.csv"$/);
    // The file opens with comment lines naming the manual, then Part A (placement) and Part B (higher education).
    const lines = res.text.split("\r\n").filter((l) => l !== "");
    const isComment = (l: string) => /^"?# /.test(l);
    expect(lines.filter(isComment).join("\n")).toContain("RAF 2023");
    expect(lines.filter(isComment).join("\n")).toContain("5.2.1");
    const body = lines.filter((l) => !isComment(l));
    const partB = body.findIndex((l) => l.startsWith(S.NAAC_HIGHER_ED_HEADER[0]));
    expect(partB).toBeGreaterThan(0);
    const rows = S.parseCsv(body.slice(0, partB).join("\r\n"));
    expect(rows.header).toEqual([...S.NAAC_HEADER]);
    expect(S.parseCsv(body.slice(partB).join("\r\n")).header).toEqual([...S.NAAC_HIGHER_ED_HEADER]);
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0]!;
    expect(row[0]).toMatch(/^20\d{2}$/);
    expect(row[1]).toBe(`'=HYPERLINK("http://evil.example.test","click")`);
    expect(row[3]).toBe("'+cmd|' /C calc'!A0");
    expect(row[4]).toBe(""); // no employer contact is stored yet, so the cell stays blank
    expect([row[2], row[5], row[6]]).toEqual(["B.Tech CSE", "6.25", "student-reported"]);
    for (const line of body.slice(1, partB)) expect(line).not.toMatch(/^"?[=+\-@]/);
    expect(res.text).not.toContain("Unverified Seat Co");
    expect(res.text).not.toContain("Private Co");
    expect(S.AccessLogSchema.parse((await call(R.log.GET, "GET", "/api/v1/campus/access-log", as(ok))).json).entries.map((e) => e.action)).toEqual(["naac_export"]);
    expect(S.AccessLogSchema.parse((await call(R.log.GET, "GET", "/api/v1/campus/access-log", as(private_))).json).entries).toEqual([]);
    expect((await call(R.naac.GET, "GET", `/api/v1/tpo/export/naac?passoutYear=1900`, as(staff))).status).toBe(400);
  });
});

describe("roster import", () => {
  const post = (who: Who, w: World, csv: string | Buffer, type = "text/csv") => call(R.roster.POST, "POST", `/api/v1/tpo/cohorts/${w.cohortId}/roster`, as(who, { raw: csv, type }), { id: w.cohortId });

  it("stores only email hashes and the placed flag, stages the roster until the snapshot applies it, and drops placed students from the inbox", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w, "staff");
    const joiner = await mkWho({ email: `Rahul.K@${w.domain}` });
    await call(R.join.POST, "POST", "/api/v1/campus/join", as(joiner, { body: { code: w.code, cohortId: w.cohortId } }));
    expect((await client.query("SELECT verified_via FROM cohort_members WHERE user_id = $1", [joiner.id])).rows[0].verified_via).toBe("code");

    const fillers = Array.from({ length: 10 }, (_, i) => `${2000 + i},Filler ${i},filler${i}@${w.domain},no`).join("\r\n");
    const csv = `\uFEFFRoll No,Name,E-mail,Placement Status\r\n1001,"Rao, Rahul",rahul.k@${w.domain},Placed\r\n1002,Sneha,sneha@${w.domain},no\r\n1003,Broken,not-an-email,yes\r\n1004,Dup,SNEHA@${w.domain},yes\r\n${fillers}\r\n3001,Outsider,outsider@elsewhere.example.test,yes\r\n`;
    const r = await post(staff, w, csv);
    expect(r.status).toBe(200);
    // No match count: whether a given student joined is not revealed. The off-domain row and the broken one are rejected.
    expect(S.RosterResultSchema.parse(r.json)).toEqual({ rowsTotal: 15, rowsValid: 12, rowsRejected: 2 });
    expect(JSON.stringify(r.json)).not.toContain("matched");

    // Staged only: the member does not change until the nightly snapshot applies the roster.
    expect((await client.query("SELECT verified_via, verified_at IS NOT NULL AS v, placed FROM cohort_members WHERE user_id = $1", [joiner.id])).rows[0]).toEqual({ verified_via: "code", v: false, placed: false });
    await client.query("SELECT campus_apply_roster()");
    const m = (await client.query("SELECT verified_via, verified_at IS NOT NULL AS v, placed FROM cohort_members WHERE user_id = $1", [joiner.id])).rows[0];
    expect(m).toEqual({ verified_via: "roster", v: true, placed: true });
    // No plain addresses, names or roll numbers anywhere in the roster tables.
    const rosterRows = (await client.query("SELECT * FROM cohort_roster")).rows;
    // The hashes are random-looking text that could contain "rao" or "1001" by chance, so look at everything else.
    let dump = JSON.stringify(rosterRows) + JSON.stringify((await client.query("SELECT * FROM cohort_imports")).rows);
    for (const row of rosterRows) dump = dump.split(String(row.email_hmac)).join("");
    for (const secret of ["rahul", "sneha", "Rao", "1001", "gmail", "example.test", "outsider"]) expect(dump.toLowerCase()).not.toContain(secret.toLowerCase());
    expect((await client.query("SELECT email_hmac, placed FROM cohort_roster WHERE cohort_id = $1", [w.cohortId])).rows).toHaveLength(12);
    expect((await client.query("SELECT placed FROM cohort_roster WHERE email_hmac = $1", [await S.mailboxHmac(keys, `sneha@${w.domain}`)])).rows[0].placed).toBe(true); // last duplicate wins

    // A placed student no longer gets drive mail.
    await call(R.drives.POST, "POST", "/api/v1/tpo/drives", as(staff, { body: { cohortId: w.cohortId, title: "D", noticeText: "Open to all." } }));
    expect(S.MyDrivesSchema.parse((await call(R.myDrives.GET, "GET", "/api/v1/campus/drives", as(joiner))).json)).toEqual({ placed: true, drives: [] });
    const imports = (await client.query("SELECT rows_total, rows_valid, rows_rejected FROM cohort_imports")).rows;
    expect(imports).toEqual([{ rows_total: 15, rows_valid: 12, rows_rejected: 2 }]);
  });

  it("refuses a file under ten valid rows (a probe for one student) and a second import inside 24 hours", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w, "staff");
    const probe = await post(staff, w, `email\nasha@${w.domain}\n`);
    expect([probe.status, probe.json.code]).toEqual([400, "too_few_rows"]);
    const ten = "email\n" + Array.from({ length: 10 }, (_, i) => `s${i}@${w.domain}`).join("\n") + "\n";
    expect((await post(staff, w, ten)).status).toBe(200);
    const again = await post(staff, w, ten);
    expect([again.status, again.json.code]).toEqual([429, "import_rate_limited"]);
  });

  it("refuses bad files: wrong type, no email column, no valid rows, unterminated quote, too big, too many rows", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    expect((await post(staff, w, "email\na@x.edu\n", "application/pdf")).status).toBe(415);
    expect((await post(staff, w, "name,roll\nA,1\n")).json.code).toBe("missing_email_column");
    expect((await post(staff, w, "email\nnope\n")).json.code).toBe("no_valid_rows");
    expect((await post(staff, w, 'email\n"a@x.edu\n')).json.code).toBe("bad_csv");
    expect((await post(staff, w, "email\n" + "a".repeat(1024 * 1024))).status).toBe(413);
    const many = "email\n" + Array.from({ length: 20_001 }, (_, i) => `s${i}@x.edu`).join("\n") + "\n";
    expect([(await post(staff, w, many)).status]).toEqual([413]);
    expect((await client.query("SELECT 1 FROM cohort_roster WHERE cohort_id = $1", [w.cohortId])).rowCount).toBe(0);
  });
});

describe("the access log lists reads of a student, not staff changes", () => {
  it("a staff member who is also a cohort member never sees staff_removed / staff_invited rows in their log", async () => {
    const w = await mkCampus();
    const owner = await mkStaff(w, "owner");
    const member = await mkStudent(w, { share: "outcomes" });
    // The same person is later made staff and then removed: the lifecycle rows have them as subject.
    await client.query("INSERT INTO tpo_members (campus_id, user_id, email_hmac, role, claimed_at) VALUES ($1, $2, $3, 'staff', now())", [w.campusId, member.id, `ex-${member.id}`]);
    const staffRow = (await client.query("SELECT id FROM tpo_members WHERE user_id = $1", [member.id])).rows[0].id as string;
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE hirelane_app");
    await client.query("SELECT set_config('hirelane.user_id', $1, true)", [owner.id]);
    expect((await client.query("SELECT tpo_remove_staff($1, $2) AS r", [w.campusId, staffRow])).rows[0].r).toEqual({ status: "removed" });
    await client.query("COMMIT");
    expect((await client.query("SELECT count(*)::int AS n FROM tpo_access_log WHERE subject_user_id = $1 AND action = 'staff_removed'", [member.id])).rows[0].n).toBe(1);
    const log = S.AccessLogSchema.parse((await call(R.log.GET, "GET", "/api/v1/campus/access-log", as(member))).json).entries.map((e) => e.action);
    expect(log.some((a) => a.startsWith("staff_") || a === "ownership_transferred")).toBe(false);
  });
});

describe("account erasure", () => {
  it("deleting the account removes the membership, outcomes (letters included) and log rows", async () => {
    const w = await mkCampus();
    const u = await mkStudent(w, { share: "full" });
    const id = (await call(R.myOutcomes.POST, "POST", "/api/v1/campus/outcomes", as(u, { body: { kind: "offer", employer: "Gone Co" } }))).json.id as string;
    await call(R.letter.POST, "POST", `/api/v1/campus/outcomes/${id}/letter`, as(u, { raw: Buffer.from("%PDF-1.4\n%%EOF\n"), type: "application/pdf" }), { id });
    await client.query("INSERT INTO tpo_access_log (campus_id, subject_user_id, action) VALUES ($1, $2, 'outcomes_list')", [w.campusId, u.id]);
    const { defaultAuthDeps, deleteAccountFor } = await import("../lib/auth/session");
    await deleteAccountFor(defaultAuthDeps(), u.id);
    for (const t of ["cohort_members", "outcomes", "join_attempts", "drive_checks"]) expect((await client.query(`SELECT 1 FROM ${t} WHERE user_id = $1`, [u.id])).rowCount, t).toBe(0);
    expect((await client.query("SELECT 1 FROM tpo_access_log WHERE subject_user_id = $1", [u.id])).rowCount).toBe(0);
  });
});
