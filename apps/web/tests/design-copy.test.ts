import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// DESIGN.md section 1: no time-cost copy ("about N minutes", "in under a minute", "a 20-minute call", "fix it in minutes").
// Functional timings (the 4 second undo window) live in the app feed, not in these pages.
const FILES = [
  "components/landing/Next.tsx",
  "components/landing/Main.tsx",
  "components/landing/Colleges.tsx",
  "components/landing/Students.tsx",
  "components/landing/Front.tsx",
  "components/app/PasteNetwork.tsx",
];
const TIME_COST = /\b(about|around|usually|within)?\s*\d+[- ]?(minutes?|mins?)\b|\bin (a|one) (second|minute)\b|\bunder a minute\b|\bin minutes\b|\bquick(ly)? (checks?|call)\b/i;

describe("no time-cost copy on the public and student pages", () => {
  for (const f of FILES) {
    it(f, () => {
      const lines = readFileSync(join(__dirname, "..", f), "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
      const hits = lines.filter((l) => TIME_COST.test(l)).map((l) => l.trim().slice(0, 120));
      expect(hits).toEqual([]);
    });
  }
});
