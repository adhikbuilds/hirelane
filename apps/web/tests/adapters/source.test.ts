import { describe, expect, it } from "vitest";
import { decideSource, type SourceInput } from "@/lib/adapters/source";
import { clock, dateLabel, daysBetween, dayKey, shortDate, stepTime } from "@/lib/adapters/ist";

const base: SourceInput = { accountsOn: true, signedIn: true, hasData: true, dev: false };

describe("decideSource", () => {
  it("flag off: sample in dev, 404 in production", () => {
    expect(decideSource({ ...base, accountsOn: false, dev: true })).toBe("sample");
    expect(decideSource({ ...base, accountsOn: false })).toBe("notfound");
  });
  it("signed out: sample in dev, /signin in production", () => {
    expect(decideSource({ ...base, signedIn: false, dev: true })).toBe("sample");
    expect(decideSource({ ...base, signedIn: false })).toBe("signin");
  });
  it("signed in with data is real everywhere", () => {
    expect(decideSource({ ...base, dev: true })).toBe("real");
    expect(decideSource(base)).toBe("real");
  });
  it("signed in without data: sample in dev only; production shows the real empty screen", () => {
    expect(decideSource({ ...base, hasData: false, dev: true })).toBe("sample");
    expect(decideSource({ ...base, hasData: false })).toBe("real");
  });
  it("no data where that means 'not allowed' is a 404 in production", () => {
    expect(decideSource({ ...base, hasData: false, emptyInProd: "notfound" })).toBe("notfound");
  });
  it("prodReady false keeps production at 404 even with data, and dev unchanged", () => {
    expect(decideSource({ ...base, prodReady: false })).toBe("notfound");
    expect(decideSource({ ...base, prodReady: false, dev: true })).toBe("real");
  });
  it("production never returns sample, across the whole matrix", () => {
    for (const accountsOn of [true, false])
      for (const signedIn of [true, false])
        for (const hasData of [true, false])
          for (const emptyInProd of ["real", "notfound"] as const)
            for (const prodReady of [true, false]) {
              expect(decideSource({ accountsOn, signedIn, hasData, dev: false, emptyInProd, prodReady })).not.toBe("sample");
            }
  });
});

describe("IST helpers", () => {
  const late = new Date("2026-10-28T20:00:00Z"); // 01:30 on 29 Oct in IST
  it("uses the IST calendar day, not UTC", () => {
    expect(dayKey(late)).toBe("2026-10-29");
    expect(dateLabel(late)).toBe("Thu 29 Oct");
    expect(shortDate(late)).toBe("29 Oct");
    expect(clock(late)).toBe("01:30");
  });
  it("counts whole IST days", () => {
    expect(daysBetween(late, new Date("2026-10-31T05:00:00Z"))).toBe(2);
    expect(daysBetween(new Date("2026-10-31T05:00:00Z"), late)).toBe(-2);
    expect(daysBetween(late, late)).toBe(0);
  });
  it("labels tracker step times", () => {
    const now = new Date("2026-10-29T10:00:00Z");
    expect(stepTime(new Date("2026-10-29T01:10:00Z"), now)).toBe("Today 6:40");
    expect(stepTime(new Date("2026-10-26T03:32:00Z"), now)).toBe("Mon 9:02");
    expect(stepTime(new Date("2026-10-12T03:32:00Z"), now)).toBe("12 Oct");
  });
});
