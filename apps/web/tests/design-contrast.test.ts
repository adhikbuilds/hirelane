import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Design guard (DESIGN.md section 3: UI edges and focus rings need 3:1). Reads the shipped CSS, so a token edit
// that drops below the bar fails here before Hallmark sees it.
const css = (f: string) => readFileSync(join(__dirname, "..", "app", f), "utf8");

const block = (src: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const at = src.search(new RegExp(`^${escaped}\\s*\\{`, "m"));
  if (at < 0) throw new Error(`no block for ${selector}`);
  return src.slice(at, src.indexOf("}", at));
};
const token = (b: string, name: string): string => {
  const m = b.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token ${name} missing`);
  return m[1]!;
};
const lum = (hex: string): number => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe("placement console contrast", () => {
  const src = css("campus.css");
  const themes: [string, string][] = [
    ["light", block(src, ":root")],
    ["dark", block(src, '[data-theme="console-dark"]')],
  ];

  for (const [name, b] of themes) {
    it(`${name}: focus ring is 3:1 on the page and on the sidebar`, () => {
      expect(ratio(token(b, "--cp-focus"), token(b, "--cp-paper"))).toBeGreaterThanOrEqual(3);
      expect(ratio(token(b, "--cp-focus"), token(b, "--cp-surface"))).toBeGreaterThanOrEqual(3);
      expect(ratio(token(b, "--cp-focus-on-navy"), token(b, "--cp-navy"))).toBeGreaterThanOrEqual(3);
    });
    it(`${name}: field edge is 3:1 on the field fill`, () => {
      expect(ratio(token(b, "--cp-field-edge"), token(b, "--cp-paper"))).toBeGreaterThanOrEqual(3);
      expect(ratio(token(b, "--cp-field-edge"), token(b, "--cp-surface"))).toBeGreaterThanOrEqual(3);
    });
  }

  it("the console focus rule uses the focus tokens, not the navy that is invisible on dark", () => {
    expect(block(src, ".cp :focus-visible")).toContain("var(--cp-focus)");
    expect(block(src, ".cp-side :focus-visible")).toContain("var(--cp-focus-on-navy)");
  });
});

describe("student app contrast", () => {
  const b = block(css("student.css"), ".st,.st-auth");
  it("field edge is 3:1 on the surface", () => {
    expect(ratio(token(b, "--field-edge"), token(b, "--surface"))).toBeGreaterThanOrEqual(3);
    expect(css("student.css")).toMatch(/\.st-input\{[^}]*border:1px solid var\(--field-edge\)/);
  });
});

describe("student role cards hold one hue", () => {
  // DESIGN.md: more than one saturated hue in view at once is rejected, outside a single role card.
  it("every tone resolves to the lime fill, with dark ink", () => {
    const src = css("student.css");
    for (const tone of ["sun", "pink", "blue"]) {
      const m = src.match(new RegExp(`\\.st-rc\\.st-${tone}\\{([^}]*)\\}`));
      expect(m, tone).not.toBeNull();
      expect(m![1]).toContain("--fill:var(--card-lime)");
      expect(m![1]).not.toContain("--cream");
    }
  });
});
