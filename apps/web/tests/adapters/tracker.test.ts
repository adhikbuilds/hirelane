import { describe, expect, it } from "vitest";
import type { ApplicationSummary } from "@hirelane/services";
import { toTrackerItems } from "@/lib/adapters/tracker";

const NOW = new Date("2026-10-29T10:00:00Z");
const app = (over: Partial<ApplicationSummary> = {}): ApplicationSummary => ({
  id: "a1",
  status: "submitted",
  company: "Zenoti",
  title: "Customer Support Associate",
  platform: "greenhouse",
  undoUntil: "2026-10-28T03:30:04.000Z",
  canUndo: false,
  blockedReason: null,
  fallback: null,
  needsYouCount: 0,
  lastReply: null,
  createdAt: "2026-10-28T03:30:00.000Z",
  submittedAt: "2026-10-28T03:31:00.000Z",
  ...over,
});
const one = (over: Partial<ApplicationSummary>) => toTrackerItems([app(over)], NOW)[0]!;

describe("toTrackerItems", () => {
  it("maps the card fields", () => {
    expect(one({})).toMatchObject({ id: "a1", company: "Zenoti", initial: "Z", role: "Customer Support Associate", state: "handed_off" });
  });
  it("hides undone applications", () => {
    expect(toTrackerItems([app({ status: "undone" })], NOW)).toEqual([]);
  });
  it("empty in, empty out", () => {
    expect(toTrackerItems([], NOW)).toEqual([]);
  });
  it("ready and submitting are still being sent", () => {
    for (const status of ["ready", "submitting"] as const) {
      const t = one({ status, submittedAt: null });
      expect(t.state).toBe("handed_off");
      expect(t.steps.at(-1)).toEqual({ at: "Now", text: "Hirelane is sending it", done: false });
    }
  });
  it("blocked_fallback keeps the finish-on-their-site step open", () => {
    const t = one({ status: "blocked_fallback", submittedAt: null, fallback: { message: "Finish on their site", url: "https://example.test/apply" } });
    expect(t.state).toBe("handed_off");
    expect(t.steps.at(-1)).toEqual({ at: "Now", text: "Finish on their site", done: false });
  });
  it("failed is shown, not hidden", () => {
    expect(one({ status: "failed", submittedAt: null }).steps.at(-1)).toEqual({ at: "Now", text: "Could not be sent", done: false });
  });
  it.each([
    ["interview", "interview"],
    ["test", "replied"],
    ["other", "replied"],
    ["rejection", "not_this_time"],
  ] as const)("last reply %s => %s", (lastReply, state) => {
    expect(one({ lastReply }).state).toBe(state);
  });
  it("goes quiet after six days with no reply, not before", () => {
    expect(one({ submittedAt: "2026-10-23T03:00:00.000Z" }).state).toBe("quiet");
    expect(one({ submittedAt: "2026-10-24T03:00:00.000Z" }).state).toBe("handed_off");
    expect(one({ submittedAt: "2026-10-23T03:00:00.000Z", lastReply: "other" }).state).toBe("replied");
  });
  it("handles a blank company name and non-latin names", () => {
    expect(one({ company: "  " }).initial).toBe("?");
    expect(one({ company: "ज़ोहो" }).initial).toBe("ज़ोहो"[0]);
  });
});
