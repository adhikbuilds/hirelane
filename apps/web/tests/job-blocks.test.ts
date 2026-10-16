import { describe, expect, it } from "vitest";
import { describe as blocks } from "../components/job/blocks";
import { logoPathOf } from "../components/job/similar-model";

describe("description blocks", () => {
  it("returns nothing for null, undefined and blank input", () => {
    expect(blocks(null)).toEqual([]);
    expect(blocks(undefined)).toEqual([]);
    expect(blocks("  \n\n ")).toEqual([]);
  });
  it("splits paragraphs on blank lines and joins only soft-wrapped lines", () => {
    expect(blocks("one\ntwo\n\nthree")).toEqual([
      { kind: "p", text: "one two" },
      { kind: "p", text: "three" },
    ]);
    expect(blocks("First sentence.\nSecond block.")).toEqual([
      { kind: "p", text: "First sentence." },
      { kind: "p", text: "Second block." },
    ]);
  });
  it("turns plain lines after a '...' heading into a list (one line per ATS block)", () => {
    expect(blocks("\u{1F9E0} You will...\nOwn the strategy\nBuild the team\n\nAbout us\nWe teach.")).toEqual([
      { kind: "h", text: "\u{1F9E0} You will" },
      { kind: "ul", items: ["Own the strategy", "Build the team"] },
      { kind: "p", text: "About us" },
      { kind: "p", text: "We teach." },
    ]);
  });
  it("turns short colon lines into headings and bullet runs into lists", () => {
    expect(blocks("Responsibilities:\n- Build APIs\n* Review code\n• Ship\n1. Learn")).toEqual([
      { kind: "h", text: "Responsibilities" },
      { kind: "ul", items: ["Build APIs", "Review code", "Ship", "Learn"] },
    ]);
  });
  it("keeps markup as inert text (React escapes it)", () => {
    expect(blocks("<script>alert(1)</script>")).toEqual([{ kind: "p", text: "<script>alert(1)</script>" }]);
  });
  it("does not treat a long line ending in a colon as a heading", () => {
    const long = `${"x".repeat(70)}:`;
    expect(blocks(long)[0]).toEqual({ kind: "p", text: long });
  });
  it("handles CRLF and unicode", () => {
    expect(blocks("Ünï \u{1F680}\r\n\r\nnext")).toHaveLength(2);
  });
});

describe("logoPathOf", () => {
  it("reduces an absolute logo URL to its path and tolerates null", () => {
    expect(logoPathOf("http://localhost:3001/logos/a.png")).toBe("/logos/a.png");
    expect(logoPathOf(null)).toBeNull();
  });
});
