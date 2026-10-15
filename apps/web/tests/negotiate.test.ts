import { describe, expect, it } from "vitest";
import { prefersMarkdown, routeJobPath } from "../lib/negotiate";

describe("prefersMarkdown", () => {
  it.each([
    ["text/markdown", true],
    ["text/markdown, text/html", false], // tie goes to HTML
    ["text/markdown, text/html;q=0.5", true],
    ["text/html;q=0.9, text/markdown", true],
    ["text/markdown;q=0.8, text/html", false],
    ["text/markdown;q=0", false],
    ["text/markdown;q=0, */*", false],
    ["*/*", false],
    ["text/*", false],
    ["text/html", false],
    ["", false],
    [null, false],
    ["text/markdown, */*;q=0.1", true],
    ["text/markdown;q=0.5, */*;q=0.1", true], // html resolves to the */* range at 0.1
    ["text/markdown;q=abc, text/html", false], // malformed q: that range is ignored
    ["TEXT/Markdown", true],
    ["text/markdown ; q=1 , text/html ; q=0.2", true],
    ["application/json", false],
    ["text/markdown, text/*;q=0.1", true],
    ["text/html, text/markdown;q=1.5", false], // q above 1 is malformed
  ])("%j -> %s", (accept, want) => {
    expect(prefersMarkdown(accept)).toBe(want);
  });

  it("does not choke on very long headers", () => {
    const junk = Array.from({ length: 5000 }, (_, i) => `x/y${i}`).join(",");
    expect(prefersMarkdown(`text/markdown, ${junk}`)).toBe(true);
    // ranges past the 64th are ignored, so a flood cannot bury or fake a preference
    expect(prefersMarkdown(`${junk}, text/markdown`)).toBe(false);
  });
});

describe("routeJobPath", () => {
  it("rewrites .md to the internal markdown path regardless of Accept", () => {
    expect(routeJobPath("/job/data-eng-acme.md", "text/html")).toEqual({ kind: "rewrite", to: "/md/job/data-eng-acme" });
    expect(routeJobPath("/job/a1.md", null)).toEqual({ kind: "rewrite", to: "/md/job/a1" });
  });
  it("rewrites the bare slug only when Accept selects markdown", () => {
    expect(routeJobPath("/job/abc", "text/markdown")).toEqual({ kind: "rewrite", to: "/md/job/abc" });
    expect(routeJobPath("/job/abc", "text/html")).toEqual({ kind: "html", slug: "abc" });
    expect(routeJobPath("/job/abc", null)).toEqual({ kind: "html", slug: "abc" });
  });
  it("404s direct /md requests", () => {
    expect(routeJobPath("/md/job/abc", null)).toEqual({ kind: "notfound" });
    expect(routeJobPath("/md/anything", "text/markdown")).toEqual({ kind: "notfound" });
  });
  it("passes everything else through", () => {
    expect(routeJobPath("/jobs", "text/markdown")).toEqual({ kind: "pass" });
    expect(routeJobPath("/job/abc/extra", "text/markdown")).toEqual({ kind: "pass" });
    expect(routeJobPath("/job/Bad_Slug.md", null)).toEqual({ kind: "pass" });
    expect(routeJobPath("/job/.md", null)).toEqual({ kind: "pass" });
    expect(routeJobPath("/job/a.b.md", null)).toEqual({ kind: "pass" });
    expect(routeJobPath("/job/" + "a".repeat(201), "text/markdown")).toEqual({ kind: "pass" });
  });
});
