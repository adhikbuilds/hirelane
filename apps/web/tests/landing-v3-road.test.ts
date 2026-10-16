import { describe, expect, it } from "vitest";
import { FALLBACK_SIGN, commonSign, parseRoad, startIndex, toSignRect } from "../components/landing-v3/hero/road";
import { loadRoad } from "../components/landing-v3/hero/road-load";
import { join } from "node:path";

describe("hero road photos", () => {
  it("reads the real sign rectangles that road.json nests under `sign`", () => {
    const shots = loadRoad(join(__dirname, "..", "public", "landing"));
    expect(shots.map((s) => s.slot)).toEqual(["0000", "0600", "1200", "1800"]);
    expect(shots.every((s) => !s.fallback)).toBe(true);
    expect(shots[2]!.sign).toEqual({ x: 21.74, y: 20.52, w: 60.83, h: 24.17 });
    expect(shots[0]!.src).toBe("/landing/road-0000.jpg");
  });
  it("falls back instead of throwing on a missing or broken file", () => {
    expect(loadRoad("/definitely/not/here").every((s) => s.fallback && s.sign === FALLBACK_SIGN)).toBe(true);
    for (const bad of [null, 5, "x", [], {}, { photos: [null, 3] }, { photos: [{ file: "road-0000.jpg", sign: { x: 90, y: 0, w: 40, h: 5 } }] }]) {
      expect(parseRoad(bad).every((s) => s.fallback)).toBe(true);
    }
  });
  it("accepts width/height spellings and rejects out-of-frame rectangles", () => {
    expect(toSignRect({ x: 1, y: 2, width: 3, height: 4 })).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(toSignRect({ x: -1, y: 2, w: 3, h: 4 })).toBeNull();
    expect(toSignRect({ x: 1, y: 2, w: 0, h: 4 })).toBeNull();
  });
  it("shares one sign rectangle that sits inside every photo's sign", () => {
    const shots = loadRoad(join(__dirname, "..", "public", "landing"));
    const c = commonSign(shots);
    for (const s of shots) {
      expect(c.x).toBeGreaterThanOrEqual(s.sign.x);
      expect(c.y).toBeGreaterThanOrEqual(s.sign.y);
      expect(c.x + c.w).toBeLessThanOrEqual(s.sign.x + s.sign.w + 1e-9);
      expect(c.y + c.h).toBeLessThanOrEqual(s.sign.y + s.sign.h + 1e-9);
    }
    expect(commonSign([])).toBe(FALLBACK_SIGN);
    const far = [{ ...shots[0]!, sign: { x: 0, y: 0, w: 10, h: 10 } }, { ...shots[1]!, sign: { x: 50, y: 50, w: 10, h: 10 } }];
    expect(commonSign(far)).toEqual(far[0]!.sign);
  });
  it("starts on the photo nearest the real UTC time", () => {
    expect(startIndex(new Date("2026-10-16T00:30:00Z"))).toBe(0);
    expect(startIndex(new Date("2026-10-16T05:00:00Z"))).toBe(1);
    expect(startIndex(new Date("2026-10-16T13:00:00Z"))).toBe(2);
    expect(startIndex(new Date("2026-10-16T20:00:00Z"))).toBe(3);
    expect(startIndex(new Date("2026-10-16T23:30:00Z"))).toBe(0);
  });
});
