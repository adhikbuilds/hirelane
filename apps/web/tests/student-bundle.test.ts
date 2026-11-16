import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Amendment B section 12: no motion, radix or sonner on student pages. dependency-cruiser excludes node_modules, so it
// cannot see these imports; this scans the source instead. `pnpm budget` measures the result.
const ROOT = join(import.meta.dirname, "..");
const BANNED = /from\s+["'](?:motion(?:\/[^"']*)?|framer-motion|radix-ui|@radix-ui\/[^"']+|sonner)["']/;

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

describe("student pages stay light", () => {
  it("the root layout reaches the marketing chrome only through the lazy SiteChrome", () => {
    const layout = readFileSync(join(ROOT, "app/layout.tsx"), "utf8");
    expect(layout).toContain("@/components/shell/SiteChrome");
    for (const heavy of ["SiteHeader", "SiteFooter", "MobileMenu", "landing-v3"]) expect(layout, heavy).not.toContain(heavy);
    const chrome = readFileSync(join(ROOT, "components/shell/SiteChrome.tsx"), "utf8");
    expect(chrome).toMatch(/dynamic\(\(\) => import\("\.\/SiteHeader"\)/);
    expect(chrome).not.toMatch(/^import .*SiteHeader/m);
  });

  it("no file under app/(app), app/(auth) or components/account imports motion, radix or sonner directly", () => {
    const files = [...walk(join(ROOT, "app/(app)")), ...walk(join(ROOT, "app/(auth)")), ...walk(join(ROOT, "components/account"))];
    expect(files.length).toBeGreaterThan(5);
    const bad = files.filter((f) => BANNED.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
    expect(bad).toEqual([]);
  });
});
