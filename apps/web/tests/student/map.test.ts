import { describe, expect, it } from "vitest";
import type { ApplicationSummary, InboundView, Picks, StudentDrive } from "@hirelane/services";
import type { PasteResult } from "@hirelane/services";
import { pasteView, pickToCard, picksToCards, toDriveViews, toFinishView, toHomeView, toNeedsRows, toReceipt, toTrackerView, verdictLine, initialsOf } from "@/lib/student/map";

const NOW = new Date("2026-10-31T04:30:00Z"); // 10:00 IST, Sat 31 Oct

type Pick = Picks["picks"][number];
const pick = (over: Partial<Pick> = {}): Pick => ({
  jobId: "00000000-0000-4000-8000-000000000001",
  slug: "csa-trellis",
  company: "Trellis Cloud",
  title: "Customer Support Associate",
  locations: ["Hyderabad"],
  remote: false,
  rank: 1,
  eligibility: "eligible",
  rules: [
    { text: "12th: 58%, needs 55%", status: "pass" },
    { text: "Graduation 73.5% is at least the 60% asked", status: "pass" },
  ],
  mustHaves: { matched: 4, total: 5, matchedSkills: ["excel"], missingSkills: ["sql"] },
  pay: { stated: true, text: "₹3.6 LPA" },
  whoYouKnow: null,
  posted: { at: "2026-10-31T02:30:00.000Z", ageDays: 0, label: "Posted today" },
  ...over,
});

describe("verdictLine", () => {
  it("says how many rules are met, out of how many", () => {
    expect(verdictLine("eligible", [{ status: "pass", text: "a" }, { status: "pass", text: "b" }])).toBe("You qualify: 2 of 2 rules");
  });
  it("names the ones we could not check and never calls them failures", () => {
    expect(verdictLine("check", [{ status: "pass", text: "a" }, { status: "unknown", text: "b" }])).toBe("You qualify: 1 of 2 rules. We couldn't check 1");
  });
  it("has an honest line when the posting states no rules", () => {
    expect(verdictLine("eligible", [])).toBe("The posting states no eligibility rules");
  });
  it("treats the ranker's synthetic 'states no academic rules' pass line as no rules, not '1 of 1'", () => {
    expect(verdictLine("eligible", [{ status: "pass", text: "The posting states no academic rules" }])).toBe("The posting states no eligibility rules");
    expect(pickToCard(pick({ rules: [{ status: "pass", text: "The posting states no academic rules" }], eligibility: "eligible" }), 0).verdict).toBe("The posting states no eligibility rules");
  });
  it("says to confirm the profile when nothing could be checked, instead of reading like a failure", () => {
    expect(verdictLine("check", [{ status: "unknown", text: "a" }, { status: "unknown", text: "b" }])).toBe("We couldn't check 2 rules yet. Confirm your profile");
  });
});

describe("pickToCard", () => {
  it("maps a pick onto the role card, with pay exactly as stated", () => {
    const c = pickToCard(pick(), 0);
    expect(c).toMatchObject({ company: "Trellis Cloud", initial: "T", role: "Customer Support Associate", tone: "lime", city: "Hyderabad", fresh: "Posted today", jobId: "00000000-0000-4000-8000-000000000001" });
    expect(c.pay).toEqual({ stated: true, headline: "₹3.6 LPA", monthly: null });
    expect(c.mustHaves).toEqual({ met: 4, total: 5 });
    expect(c.verdict).toBe("You qualify: 2 of 2 rules");
    expect(c.chips).toEqual(["Hyderabad"]);
  });
  it("never invents pay: unstated shows 'Pay not stated'", () => {
    const c = pickToCard(pick({ pay: { stated: false, text: "not stated" } }), 0);
    expect(c.pay).toEqual({ stated: false, headline: "Pay not stated", monthly: null });
  });
  it("remote roles say so; no locations falls back to remote or nothing", () => {
    expect(pickToCard(pick({ locations: [], remote: true }), 0).chips).toEqual(["Remote"]);
    expect(pickToCard(pick({ locations: [], remote: false }), 0).chips).toEqual([]);
    expect(pickToCard(pick({ locations: ["Pune"], remote: true }), 0).chips).toEqual(["Pune", "Remote"]);
  });
  it("shows who you know only when a source gave names", () => {
    expect(pickToCard(pick({ whoYouKnow: null }), 0).who).toBeNull();
    expect(pickToCard(pick({ whoYouKnow: [] }), 0).who).toBeNull();
    expect(pickToCard(pick({ whoYouKnow: ["Aman K."] }), 0).who).toEqual({ initials: "AK", text: "Aman K. works here" });
  });
  it("unknown rules stay unknown", () => {
    const c = pickToCard(pick({ eligibility: "check", rules: [{ text: "Needs 60% in every semester", status: "unknown" }] }), 0);
    expect(c.rules).toEqual([{ status: "unknown", text: "Needs 60% in every semester" }]);
  });
  it("carries no score or percentage field", () => {
    expect(Object.keys(pickToCard(pick(), 0)).join(" ")).not.toMatch(/score|percent|match%/i);
  });
});

describe("picksToCards", () => {
  it("keeps rank order and cycles the four fills", () => {
    const cards = picksToCards({ placed: false, date: "2026-10-31", picks: [1, 2, 3, 4, 5].map((n) => pick({ jobId: `00000000-0000-4000-8000-00000000000${n}`, rank: n })) });
    expect(cards.map((c) => c.tone)).toEqual(["lime", "sun", "blue", "pink", "lime"]);
  });
  it("a placed student, or no picks, gets no cards", () => {
    expect(picksToCards({ placed: true, date: "2026-10-31", picks: [] })).toEqual([]);
    expect(picksToCards({ placed: false, date: "2026-10-31", picks: [] })).toEqual([]);
  });
  it("initialsOf handles one word, two words and empty", () => {
    expect(initialsOf("Aman")).toBe("A");
    expect(initialsOf("Aman K.")).toBe("AK");
    expect(initialsOf("  ")).toBe("?");
  });
});

const app = (over: Partial<ApplicationSummary> = {}): ApplicationSummary => ({
  id: "a1", status: "submitted", company: "Kosha Payments", title: "Operations Analyst", platform: "greenhouse",
  undoUntil: "2026-10-24T05:12:04.000Z", canUndo: false, blockedReason: null, fallback: null, needsYouCount: 0, lastReply: null,
  createdAt: "2026-10-24T05:12:00.000Z", submittedAt: "2026-10-24T05:12:30.000Z", ...over,
});

describe("toNeedsRows", () => {
  it("lists applications that stopped on a site that wants the student", () => {
    const rows = toNeedsRows([
      app({ id: "b", company: "Brightdesk", title: "Customer Success Associate", status: "blocked_fallback", submittedAt: null, fallback: { message: "Finish on their site", url: "https://careers.brightdesk.test/x" } }),
      app({ id: "c" }),
    ]);
    expect(rows).toEqual([{ id: "b", company: "Brightdesk", role: "Customer Success Associate", reason: "It asked for a sign-in.", url: "https://careers.brightdesk.test/x", needsAnswers: 0 }]);
  });
  it("a blocked application waiting on a question says so and can be re-armed", () => {
    const rows = toNeedsRows([app({ id: "d", status: "blocked_fallback", blockedReason: "needs_you", needsYouCount: 2, submittedAt: null, fallback: null })]);
    expect(rows[0]).toMatchObject({ id: "d", needsAnswers: 2, reason: "2 answers need you." });
  });
  it("ignores undone and failed-free applications", () => {
    expect(toNeedsRows([app({ status: "undone" }), app({ status: "ready" })])).toEqual([]);
  });
});

const msg = (over: Partial<InboundView> = {}): InboundView => ({ id: "m1", applicationId: "a1", employer: "Kosha Payments", kind: "other", matchedBy: "address", subject: "Operations Analyst: next step", excerpt: "Share your availability.", receivedAt: "2026-10-31T03:42:00.000Z", ...over });

describe("toTrackerView", () => {
  it("groups by stage and every stage keeps an action or a way forward", () => {
    const v = toTrackerView(
      [
        app({ id: "n", company: "Brightdesk", status: "blocked_fallback", submittedAt: null, fallback: { message: "Finish on their site", url: "https://x.test/a" } }),
        app({ id: "r", lastReply: "other" }),
        app({ id: "i", company: "Saarthi Health", lastReply: "interview" }),
        app({ id: "p", company: "Lotus Hotels", submittedAt: "2026-10-29T05:00:00.000Z" }),
        app({ id: "q", company: "Pathway Freight", submittedAt: "2026-10-23T05:00:00.000Z" }),
        app({ id: "x", status: "undone" }),
      ],
      [msg({ applicationId: "r" }), msg({ id: "m2", applicationId: null, employer: "recruit.hr2026@gmail.com", subject: "Job offer" })],
      NOW,
    );
    expect(v.groups.map((g) => [g.id, g.rows.map((r) => r.id)])).toEqual([
      ["needs", ["n"]],
      ["replies", ["r"]],
      ["interview", ["i"]],
      ["applied", ["p", "q"]],
      ["offer", []],
    ]);
    expect(v.unmatched.map((m) => m.id)).toEqual(["m2"]);
    expect(v.badge).toBe(1);
    const quiet = v.groups.find((g) => g.id === "applied")!.rows.find((r) => r.id === "q")!;
    expect(quiet.quiet).toBe("Quiet 8 days");
    expect(v.groups.find((g) => g.id === "offer")!.empty).toMatch(/Offers you record show here/);
  });
  it("offers the student recorded fill the Offer stage, verified ones say so", () => {
    const v = toTrackerView([], [], NOW, [
      { id: "o1", kind: "offer", employer: "Saarthi Health", roleTitle: "Patient Support Executive", verification: "tpo_verified", createdAt: "2026-10-28T05:00:00.000Z" },
      { id: "o2", kind: "interview", employer: "Lotus Hotels", roleTitle: null, verification: "student_reported", createdAt: "2026-10-28T05:00:00.000Z" },
    ]);
    const offer = v.groups.find((g) => g.id === "offer")!;
    expect(offer.rows.map((r) => [r.id, r.company, r.pill, r.meta])).toEqual([["o1", "Saarthi Health", "Offer", "Patient Support Executive, verified by your placement cell"]]);
  });
  it("is empty and calm with nothing in it", () => {
    const v = toTrackerView([], [], NOW);
    expect(v.groups.every((g) => g.rows.length === 0)).toBe(true);
    expect(v.badge).toBe(0);
    expect(v.unmatched).toEqual([]);
  });
});

const drive = (over: Partial<StudentDrive> = {}): StudentDrive => ({
  id: "d1", title: "Process Associate, Anvaya Retail", link: null, noticeText: "Apply by 1 Nov", deadline: "2026-11-01", rounds: "Online assessment, 8 Nov", documents: "Resume, college ID",
  publishedAt: "2026-10-27T05:00:00.000Z", verdict: "eligible", reasons: ["10th: 71%, needs 55%", "12th: 58%, needs 55%"], ...over,
});

describe("toDriveViews rule status", () => {
  it("keeps each rule's own status: a rule the student passed is not shown as unchecked", () => {
    const v = toDriveViews([drive({ verdict: "unknown", deadline: "2026-11-05", reasons: ["Your degree BCOM is on the list", "Needs 60% in every semester"], rules: [{ text: "Your degree BCOM is on the list", status: "pass" }, { text: "Needs 60% in every semester", status: "unknown" }] })], NOW);
    expect(v.check[0]!.rules.map((r) => r.status)).toEqual(["pass", "unknown"]);
  });
});

describe("toDriveViews", () => {
  it("sorts open drives by deadline and puts the ones we could not check apart", () => {
    const v = toDriveViews(
      [
        drive({ id: "late", deadline: "2026-11-06", title: "Customer Success Associate, Brightdesk" }),
        drive({ id: "soon" }),
        drive({ id: "unk", deadline: "2026-11-05", verdict: "unknown", reasons: ["Needs 60% in every semester"] }),
        drive({ id: "old", deadline: "2026-10-20", title: "Data Entry Operator, Pathway Freight" }),
      ],
      NOW,
    );
    expect(v.open.map((d) => d.id)).toEqual(["soon", "late"]);
    expect(v.check.map((d) => d.id)).toEqual(["unk"]);
    expect(v.closed.map((d) => d.id)).toEqual(["old"]);
    expect(v.open[0]).toMatchObject({ verdict: "You meet all 2 rules", closes: "Closes Sun 1 Nov", role: "Process Associate", company: "Anvaya Retail" });
    expect(v.closed[0]!.closes).toBe("Ended 20 Oct");
    expect(v.check[0]!.verdict).toBe("We couldn't check every rule");
  });
  it("splits 'Role, Company' only on the last comma, otherwise keeps the title whole", () => {
    expect(toDriveViews([drive({ title: "Process Associate" })], NOW).open[0]).toMatchObject({ role: "Process Associate", company: null });
  });
  it("empty in, empty out", () => {
    expect(toDriveViews([], NOW)).toEqual({ open: [], check: [], closed: [] });
  });
});

const paste = (over: Partial<PasteResult> = {}): PasteResult => ({
  job: { title: "Claims Associate", company: "Neelgiri Insurance Brokers", locations: ["Indore"], workplace: null, level: null, fresher: { fresher: true, reason: "2026 passouts" }, pay: { stated: false, text: "not stated" }, applyUrl: null, source: "whatsapp" },
  eligibility: { overall: "not_eligible", rules: [{ text: "12th: 58%, needs 60%", status: "fail" }, { text: "10th: 71%, needs 55%", status: "pass" }] },
  fit: { verdict: "worthwhile", mustHaves: { matched: 2, total: 3, matchedSkills: [], missingSkills: [] }, conditions: [], locationFit: true },
  scam: { risk: "none", flagged: false, signals: [] },
  ...over,
});

describe("pasteView", () => {
  it("headlines the rules we could and could not meet, fails first", () => {
    const v = pasteView(paste());
    expect(v.headline).toBe("You don't meet 1 of 2 rules");
    expect(v.rules.map((r) => r.status)).toEqual(["fail", "pass"]);
    expect(v.scam).toBeNull();
  });
  it("says when every rule is met, and when none could be read", () => {
    expect(pasteView(paste({ eligibility: { overall: "eligible", rules: [{ text: "a", status: "pass" }] } })).headline).toBe("You meet all 1 rule");
    const none = pasteView(paste({ eligibility: { overall: "eligible", rules: [{ text: "The paste states no academic rules", status: "pass" }] } }));
    expect(none.headline).toBe("No eligibility rules in this post");
    expect(none.rules).toEqual([]);
    expect(pasteView(paste({ eligibility: { overall: "check", rules: [] } })).headline).toBe("We couldn't read any rules in this post");
  });
  it("raises a scam warning in plain words, with the quote", () => {
    const v = pasteView(paste({ scam: { risk: "high", flagged: true, signals: [{ id: "fee", severity: "high", quote: "pay ₹1,500 registration" }] } }));
    expect(v.scam).toEqual({ title: "This looks like a scam", quotes: ["pay ₹1,500 registration"] });
  });
});

describe("toFinishView and toReceipt", () => {
  const blocked = app({ id: "b", company: "Brightdesk", title: "Customer Success Associate", status: "blocked_fallback", submittedAt: null, fallback: { message: "Finish on their site", url: "https://careers.brightdesk.test/csa" } });
  it("carries the company's own form, its host and every answer with a way to copy it", () => {
    const f = toFinishView(blocked, [{ fieldId: "f1", questionKey: "full_name", label: "Full name", needsYou: false, answer: "Rahul Verma", suggestion: null }]);
    expect(f).toMatchObject({ id: "b", url: "https://careers.brightdesk.test/csa", host: "careers.brightdesk.test", needsAnswers: 0 });
    expect(f.reason).toMatch(/Nothing was sent/);
    expect(f.answers).toEqual([{ key: "full_name", answerable: true, label: "Full name", value: "Rahul Verma", needsYou: false, suggestion: null }]);
  });
  it("counts the questions only the student can answer, and an answer without a key cannot be saved here", () => {
    const f = toFinishView(blocked, [
      { fieldId: "f2", questionKey: null, label: "Why this role?", needsYou: true, answer: null, suggestion: "A draft" },
      { fieldId: "f3", questionKey: "shifts", label: "Rotational shifts?", needsYou: true, answer: null, suggestion: null },
    ]);
    expect(f.needsAnswers).toBe(2);
    expect(f.answers.map((a) => a.answerable)).toEqual([false, true]);
    expect(f.reason).toMatch(/only you can give/);
  });
  it("a missing or non-https form gives no link", () => {
    expect(toFinishView(app({ status: "blocked_fallback", fallback: null }), []).url).toBeNull();
  });
  it("a receipt shows when, from which address, the version and a short hash, and says whether their form accepted it", () => {
    const r = toReceipt({ at: "2026-10-24T05:12:30.000Z", platform: "greenhouse", resultCode: "ok", sent: true, answersHash: "a91f03c2deadbeef", resumeVersion: 2 }, 7, "rahul.k3x@apply.hirelane.in", "https://jobs.koshapay.test/x");
    expect(r).toEqual({ applied: "24 Oct, 10:42", where: "jobs.koshapay.test", from: "rahul.k3x@apply.hirelane.in", resume: "Version 2", answers: "7 sent, hash a91f 03c2", result: "Accepted by their form" });
    expect(toReceipt({ at: "2026-10-24T05:12:30.000Z", platform: "greenhouse", resultCode: "x", sent: false, answersHash: "00000000", resumeVersion: null }, 0, null, null)).toMatchObject({ resume: null, from: null, where: null, result: "Not sent" });
  });
});

describe("toHomeView", () => {
  const base = { me: { displayName: "Rahul Verma" }, picks: { placed: false, date: "2026-10-31", picks: [pick(), pick({ jobId: "00000000-0000-4000-8000-000000000002", posted: { at: "2026-10-20T00:00:00.000Z", ageDays: 11, label: "Posted 11 days ago" } })] }, apps: [] as ApplicationSummary[], inbox: [] as InboundView[], drives: [] as StudentDrive[], resumes: [], settings: { autoApply: true, applyAddress: "rahul.k3x@apply.hirelane.in" }, now: NOW };
  it("counts only roles posted since yesterday as new", () => {
    const h = toHomeView(base);
    expect(h).toMatchObject({ firstName: "Rahul", initial: "R", sample: false, newCount: 1, autoApply: true, pilot: true });
    expect(h.cards).toHaveLength(2);
  });
  it("before the pilot, consent alone does not make the deck say applied", () => {
    expect(toHomeView({ ...base, pilot: false })).toMatchObject({ autoApply: false, pilot: false });
  });
  it("a placed student has no picks and nothing new", () => {
    expect(toHomeView({ ...base, picks: { placed: true, date: "2026-10-31", picks: [] } })).toMatchObject({ cards: [], newCount: 0 });
  });
  it("puts what is waiting on the student first, and names the latest reply", () => {
    const h = toHomeView({
      ...base,
      apps: [app({ id: "n", company: "Brightdesk", status: "blocked_fallback", submittedAt: null, fallback: { message: "Finish on their site", url: "https://x.test/a" } }), app({ id: "r", company: "Kosha Payments", title: "Operations Analyst", submittedAt: "2026-10-29T05:00:00.000Z", lastReply: "other" })],
      inbox: [msg({ applicationId: "r", receivedAt: "2026-10-31T03:42:00.000Z" })],
    });
    expect(h.finish.map((f) => f.id)).toEqual(["n"]);
    expect(h.badge).toBe(1);
    expect(h.week).toEqual({ applied: 1, replies: 1, replyLine: "Kosha Payments replied about Operations Analyst" });
  });
  it("drives: the two nearest, and the marks row names the semester when a rule needs it", () => {
    const h = toHomeView({
      ...base,
      drives: [
        drive({ id: "a", deadline: "2026-11-06", title: "Customer Success Associate, Brightdesk" }),
        drive({ id: "b", deadline: "2026-11-01" }),
        drive({ id: "c", deadline: "2026-11-05", verdict: "unknown", reasons: ["Needs 60% in every semester"], title: "Relationship Officer, Suvidha Bank" }),
      ],
    });
    expect(h.drives.map((d) => d.id)).toEqual(["b", "c"]);
    expect(h.marks).toEqual({ moreDrives: 1, label: "Add your semester marks" });
  });
  it("resume health is the default resume's own count, with nothing to fix said plainly", () => {
    const r = (passed: number) => ({ id: "r", isDefault: true, healthPassed: passed, healthTotal: 9 }) as never;
    expect(toHomeView({ ...base, resumes: [r(6)] }).resume).toEqual({ passed: 6, total: 9, topFix: "3 checks still to fix." });
    expect(toHomeView({ ...base, resumes: [r(9)] }).resume).toEqual({ passed: 9, total: 9, topFix: null });
    expect(toHomeView(base).resume).toBeNull();
  });
});
