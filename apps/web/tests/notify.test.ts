import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileOutbox, type Mailer, type MailMessage } from "@hirelane/agent";
import { generateMasterKey } from "@hirelane/vault";
import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authTestDb } from "./helpers/auth-db";

// P0-6 notifications end to end: real database and RLS, the real engine for who is told, the real Mailer contract (a recording
// mailer, plus the dev file outbox once). Synthetic data only. 0 LLM calls; no network (fetch is spied on).
let client: Client;
let close: () => Promise<void>;
let closePool: () => Promise<void>;
let S: typeof import("@hirelane/services");
let ctxFor: typeof import("../lib/http/ctx").serviceCtxFor;
let keys: ReturnType<typeof import("../lib/http/ctx").v1Keys>;
let fetchSpy: ReturnType<typeof vi.spyOn>;
let n = 0;

const NOW = new Date("2026-10-31T04:00:00Z"); // 31 Oct 2026, 09:30 IST
const APP = "https://app.example.test";

class Recorder implements Mailer {
  sent: MailMessage[] = [];
  failFor = new Set<string>();
  async send(m: MailMessage) {
    if (this.failFor.has(m.to)) throw new Error("smtp down");
    this.sent.push(m);
    return { id: randomUUID() };
  }
}
let mailer: Recorder;
const deps = () => ({ db: client, mailer, keys, now: () => NOW, appUrl: APP });

type Who = { id: string; email: string };
async function mkWho(o: { verified?: boolean } = {}): Promise<Who> {
  const id = randomUUID();
  const email = `notify-${++n}-${id.slice(0, 6)}@example.test`;
  await client.query(
    `WITH u AS (INSERT INTO users (id, email, email_verified_at) VALUES ($1, $2, ${o.verified === false ? "NULL" : "now()"}) RETURNING id)
     INSERT INTO consents (user_id, kind, granted, doc_version) SELECT id, 'age_18_plus', true, 'test' FROM u`,
    [id, email],
  );
  return { id, email };
}
interface World {
  campusId: string;
  cohortId: string;
}
async function mkCampus(): Promise<World> {
  const campusId = randomUUID();
  const cohortId = randomUUID();
  await client.query("INSERT INTO campuses (id, name, code_hmac) VALUES ($1, $2, $3)", [campusId, `Notify College ${campusId.slice(0, 6)}`, `hmac-${campusId}`]);
  await client.query("INSERT INTO cohorts (id, campus_id, passout_year, programme) VALUES ($1, $2, 2026, 'B.Com')", [cohortId, campusId]);
  return { campusId, cohortId };
}
async function mkStaff(w: World): Promise<Who> {
  const u = await mkWho();
  await client.query("INSERT INTO tpo_members (campus_id, user_id, email_hmac, role, claimed_at) VALUES ($1, $2, $3, 'owner', now())", [w.campusId, u.id, `staff-${u.id}`]);
  return u;
}
const GOOD = { pct_10: 80, secondary_kind: "12th", pct_secondary: 78, grad_pct_equiv: 70, grad_scale: 100, grad_score: 70, active_backlogs: 0, passout_year: 2026, degree: "B.Com" };
async function mkStudent(w: World, o: { profile?: Record<string, unknown> | null; placed?: boolean; verified?: boolean; share?: string } = {}): Promise<Who> {
  const u = await mkWho({ verified: o.verified });
  await client.query("INSERT INTO cohort_members (user_id, campus_id, cohort_id, verified_via, verified_at, email_hmac, placed, share_level) VALUES ($1, $2, $3, 'email', now(), $4, $5, $6)", [u.id, w.campusId, w.cohortId, `m-${u.id}`, o.placed ?? false, o.share ?? "aggregate"]);
  const profile = o.profile === undefined ? GOOD : o.profile;
  if (profile) {
    const cols = Object.keys(profile);
    await client.query(`INSERT INTO eligibility_profiles (user_id, confirmed_at, ${cols.join(", ")}) VALUES ($1, now(), ${cols.map((_, i) => `$${i + 2}`).join(", ")})`, [u.id, ...Object.values(profile)]);
  }
  return u;
}
const NOTICE = "B.Com 2026 passout. Minimum 60% in graduation. No active backlogs.";
const input = (w: World, over: Record<string, unknown> = {}) => ({ cohortId: w.cohortId, title: "Customer Success Associate", noticeText: NOTICE, ...over });
const rowsOf = async (userId: string, kind?: string) =>
  (await client.query(`SELECT kind, title, email_state, drive_id, outcome_id FROM notifications WHERE user_id = $1 ${kind ? "AND kind = $2" : ""} ORDER BY created_at, id`, kind ? [userId, kind] : [userId])).rows;
const mailTo = (who: Who) => mailer.sent.filter((m) => m.to === who.email);

beforeAll(async () => {
  const db = await authTestDb("hirelane_notify_test");
  client = db.client;
  close = db.close;
  process.env["DATABASE_URL"] = db.url;
  process.env["HIRELANE_MASTER_KEY"] = generateMasterKey();
  process.env["HIRELANE_STORAGE_DIR"] = mkdtempSync(join(tmpdir(), "hirelane-notify-blobs-"));
  closePool = (await import("@hirelane/db")).close;
  S = await import("@hirelane/services");
  const ctxMod = await import("../lib/http/ctx");
  ctxFor = ctxMod.serviceCtxFor;
  keys = ctxMod.v1Keys();
  fetchSpy = vi.spyOn(globalThis, "fetch");
});
afterAll(async () => {
  fetchSpy.mockRestore();
  await closePool();
  await close();
});
beforeEach(async () => {
  mailer = new Recorder();
  fetchSpy.mockClear();
  // The sweep is global (it mails every pending row), so each test starts with an empty queue.
  await client.query("DELETE FROM notifications");
  await client.query("DELETE FROM drives");
});

describe("new drive", () => {
  it("tells students who are eligible or still to be checked, and nobody else, once", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const eligible = await mkStudent(w);
    const unknown = await mkStudent(w, { profile: null });
    const failing = await mkStudent(w, { profile: { ...GOOD, active_backlogs: 2 } });
    const placed = await mkStudent(w, { placed: true });
    const otherCohort = await mkStudent(await mkCampus());
    const live = await S.publishDriveNow(ctxFor(staff.id), input(w));
    await S.saveDriveDraft(ctxFor(staff.id), input(w, { title: "Still a draft" }));

    const first = await S.notifyNewDrives(deps());
    expect(first).toMatchObject({ drives: 1, created: 2 });
    expect(await rowsOf(eligible.id, "drive_published")).toEqual([{ kind: "drive_published", title: "New drive for you: Customer Success Associate", email_state: "pending", drive_id: live.id, outcome_id: null }]);
    expect((await rowsOf(unknown.id, "drive_published"))[0]!.title).toBe("New drive: Customer Success Associate (some rules need your check)");
    for (const none of [failing, placed, otherCohort]) expect(await rowsOf(none.id)).toEqual([]);
    expect((await client.query("SELECT count(*)::int AS n FROM notifications WHERE title LIKE '%Still a draft%'")).rows[0].n).toBe(0);

    expect(await S.notifyNewDrives(deps())).toMatchObject({ created: 0 }); // a second sweep adds nothing
    expect((await rowsOf(eligible.id)).length).toBe(1);
  });

  it("is a Home row the student can read, newest first, with the unread count; reading is their own", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const a = await mkStudent(w);
    const b = await mkStudent(w);
    await S.publishDriveNow(ctxFor(staff.id), input(w));
    await S.notifyNewDrives(deps());
    const mine = await S.listNotifications(ctxFor(a.id));
    expect(() => S.NotificationListSchema.parse(mine)).not.toThrow();
    expect(mine.unread).toBe(1);
    expect(mine.items[0]).toMatchObject({ kind: "drive_published", readAt: null });
    expect((await S.listNotifications(ctxFor(b.id))).items[0]!.id).not.toBe(mine.items[0]!.id);
    await S.markInboxRead(ctxFor(a.id));
    expect((await S.listNotifications(ctxFor(a.id))).unread).toBe(0);
    expect((await S.listNotifications(ctxFor(b.id))).unread).toBe(1);
  });
});

describe("closes tomorrow", () => {
  it("notifies the audience of live drives whose deadline is tomorrow in India, and only those", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const s = await mkStudent(w);
    const failing = await mkStudent(w, { profile: { ...GOOD, active_backlogs: 3 } });
    await S.publishDriveNow(ctxFor(staff.id), input(w, { title: "Tomorrow", deadline: "2026-11-01" }));
    await S.publishDriveNow(ctxFor(staff.id), input(w, { title: "Today", deadline: "2026-10-31" }));
    await S.publishDriveNow(ctxFor(staff.id), input(w, { title: "Next week", deadline: "2026-11-07" }));
    await S.publishDriveNow(ctxFor(staff.id), input(w, { title: "No date" }));
    await S.saveDriveDraft(ctxFor(staff.id), input(w, { title: "Draft tomorrow", deadline: "2026-11-01" }));
    expect(await S.notifyClosingTomorrow(deps())).toMatchObject({ drives: 1, created: 1 });
    expect((await rowsOf(s.id, "drive_closing")).map((r) => r.title)).toEqual(["Closes tomorrow: Tomorrow"]);
    expect(await rowsOf(failing.id, "drive_closing")).toEqual([]);
    expect(await S.notifyClosingTomorrow(deps())).toMatchObject({ created: 0 });
  });

  it("uses the India day: 23:30 UTC on 31 Oct is already 1 Nov, so the drive closing on 2 Nov is 'tomorrow'", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const s = await mkStudent(w);
    await S.publishDriveNow(ctxFor(staff.id), input(w, { title: "Edge", deadline: "2026-11-02" }));
    const late = { ...deps(), now: () => new Date("2026-10-31T23:30:00Z") };
    expect(await S.notifyClosingTomorrow(late)).toMatchObject({ created: 1 });
    expect((await rowsOf(s.id, "drive_closing")).length).toBe(1);
  });
});

describe("employer reply", () => {
  it("is a Home row and, after the sweep, an email; one per message", async () => {
    const w = await mkCampus();
    const s = await mkStudent(w);
    const inbound = randomUUID();
    const ev = { userId: s.id, employer: "Acme Systems", kind: "interview" as const, applicationId: null, inboundId: inbound };
    // the inbound_id column points at inbound_messages; create the message the way the scanner would
    await client.query("INSERT INTO inbound_messages (id, user_id, message_id, employer, from_domain, kind, matched_by, excerpt_enc, received_at) VALUES ($1, $2, $3, 'Acme Systems', 'acme.example.test', 'interview', 'company', '\\x00', now())", [inbound, s.id, `m-${inbound}`]);
    expect(await S.notifyEmployerReply(deps(), ev)).toEqual({ created: true });
    expect(await S.notifyEmployerReply(deps(), ev)).toEqual({ created: false });
    expect((await rowsOf(s.id, "employer_reply")).map((r) => r.title)).toEqual(["Acme Systems invited you to an interview"]);
    expect(await S.sendPendingEmails(deps())).toMatchObject({ sent: 1 });
    const m = mailTo(s);
    expect(m).toHaveLength(1);
    expect(m[0]!.subject).toBe("Acme Systems invited you to an interview");
    expect(m[0]!.text).toContain(`${APP}/home`);
    expect(m[0]!.text).not.toMatch(/unsubscribe/i); // critical: always sent
  });
});

describe("offer verified", () => {
  it("is written when the TPO verifies an offer, and mailed by the sweep; an interview is not", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const s = await mkStudent(w, { share: "outcomes" });
    const offer = await S.reportOutcome(ctxFor(s.id), { kind: "offer", employer: "Retail chain", packageLpa: 3.2 });
    const interview = await S.reportOutcome(ctxFor(s.id), { kind: "interview", employer: "Other Co" });
    await S.verifyOutcome(ctxFor(staff.id), { id: interview.id });
    expect(await rowsOf(s.id, "outcome_verified")).toEqual([]);
    await S.verifyOutcome(ctxFor(staff.id), { id: offer.id });
    await S.verifyOutcome(ctxFor(staff.id), { id: offer.id });
    expect(await rowsOf(s.id, "outcome_verified")).toEqual([{ kind: "outcome_verified", title: "Your offer from Retail chain was verified by your placement cell", email_state: "pending", drive_id: null, outcome_id: offer.id }]);
    await S.sendPendingEmails(deps());
    expect(mailTo(s).map((m) => m.subject)).toEqual(["Your offer from Retail chain was verified by your placement cell"]);
  });
});

describe("email: preferences, unsubscribe, failure, and at most once", () => {
  it("sends optional kinds with an unsubscribe link, follows a student's setting, and never repeats", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const on = await mkStudent(w);
    const off = await mkStudent(w);
    const unverified = await mkStudent(w, { verified: false });
    await S.setNotificationPref(ctxFor(off.id), { kind: "drive_published", email: false });
    await S.publishDriveNow(ctxFor(staff.id), input(w));
    await S.notifyNewDrives(deps());

    expect(await S.sendPendingEmails(deps())).toEqual({ sent: 1, skipped: 2, failed: 0 });
    expect(mailTo(on)).toHaveLength(1);
    expect(mailTo(off)).toEqual([]);
    expect(mailTo(unverified)).toEqual([]);
    const text = mailTo(on)[0]!.text;
    expect(text).toMatch(/Stop these emails: https:\/\/app\.example\.test\/unsubscribe\?t=[0-9a-f]{64}/);
    // the Home row exists for everyone, whatever their email setting
    for (const who of [on, off, unverified]) expect((await rowsOf(who.id, "drive_published"))).toHaveLength(1);
    expect((await rowsOf(off.id, "drive_published"))[0]!.email_state).toBe("skipped");
    expect((await rowsOf(on.id, "drive_published"))[0]!.email_state).toBe("sent");

    expect(await S.sendPendingEmails(deps())).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(mailer.sent).toHaveLength(1);
  });

  it("the unsubscribe link works without a session, turns off both optional kinds, and keeps the Home rows and critical mail", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const s = await mkStudent(w);
    const bystander = await mkStudent(w);
    await S.publishDriveNow(ctxFor(staff.id), input(w, { title: "First" }));
    await S.notifyNewDrives(deps());
    await S.sendPendingEmails(deps());
    const token = /unsubscribe\?t=([0-9a-f]{64})/.exec(mailTo(s)[0]!.text)![1]!;

    expect(await S.unsubscribeByToken(token)).toEqual({ unsubscribed: true });
    expect((await S.getNotificationPrefs(ctxFor(s.id))).prefs).toEqual([
      { kind: "drive_published", email: false, locked: false },
      { kind: "drive_closing", email: false, locked: false },
      { kind: "employer_reply", email: true, locked: true },
      { kind: "outcome_verified", email: true, locked: true },
    ]);
    expect((await S.getNotificationPrefs(ctxFor(bystander.id))).prefs.every((p) => p.email)).toBe(true);

    await S.publishDriveNow(ctxFor(staff.id), input(w, { title: "Second", deadline: "2026-11-01" }));
    await S.notifyNewDrives(deps());
    await S.notifyClosingTomorrow(deps());
    await S.sendPendingEmails(deps());
    expect(mailTo(s)).toHaveLength(1); // nothing more by email...
    expect((await rowsOf(s.id)).length).toBeGreaterThanOrEqual(3); // ...but the Home rows kept coming
    expect(mailTo(bystander).length).toBeGreaterThanOrEqual(2);
  });

  it("a wrong, malformed or missing token changes nothing and answers the same way", async () => {
    const w = await mkCampus();
    const s = await mkStudent(w);
    for (const bad of ["0".repeat(64), "short", "", null, undefined, 42, "'; DROP TABLE users; --"]) expect(await S.unsubscribeByToken(bad as never)).toEqual({ unsubscribed: true });
    expect((await client.query("SELECT count(*)::int AS n FROM notification_prefs WHERE user_id = $1", [s.id])).rows[0].n).toBe(0);
  });

  it("one student's token cannot unsubscribe another", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const a = await mkStudent(w);
    const b = await mkStudent(w);
    await S.publishDriveNow(ctxFor(staff.id), input(w));
    await S.notifyNewDrives(deps());
    await S.sendPendingEmails(deps());
    await S.unsubscribeByToken(/t=([0-9a-f]{64})/.exec(mailTo(a)[0]!.text)![1]);
    expect((await S.getNotificationPrefs(ctxFor(a.id))).prefs[0]!.email).toBe(false);
    expect((await S.getNotificationPrefs(ctxFor(b.id))).prefs[0]!.email).toBe(true);
  });

  it("a failed send is recorded as failed, does not stop the others, never logs the address, and is not retried into a duplicate", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const bad = await mkStudent(w);
    const good = await mkStudent(w);
    mailer.failFor.add(bad.email);
    await S.publishDriveNow(ctxFor(staff.id), input(w));
    await S.notifyNewDrives(deps());
    const spies = (["log", "warn", "error", "info"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => undefined));
    const r = await S.sendPendingEmails(deps());
    const logged = spies.flatMap((s) => s.mock.calls.flat()).join(" ");
    spies.forEach((s) => s.mockRestore());
    expect(r).toEqual({ sent: 1, skipped: 0, failed: 1 });
    expect(logged).not.toContain(bad.email);
    expect((await rowsOf(bad.id, "drive_published"))[0]!.email_state).toBe("failed");
    expect(mailTo(good)).toHaveLength(1);
    mailer.failFor.clear();
    expect(await S.sendPendingEmails(deps())).toEqual({ sent: 0, skipped: 0, failed: 0 });
  });

  it("two sweeps at once send each email at most once", async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    for (let i = 0; i < 5; i++) await mkStudent(w);
    await S.publishDriveNow(ctxFor(staff.id), input(w));
    await S.notifyNewDrives(deps());
    // a second connection stands in for a second worker
    const { Client } = await import("pg");
    const other = new Client({ connectionString: process.env["DATABASE_URL"]! });
    await other.connect();
    try {
      await Promise.all([S.sendPendingEmails(deps()), S.sendPendingEmails({ ...deps(), db: other })]);
    } finally {
      await other.end();
    }
    expect(mailer.sent).toHaveLength(5);
    expect(new Set(mailer.sent.map((m) => m.to)).size).toBe(5);
  });

  it("a hostile title cannot start a header, and the mail is plain text", async () => {
    const w = await mkCampus();
    const s = await mkStudent(w);
    await client.query("INSERT INTO notifications (user_id, kind, title, email_state) VALUES ($1, 'drive_published', $2, 'pending')", [s.id, "Hi\r\nBcc: attacker@example.test <b>x</b>"]);
    await S.sendPendingEmails(deps());
    const m = mailTo(s)[0]!;
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.text.split("\n")[0]).not.toMatch(/[\r]/);
  });

  it("the scheduler pass does it all, and the dev file outbox carries the mail", async () => {
    const outbox = mkdtempSync(join(tmpdir(), "hirelane-notify-outbox-"));
    try {
      const w = await mkCampus();
      const staff = await mkStaff(w);
      const s = await mkStudent(w);
      await S.publishDriveNow(ctxFor(staff.id), input(w, { deadline: "2026-11-01" }));
      const r = await S.runNotifySweep({ ...deps(), mailer: createFileOutbox({ dir: outbox, env: { NODE_ENV: "development" } }) });
      expect(r.newDrives.created).toBeGreaterThanOrEqual(1);
      expect(r.email.sent).toBeGreaterThanOrEqual(2);
      const files = readdirSync(outbox);
      const mine = files.map((f) => readFileSync(join(outbox, f), "utf8")).filter((t) => t.includes(`To: ${s.email}`));
      expect(mine.length).toBe(2); // new drive + closes tomorrow
      expect(mine.every((t) => /unsubscribe\?t=/.test(t))).toBe(true);
    } finally {
      rmSync(outbox, { recursive: true, force: true });
    }
  });
});

describe("preferences", () => {
  it("only the two optional kinds can be set; the critical ones are 400", async () => {
    const w = await mkCampus();
    const s = await mkStudent(w);
    const after = await S.setNotificationPref(ctxFor(s.id), { kind: "drive_closing", email: false });
    expect(() => S.PrefsSchema.parse(after)).not.toThrow();
    expect(after.prefs.find((p) => p.kind === "drive_closing")).toEqual({ kind: "drive_closing", email: false, locked: false });
    await expect(S.setNotificationPref(ctxFor(s.id), { kind: "employer_reply", email: false })).rejects.toMatchObject({ status: 400 });
    await expect(S.setNotificationPref(ctxFor(s.id), { kind: "outcome_verified", email: false })).rejects.toMatchObject({ status: 400 });
    expect((await S.setNotificationPref(ctxFor(s.id), { kind: "drive_closing", email: true })).prefs.find((p) => p.kind === "drive_closing")!.email).toBe(true);
  });
});
