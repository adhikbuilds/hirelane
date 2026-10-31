import { describe, expect, it } from "vitest";
import type { StudentDrive } from "@hirelane/services";
import { parseDeadline, toDriveItems, UNDATED_WINDOW_DAYS } from "@/lib/adapters/drives";

const NOW = new Date("2026-10-29T04:00:00Z"); // 29 Oct, 09:30 IST

const drive = (over: Partial<StudentDrive> = {}): StudentDrive => ({
  id: "11111111-1111-4111-8111-111111111111",
  title: "Process Associate",
  link: null,
  noticeText: "Eligibility: 55% throughout. Apply by 31 Oct.",
  scamRisk: "none",
  scamFlags: [],
  publishedAt: "2026-10-27T05:00:00.000Z",
  verdict: "eligible",
  reasons: ["10th: 71% meets 55%", "12th: 58% meets 55%"],
  ...over,
});

describe("parseDeadline", () => {
  it.each([
    ["Apply by 6 Nov.", "2026-11-06"],
    ["Last date to apply is 31st October 2026", "2026-10-31"],
    ["Deadline: 3 nov", "2026-11-03"],
    ["closes on 2 Dec 2026, 5pm", "2026-12-02"],
    ["Apply before 5th Jan", "2027-01-05"],
  ])("%s", (text, want) => expect(parseDeadline(text, NOW)).toBe(want));
  it("reads nothing from a notice with no stated date", () => {
    expect(parseDeadline("Interview on 2 Nov. CTC 3.6 LPA", NOW)).toBeNull();
    expect(parseDeadline("", NOW)).toBeNull();
    expect(parseDeadline("by 31 Feb", NOW)).toBeNull();
  });
});

describe("toDriveItems", () => {
  it("maps an eligible drive with its real reasons and a counted-down deadline", () => {
    const [d] = toDriveItems([drive()], NOW);
    expect(d).toMatchObject({ id: "11111111-1111-4111-8111-111111111111", role: "Process Associate", ctc: null, status: "eligible", daysLeft: 2, deadlineLabel: "Sat 31 Oct", headline: "You meet all 2 rules" });
    expect(d!.rules).toEqual([
      { text: "10th: 71% meets 55%", status: "pass" },
      { text: "12th: 58% meets 55%", status: "pass" },
    ]);
  });
  it("an unknown verdict is 'check' and never marks a rule as met", () => {
    const [d] = toDriveItems([drive({ verdict: "unknown", reasons: ["CGPA needs your college's rule"] })], NOW);
    expect(d!.status).toBe("check");
    expect(d!.rules.every((r) => r.status === "unknown")).toBe(true);
    expect(d!.headline).toBe("We couldn't check every rule");
  });
  it("a high scam risk becomes the scam card", () => {
    expect(toDriveItems([drive({ scamRisk: "high" })], NOW)[0]!.status).toBe("scam");
    expect(toDriveItems([drive({ scamRisk: "medium" })], NOW)[0]!.status).toBe("eligible");
  });
  it("drops a drive whose notice closed before today, keeps one closing today", () => {
    expect(toDriveItems([drive({ noticeText: "Apply by 28 Oct" })], NOW)).toEqual([]);
    expect(toDriveItems([drive({ noticeText: "Apply by 29 Oct" })], NOW)[0]!.daysLeft).toBe(0);
  });
  it("without a stated date it counts from publication, says so, and expires after the window", () => {
    const [d] = toDriveItems([drive({ noticeText: "55% throughout" })], NOW);
    expect(d!.daysLeft).toBe(UNDATED_WINDOW_DAYS - 2);
    expect(d!.deadlineLabel).toBe("No date in the notice");
    expect(d!.headline).toContain("no closing date");
    expect(toDriveItems([drive({ noticeText: "x", publishedAt: "2026-08-01T00:00:00.000Z" })], NOW)).toEqual([]);
  });
  it("handles zero rules, zero drives and sorts the soonest first", () => {
    expect(toDriveItems([], NOW)).toEqual([]);
    expect(toDriveItems([drive({ reasons: [] })], NOW)[0]!.headline).toBe("The notice states no rules we could read");
    const out = toDriveItems([drive({ id: "a", noticeText: "by 6 Nov" }), drive({ id: "b", noticeText: "by 30 Oct" })], NOW);
    expect(out.map((x) => x.id)).toEqual(["b", "a"]);
  });
});
