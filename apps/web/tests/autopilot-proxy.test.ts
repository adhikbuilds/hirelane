import { describe, expect, it } from "vitest";
import { ALL_ROLES, buildSnapshot, perWeekFrom, proxyScores, type ProxyJob } from "../lib/autopilot-proxy";

const job = (roleFamily: string | null, skills: string[]): ProxyJob => ({ roleFamily, skills });
const NOW = new Date("2026-10-16T00:00:00Z");

describe("proxyScores", () => {
  it("scores the share of a job's skills that are core to its role family", () => {
    // react and ts appear in every frontend job; "cobol" in 1 of 10 is exactly 10%, still core; "x" in 1 of 11 is not.
    const jobs: ProxyJob[] = [
      ...Array.from({ length: 9 }, () => job("fe", ["react", "ts"])),
      job("fe", ["react", "ts", "cobol", "obscure"]),
      job("fe", ["react"]),
    ];
    const s = proxyScores(jobs);
    expect(s[0]).toBe(100);
    // 11 jobs: cobol 1/11 = 9.1% < 10% so not core; obscure not core: 2 of 4.
    expect(s[9]).toBe(50);
  });

  it("is per family: a skill that is common elsewhere does not make it core here", () => {
    const jobs = [...Array.from({ length: 10 }, () => job("a", ["sql"])), job("b", ["sql", "figma"]), ...Array.from({ length: 11 }, () => job("b", ["figma"]))];
    const s = proxyScores(jobs);
    expect(s[10]).toBe(50); // sql is 1 of 12 in family b
    expect(s[11]).toBe(100);
  });

  it("scores jobs with no skills as 0, dedupes repeated skills, and tolerates a null role family", () => {
    const s = proxyScores([job(null, []), job(null, ["a", "a", "a"])]);
    expect(s).toEqual([0, 100]);
    expect(proxyScores([])).toEqual([]);
  });

  it("is deterministic and order-independent", () => {
    const jobs = [job("x", ["a", "b"]), job("x", ["a"]), job("x", ["c", "d", "e"]), job("y", ["a"])];
    const a = proxyScores(jobs);
    const b = proxyScores([...jobs].reverse()).reverse();
    expect(b).toEqual(a);
  });
});

describe("snapshot and perWeekFrom", () => {
  const jobs = [
    ...Array.from({ length: 8 }, () => job("fe", ["react"])),
    job("fe", ["react", "weird"]),
    job("fe", ["weird2", "weird3"]),
    job("be", ["go"]),
    job(null, ["go"]),
  ];
  const snap = buildSnapshot(jobs, NOW);

  it("records the as-of time and window size", () => {
    expect(snap.asOf).toBe("2026-10-16T00:00:00.000Z");
    expect(snap.jobsInWindow).toBe(12);
  });

  it("falls monotonically as min rises and is exact at min 0 (everything counts)", () => {
    let prev = Infinity;
    for (let m = 0; m <= 100; m += 5) {
      const n = snap.atLeast[ALL_ROLES]![m]!;
      expect(n).toBeLessThanOrEqual(prev);
      prev = n;
    }
    expect(snap.atLeast[ALL_ROLES]![0]).toBe(12);
    expect(perWeekFrom(snap, 0, null)).toBe(3); // 12 jobs / 4 weeks
  });

  it("filters by role and returns 0 for a role with no recent jobs", () => {
    expect(snap.atLeast["fe"]![0]).toBe(10);
    expect(perWeekFrom(snap, 0, "fe")).toBe(Math.round(10 / 4));
    expect(perWeekFrom(snap, 0, "legal")).toBe(0);
  });

  it("clamps out-of-range min instead of reading past the table", () => {
    expect(perWeekFrom(snap, 500, null)).toBe(perWeekFrom(snap, 100, null));
    expect(perWeekFrom(snap, -4, null)).toBe(perWeekFrom(snap, 0, null));
  });
});
