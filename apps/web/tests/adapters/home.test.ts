import { describe, expect, it } from "vitest";
import type { ApplicationSummary, InboundView, Membership, ResumeSummary, StudentDrive } from "@hirelane/services";
import { firstNameOf, homeIsEmpty, toHomeData, type HomeInput } from "@/lib/adapters/home";

const NOW = new Date("2026-10-29T04:00:00Z");
const me = { id: "u", email: "s@example.test", displayName: "Rahul Sample", role: "student", createdAt: "2026-10-01T00:00:00.000Z" };
const resume = (o: Partial<ResumeSummary> = {}): ResumeSummary => ({
  id: "r1", parentId: null, label: null, source: "upload", mime: "application/pdf", sizeBytes: 1, pages: 1, textLayer: "text", parseStatus: "confirmed", rejectCode: null, parsedVersion: 1,
  healthPassed: 6, healthTotal: 9, sensitiveKinds: [], skills: [], confirmedAt: null, isDefault: true, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", ...o,
});
const drive = (o: Partial<StudentDrive> = {}): StudentDrive => ({
  id: "d1", title: "Process Associate", link: null, noticeText: "Apply by 31 Oct", scamRisk: "none", scamFlags: [], publishedAt: "2026-10-29T01:10:00.000Z", verdict: "eligible", reasons: ["a", "b"], ...o,
});
const app = (o: Partial<ApplicationSummary> = {}): ApplicationSummary => ({
  id: "a1", status: "submitted", company: "Zenoti", title: "T", platform: "lever", undoUntil: "2026-10-28T00:00:00.000Z", canUndo: false, blockedReason: null, fallback: null, needsYouCount: 0, lastReply: null,
  createdAt: "2026-10-27T00:00:00.000Z", submittedAt: "2026-10-27T00:01:00.000Z", ...o,
});
const msg = (o: Partial<InboundView> = {}): InboundView => ({ id: "m1", applicationId: "a1", employer: "Zenoti", kind: "interview", matchedBy: "company", subject: "s", excerpt: "e", receivedAt: "2026-10-29T01:00:00.000Z", ...o });
const membership: Membership = { campus: { id: "c", name: "Sample University, Indore", cgpaRule: null }, cohort: { id: "h", passoutYear: 2026, programme: "B.Com" }, shareLevel: "aggregate", verifiedVia: "code", verified: true, placed: false, joinedAt: "2026-10-02T00:00:00.000Z" };
const empty: HomeInput = { me, membership: null, resumes: [], drives: [], applications: [], inbox: [], now: NOW };

describe("toHomeData", () => {
  it("a brand-new student gets honest zeros and a non-empty name", () => {
    const h = toHomeData(empty);
    expect(h).toMatchObject({ sample: false, firstName: "Rahul", college: null, dateLabel: "Thu 29 Oct", resume: null, drives: [], warm: null });
    expect(h.week).toEqual({ handedOff: 0, replies: 0, answersFilled: 0, recapReady: false });
    expect(h.picks.total).toBe(0);
    expect(h.qualify).toEqual({ count: 0, blockedBy: null });
    expect(homeIsEmpty(empty)).toBe(true);
  });
  it("never sends HomeA a resume with total 0 (it divides by it)", () => {
    expect(toHomeData({ ...empty, resumes: [resume({ healthTotal: 0, healthPassed: 0 })] }).resume).toBeNull();
  });
  it("reads the default resume's health and says how many checks remain", () => {
    expect(toHomeData({ ...empty, resumes: [resume({ isDefault: false, healthPassed: 1 }), resume({ id: "r2" })] }).resume).toEqual({ passed: 6, total: 9, topFix: "3 checks still to fix." });
    expect(toHomeData({ ...empty, resumes: [resume({ healthPassed: 9 })] }).resume?.topFix).toBeNull();
  });
  it("shows the college, drives, the week and the feed from real rows", () => {
    const h = toHomeData({ ...empty, membership, drives: [drive(), drive({ id: "d2", verdict: "unknown", noticeText: "by 3 Nov" })], applications: [app(), app({ id: "a2", submittedAt: "2026-10-01T00:00:00.000Z" }), app({ id: "a3", status: "ready", submittedAt: null })], inbox: [msg()] });
    expect(h.college).toBe("Sample University, Indore");
    expect(h.drives.map((d) => [d.id, d.status, d.daysLeft])).toEqual([["d1", "eligible", 2], ["d2", "check", 5]]);
    expect(h.week).toMatchObject({ handedOff: 1, replies: 1 });
    expect(h.qualify.count).toBe(1);
    expect(h.feed.map((f) => [f.tag, f.at])).toEqual([["drive", "06:40"], ["drive", "06:40"], ["reply", "06:30"]]);
    expect(homeIsEmpty({ ...empty, membership })).toBe(false);
  });
  it("caps the feed and the home drives list", () => {
    const h = toHomeData({ ...empty, drives: Array.from({ length: 9 }, (_, i) => drive({ id: `d${i}` })), inbox: Array.from({ length: 9 }, (_, i) => msg({ id: `m${i}` })) });
    expect(h.drives).toHaveLength(3);
    expect(h.feed).toHaveLength(5);
  });
  it("falls back to 'there' for a missing or blank name", () => {
    expect(firstNameOf({ displayName: null })).toBe("there");
    expect(firstNameOf({ displayName: "   " })).toBe("there");
    expect(firstNameOf({ displayName: "  Priya  Sharma" })).toBe("Priya");
  });
});
