import { describe, expect, it } from "vitest";
import { PAGE_SIZE, pageOffset, parsePage, sourceBadge, totalPages } from "../lib/ledger";

describe("ledger helpers", () => {
  it("pages 50 at a time", () => {
    expect(PAGE_SIZE).toBe(50);
    expect(pageOffset(1)).toBe(0);
    expect(pageOffset(3)).toBe(100);
  });
  it("parses the page defensively", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-4")).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage("2.5")).toBe(1);
    expect(parsePage("7")).toBe(7);
    expect(parsePage(["3", "4"])).toBe(3);
    expect(parsePage("99999999999")).toBe(1);
  });
  it("counts pages with a floor of one", () => {
    expect(totalPages(0)).toBe(1);
    expect(totalPages(50)).toBe(1);
    expect(totalPages(51)).toBe(2);
  });
  it("maps an ATS to its sign badge", () => {
    expect(sourceBadge("greenhouse")).toBe("gh");
    expect(sourceBadge("lever")).toBe("lv");
    expect(sourceBadge("ashby")).toBe("ab");
    expect(sourceBadge("other")).toBe("??");
  });
});
