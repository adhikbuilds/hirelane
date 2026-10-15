import { describe, expect, it } from "vitest";
import { escapeInline } from "../lib/job-markdown";

describe("escapeInline", () => {
  it("neutralises markdown links and emphasis in employer text", () => {
    const out = escapeInline("[Apply here](https://evil.example) *now* <b>");
    expect(out).toBe("\\[Apply here\\]\\(https://evil.example\\) \\*now\\* \\<b\\>");
    expect(out).not.toMatch(/(?<!\\)\[/);
  });
  it("leaves ordinary text alone", () => {
    expect(escapeInline("Senior Backend Engineer, Payments")).toBe("Senior Backend Engineer, Payments");
  });
});
