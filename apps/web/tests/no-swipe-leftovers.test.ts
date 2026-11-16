import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".next", "tests", "coverage", ".turbo"]);
const EXT = /\.(ts|tsx|css|md|mdx|json|mjs|js)$/;
/** The deprecated route keeps its old name for existing callers; nothing else in the app may use the word. */
const DEPRECATED_ROUTE_DIR = "app/api/v1/apply/swipe/";
/** Names exported by @hirelane/services (outside apps/web) and the deprecated path kept in the OpenAPI document. */
const SERVICE_NAMES = /\b(swipeRight|SwipeInput|SwipeResultSchema)\b|\/api\/v1\/apply\/swipe\b/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(p, out);
    } else if (EXT.test(name)) out.push(p);
  }
  return out;
}

describe("no swipe wording left in apps/web", () => {
  it("no source file, class name or file name mentions swipe outside the deprecated route", () => {
    const hits: string[] = [];
    for (const file of walk(ROOT)) {
      const rel = relative(ROOT, file);
      if (rel.startsWith(DEPRECATED_ROUTE_DIR)) continue;
      if (/swip/i.test(rel)) hits.push(`${rel} (file name)`);
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/swip/i.test(line.replace(SERVICE_NAMES, ""))) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
