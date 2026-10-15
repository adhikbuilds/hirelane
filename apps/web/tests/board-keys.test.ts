import { describe, expect, it } from "vitest";
import { isTypingTarget, nextIndex } from "../components/board/keys";

describe("nextIndex", () => {
  it("starts at the first row on j and the last on k", () => {
    expect(nextIndex(-1, "j", 5)).toBe(0);
    expect(nextIndex(-1, "k", 5)).toBe(4);
  });
  it("moves and clamps at the ends", () => {
    expect(nextIndex(2, "j", 5)).toBe(3);
    expect(nextIndex(4, "j", 5)).toBe(4);
    expect(nextIndex(0, "k", 5)).toBe(0);
  });
  it("returns -1 with no rows", () => {
    expect(nextIndex(-1, "j", 0)).toBe(-1);
  });
});

describe("isTypingTarget", () => {
  it("is true for form fields and editable content", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });
  it("is false for links, body and null", () => {
    expect(isTypingTarget({ tagName: "A" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
