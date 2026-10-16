import { describe, expect, it } from "vitest";
import { announce, endLine, initialQueue, isDone, reduceQueue, tally, type QueueAction, type QueueState } from "../components/landing-v3/stack/queue";
import { buildStackCards, needsFor, safeHttpUrl } from "../components/landing-v3/stack/cards";
import type { DemoJob } from "../components/landing/types";

const slugs = ["a", "b", "c"];
const run = (s: QueueState, ...as: QueueAction[]) => as.reduce((st, a) => reduceQueue(st, a, slugs), s);
const approve = (needsAnswer = false): QueueAction => ({ type: "decide", kind: "approve", needsAnswer });
const pass: QueueAction = { type: "decide", kind: "pass", needsAnswer: false };

describe("queue reducer", () => {
  it("advances and opens an undo window on approve and on pass", () => {
    const a = run(initialQueue(3), approve());
    expect(a.index).toBe(1);
    expect(a.undoable).toMatchObject({ slug: "a", kind: "approve" });
    const p = run(a, pass);
    expect(p.index).toBe(2);
    expect(p.undoable).toMatchObject({ slug: "b", kind: "pass" });
    expect(tally(p)).toEqual({ decided: 2, approved: 1, passed: 1 });
  });

  it("refuses an approve while the Needs-you field is empty, and bumps the gate nonce each time", () => {
    const g1 = run(initialQueue(3), approve(true));
    expect(g1.index).toBe(0);
    expect(g1.undoable).toBeNull();
    expect(g1.gate).toEqual({ slug: "a", nonce: 1 });
    expect(run(g1, approve(true)).gate?.nonce).toBe(2);
  });

  it("lets pass through the gate, and approve once the field is answered", () => {
    expect(run(initialQueue(3), pass).index).toBe(1);
    const ok = run(initialQueue(3), { type: "answer", slug: "a", value: "30 days" }, approve(true));
    expect(ok.index).toBe(1);
    expect(ok.gate).toBeNull();
  });

  it("clears the gate when its field is answered", () => {
    const s = run(initialQueue(3), approve(true), { type: "answer", slug: "a", value: "Immediately" });
    expect(s.gate).toBeNull();
  });

  it("undo puts the same card back on top and removes the decision from the tally", () => {
    const s = run(initialQueue(3), approve(), { type: "undo" });
    expect(s.index).toBe(0);
    expect(s.undoable).toBeNull();
    expect(tally(s).decided).toBe(0);
    expect(s.lastExit).toBe("approve");
  });

  it("undo does nothing once the window has expired", () => {
    const a = run(initialQueue(3), approve());
    const id = a.undoable!.id;
    const s = run(a, { type: "expire", id }, { type: "undo" });
    expect(s.index).toBe(1);
    expect(tally(s).approved).toBe(1);
  });

  it("an old expiry never closes the window of a newer decision", () => {
    const a = run(initialQueue(3), approve());
    const oldId = a.undoable!.id;
    const b = run(a, pass, { type: "expire", id: oldId });
    expect(b.undoable?.kind).toBe("pass");
  });

  it("ends the queue with real tallies and restarts clean", () => {
    const s = run(initialQueue(3), approve(), pass, approve());
    expect(isDone(s)).toBe(true);
    expect(endLine(s)).toBe("That's today's queue. 3 decided: 2 approved, 1 passed.");
    expect(run(s, { type: "decide", kind: "pass", needsAnswer: false })).toBe(s);
    const r = run(s, { type: "restart" });
    expect(r).toEqual(initialQueue(3));
  });

  it("the end line reflects an undo", () => {
    const s = run(initialQueue(3), approve(), pass, approve(), { type: "undo" });
    expect(isDone(s)).toBe(false);
    expect(tally(s)).toEqual({ decided: 2, approved: 1, passed: 1 });
  });

  it("announces approve and pass for the live region", () => {
    expect(announce("approve", "Senior Data Engineer", "Razorpay")).toBe("Approved Senior Data Engineer at Razorpay. Sending in 4 seconds. Press U to undo.");
    expect(announce("pass", "X", "Y")).toMatch(/^Passed X at Y/);
  });
});

const job = (n: number, over: Partial<DemoJob> = {}): DemoJob => ({
  slug: `job-${n}`, title: `Engineer ${n}`, company: `Co ${n}`, logoPath: null, where: "Remote", payAnnual: "$100K–$120K/yr",
  payStated: null, payMaxUsdMinor: 12_000_000, skills: ["Python", "SQL", "Kafka", "dbt", "AWS", "Go"], ...over,
});

describe("card models", () => {
  it("builds one card per job with real match maths and the extras", () => {
    const now = new Date("2026-10-16T12:00:00Z");
    const [c] = buildStackCards([job(1)], { "job-1": { freshAt: "2026-10-16T09:00:00Z", openRoles: 14, postingUrl: "https://boards.example.com/x" } }, now);
    expect(c!.posted).toBe("3h ago");
    expect(c!.openRoles).toBe(14);
    expect(c!.postingUrl).toBe("https://boards.example.com/x");
    expect(c!.match.total).toBe(6);
    expect(c!.payTrace).toEqual({ stated: "$100K–$120K/yr", normalised: "$100K–$120K/yr", converted: false });
  });
  it("keeps a missing extra null rather than inventing it", () => {
    const [c] = buildStackCards([job(2)], {}, new Date());
    expect(c).toMatchObject({ posted: null, openRoles: null, postingUrl: null });
  });
  it("has no pay trace when the pay is not stated", () => {
    expect(buildStackCards([job(3, { payAnnual: "Not stated", payMaxUsdMinor: null })], {}, new Date())[0]!.payTrace).toBeNull();
  });
  it("only lets http(s) links through", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl("http://a.test/x")).toBe("http://a.test/x");
  });
  it("is deterministic and leaves some cards without a Needs-you field", () => {
    expect(needsFor("same")).toEqual(needsFor("same"));
    const kinds = Array.from({ length: 60 }, (_, i) => needsFor(`slug-${i}`));
    expect(kinds.some((k) => k === null)).toBe(true);
    expect(kinds.some((k) => k !== null)).toBe(true);
  });
});
