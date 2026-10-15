import { describe, expect, it } from "vitest";
import { API_PARAM_ORDER } from "../lib/public-api-params";
import { llmsTxt, PARAM_DOCS } from "../lib/llms";

const body = llmsTxt("https://hirelane.test/");

describe("llms.txt", () => {
  it("follows the llms.txt shape: an H1, a blockquote summary, then H2 sections", () => {
    const lines = body.split("\n");
    expect(lines[0]).toBe("# Hirelane");
    expect(lines.find((l) => l.length > 0 && l !== "# Hirelane")?.startsWith("> ")).toBe(true);
    expect(body).toMatch(/^## /m);
  });

  it("documents every public API parameter by its exact name, and nothing else", () => {
    expect(Object.keys(PARAM_DOCS)).toEqual([...API_PARAM_ORDER]);
    for (const name of API_PARAM_ORDER) expect(body).toContain(`- \`${name}\`:`);
  });

  it("uses absolute URLs on the given origin and no double slashes", () => {
    expect(body).toContain("https://hirelane.test/api/public/jobs");
    expect(body).toContain("https://hirelane.test/sitemap.xml");
    expect(body).not.toMatch(/https:\/\/hirelane\.test\/\//);
  });

  it("explains the markdown variants", () => {
    expect(body).toContain("Accept: text/markdown");
    expect(body).toContain(".md");
  });

  it("states that applications need the person's approval and that there is no submission API", () => {
    expect(body).toMatch(/approval/i);
    expect(body).toMatch(/no (api|endpoint)[^.]*submit/i);
  });

  it("states limits and the money convention", () => {
    expect(body).toMatch(/minor units/i);
    expect(body).toMatch(/60 requests per minute/);
  });

  it("is plain text without HTML and banned punctuation habits", () => {
    expect(body).not.toMatch(/<[a-z]/i);
    expect(body).not.toContain("—");
  });
});
