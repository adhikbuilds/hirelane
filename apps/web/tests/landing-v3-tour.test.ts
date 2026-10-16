import { describe, expect, it } from "vitest";
import { ANSWER_AT, HANDOFF_AT, TOUR_STAGES, frameAt, litWindow, tourAt } from "../components/landing-v3/tour/stages";

describe("tour stages", () => {
  it("has four headings of six words or fewer, exactly as specified", () => {
    expect(TOUR_STAGES.map((s) => s.heading)).toEqual([
      "Every match shows its maths.",
      "Pay, read from the posting.",
      "It asks. It never guesses.",
      "4 seconds to change your mind.",
    ]);
    for (const s of TOUR_STAGES) expect(s.heading.split(/\s+/).length).toBeLessThanOrEqual(6);
  });
  it("maps scroll progress onto a stage and the progress inside it", () => {
    expect(tourAt(0)).toEqual({ stage: 0, local: 0, started: false });
    expect(tourAt(0.3).stage).toBe(1);
    expect(tourAt(0.3).local).toBeCloseTo(0.2);
    expect(tourAt(0.99).stage).toBe(3);
    expect(tourAt(1)).toMatchObject({ stage: 3, local: 1 });
  });
  it("clamps bad input", () => {
    expect(tourAt(-4).stage).toBe(0);
    expect(tourAt(9).stage).toBe(3);
    expect(tourAt(Number.NaN)).toEqual({ stage: 0, local: 0, started: false });
  });
  it("answers the Needs-you field mid stage three and keeps it answered", () => {
    expect(frameAt(2, ANSWER_AT - 0.01).answered).toBe(false);
    expect(frameAt(2, ANSWER_AT).answered).toBe(true);
    expect(frameAt(3, 0).answered).toBe(true);
    expect(frameAt(0, 1).answered).toBe(false);
  });
  it("drains the undo bar from 4 seconds to zero, then hands off", () => {
    expect(frameAt(3, 0)).toMatchObject({ secondsLeft: 4, handed: false });
    expect(frameAt(3, HANDOFF_AT / 2).secondsLeft).toBeCloseTo(2, 0);
    expect(frameAt(3, HANDOFF_AT)).toMatchObject({ secondsLeft: 0, handed: true });
    expect(frameAt(1, 1).handed).toBe(false);
  });

  it("lights the real pay words from a verified trace span, with context either side", () => {
    const excerpt = "We are hiring. The base salary range is $120,000 to $150,000 per year, plus equity and benefits for everyone.";
    const start = excerpt.indexOf("$120,000");
    const w = litWindow({ excerpt, company: "Acme", title: "Engineer", steps: [{ span: null }, { span: { start, end: start + 20 } }] });
    expect(w).not.toBeNull();
    expect(w!.lit).toBe("$120,000 to $150,000");
    expect(w!.before.endsWith("salary range is ")).toBe(true);
    expect(w!.after.startsWith(" per year")).toBe(true);
    expect(w!.source).toBe("Acme, Engineer");
    expect(`${w!.before}${w!.lit}${w!.after}`.replace(/\u2026/g, "")).toContain("$120,000 to $150,000 per year");
  });
  it("shows nothing rather than guess when no step points at text", () => {
    expect(litWindow(null)).toBeNull();
    expect(litWindow({ excerpt: "abc", company: "A", title: "B", steps: [{ span: null }] })).toBeNull();
    expect(litWindow({ excerpt: "abc", company: "A", title: "B", steps: [{ span: { start: 2, end: 99 } }] })).toBeNull();
  });
});
