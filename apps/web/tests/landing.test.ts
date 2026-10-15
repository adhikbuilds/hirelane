import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PREVIEW,
  PRICING,
  UNDO_MS,
  formatAgeLong,
  freshnessState,
  ledgerCaption,
  statusSummary,
} from "../components/landing/model";

const now = new Date("2026-10-16T12:00:00Z");
const ago = (mins: number) => new Date(now.getTime() - mins * 60_000);

describe("formatAgeLong", () => {
  it("renders hours and minutes", () => {
    expect(formatAgeLong(ago(134), now)).toBe("2h 14m");
    expect(formatAgeLong(ago(120), now)).toBe("2h");
    expect(formatAgeLong(ago(45), now)).toBe("45m");
    expect(formatAgeLong(ago(0), now)).toBe("0m");
  });
  it("switches to days past 48h and clamps the future", () => {
    expect(formatAgeLong(ago(60 * 24 * 3 + 60 * 5), now)).toBe("3d 5h");
    expect(formatAgeLong(new Date(now.getTime() + 60_000), now)).toBe("0m");
  });
});

describe("ledgerCaption", () => {
  it("is computed from the live values", () => {
    expect(ledgerCaption(ago(134), 97, now)).toBe("refreshed 2h 14m ago from 97 boards");
  });
  it("uses the singular for one board", () => {
    expect(ledgerCaption(ago(5), 1, now)).toBe("refreshed 5m ago from 1 board");
  });
  it("says so when nothing has run", () => {
    expect(ledgerCaption(null, 0, now)).toBe("no completed ingest run yet");
  });
});

describe("freshnessState", () => {
  it("maps age against the 6 hour cadence", () => {
    expect(freshnessState(ago(30), now)).toBe("fresh");
    expect(freshnessState(ago(60 * 7), now)).toBe("fresh");
    expect(freshnessState(ago(60 * 13), now)).toBe("late");
    expect(freshnessState(ago(60 * 30), now)).toBe("stale");
    expect(freshnessState(null, now)).toBe("none");
  });
});

describe("statusSummary", () => {
  it("states the failures plainly", () => {
    expect(statusSummary("fresh", 97, 0)).toBe("All 97 boards fetched on the last run.");
    expect(statusSummary("fresh", 95, 2)).toBe("95 boards fetched, 2 failed on the last run.");
    expect(statusSummary("none", 0, 0)).toBe("No ingest run has completed yet.");
  });
});

describe("preview fixture", () => {
  it("has draft answers and exactly one Needs-you field with a reason", () => {
    const needs = PREVIEW.fields.filter((f) => f.needsYou);
    expect(needs).toHaveLength(1);
    expect(needs[0]!.reason.length).toBeGreaterThan(5);
    expect(PREVIEW.fields.filter((f) => !f.needsYou).every((f) => f.source.length > 0)).toBe(true);
  });
  it("undo window is 4 seconds", () => {
    expect(UNDO_MS).toBe(4000);
  });
});

describe("pricing placeholder", () => {
  it("offers 10 free applications and marks weekly plans as Phase 7", () => {
    expect(PRICING.free.applications).toBe(10);
    expect(PRICING.weekly.currency).toBe("INR");
    expect(PRICING.weekly.availability).toMatch(/Phase 7/);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css)$/.test(p) ? [p] : [];
  });
}

describe("banned tropes and naming guard over the public content pages", () => {
  const root = join(__dirname, "..");
  const files = [
    join(root, "app/page.tsx"),
    ...["how-it-works", "compare", "about", "status"].flatMap((d) => walk(join(root, "app", d))),
    ...walk(join(root, "components/landing")),
  ];
  const src = files.map((f) => [f, readFileSync(f, "utf8")] as const);
  it("covers every page in scope", () => {
    for (const d of ["how-it-works", "compare", "about", "status"]) {
      expect(files.some((f) => f.includes(`app/${d}/page.tsx`))).toBe(true);
    }
  });
  const forbidden: [string, RegExp][] = [
    ["competitor or reference name", new RegExp(`${["short", "list"].join("")}|\\bpip\\b|simplify|jobright|lazyapply|sonara|loopcv|teal\\b|huntr`, "i")],
    ["monospace", /font-mono|monospace|\bmono\b/],
    ["gradient", /gradient/i],
    ["all caps labels", /\buppercase\b|text-transform/],
    ["accordion or faq", /<details|accordion|faq/i],
    ["testimonials or stars", /testimonial|★|star-rating/i],
    ["mascot or emoji", /mascot|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u],
    ["exclamation in copy", />[^<{}]*[A-Za-z]!(\s|<|$)/],
    ["ATS submission api", /submit.*api|\/apply\/submit|application-submit/i],
    ["giant step numerals", /text-\[(6\d|7\d|8\d|9\d|1\d\d)px\]/],
    ["glow", /shadow-\[|drop-shadow|blur-/],
  ];
  for (const [name, re] of forbidden) {
    it(`has no ${name}`, () => {
      const hits = src.filter(([, s]) => re.test(s)).map(([f]) => f);
      expect(hits).toEqual([]);
    });
  }
  it("uses signal yellow only in the preview component", () => {
    const hits = src.filter(([f, s]) => /signal/.test(s) && !f.includes("preview")).map(([f]) => f);
    expect(hits).toEqual([]);
  });
});
