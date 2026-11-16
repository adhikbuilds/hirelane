import { describe, expect, it } from "vitest";
import type { InboxDrive } from "@hirelane/services";
import { reachLabel, toDriveInbox } from "@/lib/adapters/campus-drives";

const NOW = new Date("2026-10-31T04:00:00Z"); // 31 Oct, 09:30 IST
const cohorts = [{ id: "c1", passoutYear: 2026, programme: "B.Com", rosterSize: 120, snapshotDay: "2026-10-30", joined: 100, joinedSuppressed: false }];

const drive = (over: Partial<InboxDrive> = {}): InboxDrive => ({
  id: "d1",
  cohortId: "c1",
  title: "Customer Success Associate",
  link: "https://careers.acme.example.test/jobs/1",
  status: "live",
  step: "live",
  deadline: "2026-11-06",
  rounds: "Aptitude, then HR",
  documents: "Marksheets",
  criteria: [],
  rules: ["No active backlogs"],
  scam: { risk: "none", flags: [] },
  reach: { state: "ready", day: "2026-10-30", qualify: 60, couldntCheck: 30, hidden: false },
  publishedAt: "2026-10-29T05:00:00.000Z",
  announcedAt: "2026-10-29T05:00:00.000Z",
  ...over,
});

describe("reachLabel: the numbers, in words, with the k rule intact", () => {
  it("states qualify and couldn't-check when both are released", () => {
    expect(reachLabel({ state: "ready", day: "x", qualify: 60, couldntCheck: 30, hidden: false })).toBe("About 60 qualify. About 30 could not be checked yet.");
  });
  it("says a hidden figure is hidden, and never prints 0 or a guess for it", () => {
    const one = reachLabel({ state: "ready", day: "x", qualify: 60, couldntCheck: null, hidden: true });
    expect(one).toContain("About 60 qualify");
    expect(one).toMatch(/hidden/i);
    expect(one).not.toMatch(/\b0\b/);
    const none = reachLabel({ state: "ready", day: "x", qualify: null, couldntCheck: null, hidden: true });
    expect(none).toMatch(/hidden/i);
    expect(none).not.toMatch(/\d/);
  });
  it("says counting is still to come before the first nightly count", () => {
    expect(reachLabel({ state: "pending", day: null, qualify: null, couldntCheck: null, hidden: false })).toMatch(/not counted yet/i);
  });
});

describe("toDriveInbox", () => {
  it("shapes a live drive with its deadline, reach, rounds and documents", () => {
    const out = toDriveInbox({ campusName: "Acme College", cohorts, drives: [drive()], now: NOW });
    expect(out.college).toBe("Acme College");
    expect(out.counts).toEqual({ draft: 0, live: 1, closed: 0 });
    expect(out.drives[0]).toMatchObject({
      id: "d1",
      host: "careers.acme.example.test",
      cohort: "B.Com, batch of 2026",
      status: "live",
      deadlineLabel: "Fri 6 Nov",
      daysLeft: 6,
      closesTomorrow: false,
      rounds: "Aptitude, then HR",
      documents: "Marksheets",
      reach: { state: "ready", qualify: 60, couldntCheck: 30, hidden: false },
    });
  });

  it("marks the day before the deadline, and sorts drafts first, then live by soonest deadline, undated last, closed last", () => {
    const out = toDriveInbox({
      campusName: "C",
      cohorts,
      now: NOW,
      drives: [
        drive({ id: "closed", status: "closed", step: "closed", deadline: "2026-10-01" }),
        drive({ id: "undated", deadline: null }),
        drive({ id: "late", deadline: "2026-11-20" }),
        drive({ id: "tomorrow", deadline: "2026-11-01" }),
        drive({ id: "draft", status: "draft", step: "counting", announcedAt: null, reach: { state: "pending", day: null, qualify: null, couldntCheck: null, hidden: false } }),
      ],
    });
    expect(out.drives.map((d) => d.id)).toEqual(["draft", "tomorrow", "late", "undated", "closed"]);
    expect(out.drives.find((d) => d.id === "tomorrow")!.closesTomorrow).toBe(true);
    expect(out.counts).toEqual({ draft: 1, live: 3, closed: 1 });
  });

  it("tells staff where a draft is in parse, count, publish", () => {
    const counting = toDriveInbox({ campusName: "C", cohorts, now: NOW, drives: [drive({ status: "draft", step: "counting", reach: { state: "pending", day: null, qualify: null, couldntCheck: null, hidden: false } })] });
    expect(counting.drives[0]!.next).toBe("Waiting for the first count");
    const ready = toDriveInbox({ campusName: "C", cohorts, now: NOW, drives: [drive({ status: "draft", step: "ready_to_publish" })] });
    expect(ready.drives[0]!.next).toBe("Check the count, then publish");
    expect(toDriveInbox({ campusName: "C", cohorts, now: NOW, drives: [drive()] }).drives[0]!.next).toBeNull();
  });

  it("scam flags are carried for staff, with quotes", () => {
    const out = toDriveInbox({ campusName: "C", cohorts, now: NOW, drives: [drive({ scam: { risk: "high", flags: [{ id: "fee.upfront", severity: "high", quote: "pay Rs 2000", source: "text" }] } })] });
    expect(out.drives[0]!.scam).toEqual({ risk: "high", flags: [{ id: "fee.upfront", severity: "high", quote: "pay Rs 2000" }] });
  });

  it("handles no drives, an unknown cohort and a bad link", () => {
    expect(toDriveInbox({ campusName: "C", cohorts: [], now: NOW, drives: [] })).toMatchObject({ drives: [], counts: { draft: 0, live: 0, closed: 0 } });
    const out = toDriveInbox({ campusName: "C", cohorts, now: NOW, drives: [drive({ cohortId: "gone", link: "not a url" })] });
    expect(out.drives[0]).toMatchObject({ cohort: "A cohort that is no longer listed", host: null });
  });
});
