import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The owner's rules for the student app (DESIGN.md section 5): no time-cost copy, no invented prices, no competitor
// names, greys plus one accent. Scanned from source so a later edit cannot slip one in.
const ROOT = join(import.meta.dirname, "..", "..");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(n)) out.push(p);
  }
  return out;
};
const NEW_SHELL = ["components/student/AppShell.tsx", "components/student/Deck.tsx", "components/student/RoleCard.tsx", "components/student/HomeA.tsx", "components/student/DrivesView.tsx", "components/student/TrackerView.tsx", "components/student/FinishView.tsx", "components/student/PasteForm.tsx", "components/student/Onboarding.tsx", "components/student/OutcomeButtons.tsx", "components/student/CopyButton.tsx", "components/student/Icon.tsx"];
const NEW_PAGES = ["app/(app)/home/page.tsx", "app/(app)/picks/page.tsx", "app/(app)/drives/page.tsx", "app/(app)/tracker/page.tsx", "app/(app)/tracker/[id]/page.tsx", "app/(app)/paste/page.tsx", "app/(app)/welcome/apply/page.tsx", "app/(app)/welcome/college/page.tsx"];
const SOURCES = [...NEW_SHELL, ...NEW_PAGES, "lib/student/map.ts", "lib/student/sample.ts"];
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

describe("student app copy rules", () => {
  it("names no competitor", () => {
    const BAD = /\b(naukri|indeed|internshala|foundit|monster|glassdoor|shine\.com|apna|unstop|wellfound|instahyre|hirect|cutshort|zety|resume\.io|simplify|jobright|lazyapply|sonara)\b/i;
    const hits = SOURCES.filter((f) => BAD.test(read(f)));
    expect(hits).toEqual([]);
  });
  it("has no time-cost copy (functional limits like the 4 second undo and a code's 10 minutes are allowed)", () => {
    const BAD = /\b(save[sd]? (you )?(time|hours)|in (just )?(a few )?(minutes|seconds)|takes? (only |just )?(a |\d+ )?(minutes?|seconds?)|under \d+ minutes|about \d+ minutes|minutes? to (apply|fill)|quick(ly)?|instantly|in a flash|one tap)\b/i;
    const hits = SOURCES.filter((f) => BAD.test(read(f)));
    expect(hits).toEqual([]);
  });
  it("shows no rupee amount outside the labelled sample", () => {
    const hits = [...NEW_SHELL, ...NEW_PAGES, "lib/student/map.ts"].filter((f) => /₹\s?\d/.test(read(f)));
    expect(hits).toEqual([]);
  });
  it("has no streaks, fake scarcity or social-proof hooks", () => {
    const BAD = /\b(streak|hurry|only \d+ left|others? (have )?applied|trending|going fast|unlock|seamless|supercharge|powerful)\b/i;
    expect(SOURCES.filter((f) => BAD.test(read(f)))).toEqual([]);
  });
  it("every pay string on a real card comes from the service, never computed from text", () => {
    const map = read("lib/student/map.ts");
    expect(map).toMatch(/monthly: null/);
    expect(map).not.toMatch(/\/ ?12/);
  });
});

describe("student app stays light and calm", () => {
  it("the new student components import no motion, radix or sonner", () => {
    const BANNED = /from\s+["'](?:motion(?:\/[^"']*)?|framer-motion|radix-ui|@radix-ui\/[^"']+|sonner)["']/;
    const files = [...walk(join(ROOT, "components/student")), ...walk(join(ROOT, "lib/student"))];
    expect(files.filter((f) => BANNED.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f))).toEqual([]);
  });
  it("colour is spent on the role card only: the app chrome CSS has no saturated hue outside the card, auth and tokens", () => {
    const css = readFileSync(join(ROOT, "app/student.css"), "utf8");
    // strip the role card, stamps, auth surface and the token block, then look for hex colours that are not greys/navy/accent/danger
    const cardOnly = css
      .split("\n")
      .filter((l) => !/\.st-rc|\.st-stamp|\.st-au|\.st-auth|\.st-toast|--card-|--cream|--accent|--danger|--navy|--paper|--surface|--raised|--ink|--line|--focus|--on-navy/.test(l))
      .join("\n");
    expect(cardOnly.length).toBeGreaterThan(5000);
    const hexes = [...cardOnly.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());
    const GREY = /^#(?:[0-9a-f])\1\1$|^#([0-9a-f]{2})\1\1$/;
    expect(hexes.filter((h) => !GREY.test(h))).toEqual([]);
  });
  it("no transition: all and no gradients in the student CSS", () => {
    const css = readFileSync(join(ROOT, "app/student.css"), "utf8");
    expect(css).not.toMatch(/transition:\s*all\b/);
    expect(css).not.toMatch(/gradient\(/);
  });
});
