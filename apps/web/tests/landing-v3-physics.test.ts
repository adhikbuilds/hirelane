import { describe, expect, it } from "vitest";
import {
  COMMIT_RATIO,
  COMMIT_VELOCITY,
  MAX_ROTATE,
  dragProgress,
  flyOutVector,
  isMostlyVertical,
  restingPose,
  rotationFor,
  shadowFor,
  shouldCommit,
  stampOpacity,
  stampScale,
  tintOpacity,
} from "../components/landing-v3/stack/physics";

const W = 400;
const T = W * COMMIT_RATIO; // 140

describe("dragProgress", () => {
  it("is 0 at rest, 1 at the threshold and clamped beyond", () => {
    expect(dragProgress(0, W)).toBe(0);
    expect(dragProgress(T / 2, W)).toBeCloseTo(0.5);
    expect(dragProgress(T, W)).toBe(1);
    expect(dragProgress(-T * 3, W)).toBe(1);
  });
  it("survives a zero or invalid width", () => {
    expect(dragProgress(50, 0)).toBe(0);
    expect(dragProgress(Number.NaN, W)).toBe(0);
  });
});

describe("shouldCommit", () => {
  it("commits right past 35% of the width and left likewise", () => {
    expect(shouldCommit(T + 1, 0, W)).toBe("approve");
    expect(shouldCommit(-(T + 1), 0, W)).toBe("pass");
  });
  it("does not commit just under the threshold at low speed", () => {
    expect(shouldCommit(T - 1, 100, W)).toBeNull();
    expect(shouldCommit(-(T - 1), -100, W)).toBeNull();
  });
  it("commits on a flick at 600 px/s even for a short drag, in the throw direction", () => {
    expect(shouldCommit(40, COMMIT_VELOCITY, W)).toBe("approve");
    expect(shouldCommit(-40, -COMMIT_VELOCITY, W)).toBe("pass");
    expect(shouldCommit(40, COMMIT_VELOCITY - 1, W)).toBeNull();
  });
  it("ignores a fast release that travels against the drag, and a flick with no real drag", () => {
    expect(shouldCommit(40, -900, W)).toBeNull();
    expect(shouldCommit(2, 900, W)).toBeNull();
  });
  it("never commits on bad input", () => {
    expect(shouldCommit(Number.NaN, 0, W)).toBeNull();
    expect(shouldCommit(100, Number.NaN, W)).toBeNull();
    expect(shouldCommit(100, 0, 0)).toBeNull();
  });
});

describe("rotationFor", () => {
  it("follows x, is zero at rest and clamps at plus/minus 12 degrees", () => {
    expect(rotationFor(0, W)).toBe(0);
    expect(rotationFor(60, W)).toBeGreaterThan(0);
    expect(rotationFor(-60, W)).toBeLessThan(0);
    expect(rotationFor(W * 3, W)).toBe(MAX_ROTATE);
    expect(rotationFor(-W * 3, W)).toBe(-MAX_ROTATE);
    expect(MAX_ROTATE).toBe(12);
  });
  it("is monotonic", () => {
    expect(rotationFor(80, W)).toBeLessThan(rotationFor(120, W));
  });
});

describe("stamps and tint", () => {
  it("show the APPROVE stamp only on a right drag and PASS only on a left drag", () => {
    expect(stampOpacity(T, W, "approve")).toBe(1);
    expect(stampOpacity(T, W, "pass")).toBe(0);
    expect(stampOpacity(-T, W, "pass")).toBe(1);
    expect(stampOpacity(-T, W, "approve")).toBe(0);
    expect(stampOpacity(0, W, "approve")).toBe(0);
  });
  it("grows with distance", () => {
    expect(stampOpacity(T * 0.3, W, "approve")).toBeLessThan(stampOpacity(T * 0.7, W, "approve"));
    expect(tintOpacity(T * 0.3, W)).toBeLessThan(tintOpacity(T * 0.9, W));
    expect(tintOpacity(0, W)).toBe(0);
  });
  it("scales the stamp from 0.8 up to 1 as the drag nears the threshold, then snaps past it", () => {
    expect(stampScale(0, W)).toBeCloseTo(0.8);
    expect(stampScale(T * 0.5, W)).toBeCloseTo(0.9);
    expect(stampScale(T * 0.99, W)).toBeLessThan(1);
    expect(stampScale(T, W)).toBeGreaterThan(1);
  });
});

describe("flyOutVector", () => {
  it("throws in the direction of the decision, further than the card is wide", () => {
    const r = flyOutVector("approve", 0, W);
    const l = flyOutVector("pass", 0, W);
    expect(r.x).toBeGreaterThan(W);
    expect(l.x).toBeLessThan(-W);
    expect(r.rotate).toBeGreaterThanOrEqual(MAX_ROTATE);
    expect(l.rotate).toBeLessThanOrEqual(-MAX_ROTATE);
  });
  it("is faster and spins more with a faster release", () => {
    const slow = flyOutVector("approve", 0, W);
    const fast = flyOutVector("approve", 2400, W);
    expect(fast.duration).toBeLessThan(slow.duration);
    expect(fast.rotate).toBeGreaterThan(slow.rotate);
  });
  it("ignores a velocity pointing the wrong way", () => {
    expect(flyOutVector("approve", -2000, W)).toEqual(flyOutVector("approve", 0, W));
  });
  it("keeps the duration inside a sane range", () => {
    for (const v of [0, 600, 5000, 1e9]) {
      const { duration } = flyOutVector("pass", v, W);
      expect(duration).toBeGreaterThanOrEqual(0.16);
      expect(duration).toBeLessThanOrEqual(0.42);
    }
  });
});

describe("isMostlyVertical", () => {
  it("is false for a horizontal drag and true past 30 degrees", () => {
    expect(isMostlyVertical(100, 0)).toBe(false);
    expect(isMostlyVertical(100, 50)).toBe(false); // about 26.6 degrees
    expect(isMostlyVertical(100, 60)).toBe(true); // about 31 degrees
    expect(isMostlyVertical(0, 40)).toBe(true);
    expect(isMostlyVertical(-100, -80)).toBe(true);
  });
  it("is false when nothing moved", () => {
    expect(isMostlyVertical(0, 0)).toBe(false);
  });
});

describe("shadowFor and restingPose", () => {
  it("grows both shadow layers with lift", () => {
    const px = (s: string) => [...s.matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    expect(Math.max(...px(shadowFor(1)))).toBeGreaterThan(Math.max(...px(shadowFor(0))));
    expect(shadowFor(0).split("),").length).toBeGreaterThanOrEqual(2);
  });
  it("stacks cards at scale 0.95 and 0.90 with a 14px step and dims them", () => {
    expect(restingPose(0)).toMatchObject({ scale: 1, y: 0, opacity: 1 });
    expect(restingPose(1)).toMatchObject({ scale: 0.95, y: 14 });
    expect(restingPose(2)).toMatchObject({ scale: 0.9, y: 28 });
    expect(restingPose(2).opacity).toBeLessThan(restingPose(1).opacity);
    expect(restingPose(5)).toEqual(restingPose(2));
  });
});
