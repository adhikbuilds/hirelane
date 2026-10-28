import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { BUDGET_ROUTES, firstLoadBytes, LIMIT_BYTES, measure, normalizePage, render, sharedFloor, type Manifest } from "../../../scripts/js-budget";

// Random bytes do not compress, so gzip size is close to the byte count.
const noise = (n: number, _seed: number) => randomBytes(n);

describe("js-budget", () => {
  it("normalises manifest keys to URLs", () => {
    expect(normalizePage("/(auth)/signin/code/page")).toBe("/signin/code");
    expect(normalizePage("/(app)/you/eligibility/page")).toBe("/you/eligibility");
    expect(normalizePage("/page")).toBe("/");
  });

  it("sums gzip bytes of unique js files only", () => {
    const files = { "a.js": noise(2000, 1), "b.js": noise(3000, 2), "c.css": noise(9000, 3) };
    const r = firstLoadBytes(["a.js", "a.js", "b.js", "c.css"], (f) => files[f as keyof typeof files]);
    expect(r.files).toBe(2);
    expect(r.bytes).toBe(gzipSync(files["a.js"], { level: 9 }).length + gzipSync(files["b.js"], { level: 9 }).length);
  });

  const files: Record<string, Buffer> = { "shared.js": noise(60_000, 4), "small.js": noise(10_000, 5), "big.js": noise(50_000, 6), "resume1.js": noise(5_000, 7) };
  const manifest: Manifest = {
    pages: {
      "/layout": ["shared.js"],
      "/(auth)/signin/page": ["shared.js", "small.js"],
      "/(auth)/signin/code/page": ["shared.js", "small.js"],
      "/(auth)/welcome/page": ["shared.js", "small.js"],
      "/(app)/you/page": ["shared.js", "big.js"],
      "/(app)/resume/upload/page": ["shared.js", "resume1.js"],
      "/(app)/resume/[id]/page": ["shared.js", "small.js", "resume1.js"],
    },
  };
  const read = (f: string) => files[f]!;

  it("flags a route over the limit, passes the rest, and reports unbuilt routes without failing them", () => {
    const rows = measure(manifest, read);
    const by = Object.fromEntries(rows.map((r) => [r.route, r]));
    expect(by["/signin"]!.status).toBe("ok");
    expect(by["/you"]!.status).toBe("over");
    expect(by["/you"]!.bytes).toBeGreaterThan(LIMIT_BYTES);
    expect(by["/you/eligibility"]).toMatchObject({ status: "not built", page: null, bytes: 0 });
    expect(rows.filter((r) => r.route.startsWith("/resume/")).map((r) => r.route)).toEqual(["/resume/[id]", "/resume/upload"]);
  });

  it("covers the routes the plan names", () => {
    expect(BUDGET_ROUTES).toEqual(["/signin", "/signin/code", "/welcome", "/you", "/you/eligibility", "/resume/*"]);
  });

  it("prints a table with the framework floor", () => {
    const rows = measure(manifest, read);
    const out = render(rows, sharedFloor(manifest, read, rows), LIMIT_BYTES, measure({ pages: { "/terms/page": ["shared.js"] } }, read, ["/terms"])[0]);
    expect(out).toMatch(/\/you\s+\d+\.\d kB\s+2\s+over/);
    expect(out).toMatch(/\/you\/eligibility\s+-\s+-\s+not built/);
    expect(out).toMatch(/chunks shared by every measured route/);
    expect(out).toMatch(/reference, \/terms .* floor/);
  });
});
