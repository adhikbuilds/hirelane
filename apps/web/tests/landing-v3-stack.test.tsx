// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: toastSpy, Toaster: () => null }));

import { SwipeStack } from "../components/landing-v3/stack/swipe-stack";
import { buildStackCards, needsFor } from "../components/landing-v3/stack/cards";
import type { DemoJob } from "../components/landing/types";

const pick = (wantNeeds: boolean, n: number): string[] => {
  const out: string[] = [];
  for (let i = 0; out.length < n; i++) if ((needsFor(`s${i}`) !== null) === wantNeeds) out.push(`s${i}`);
  return out;
};
const job = (slug: string): DemoJob => ({
  slug, title: `Role ${slug}`, company: `Co ${slug}`, logoPath: null, where: "Remote", payAnnual: "$120K–$150K/yr", payStated: null,
  payMaxUsdMinor: 15_000_000, skills: ["Python", "SQL", "Kafka", "dbt", "AWS", "Go"],
});
const deck = (slugs: string[]) => buildStackCards(slugs.map(job), Object.fromEntries(slugs.map((s) => [s, { freshAt: "2026-10-16T09:00:00Z", openRoles: 5, postingUrl: "https://boards.example.com/" + s }])), new Date("2026-10-16T12:00:00Z"));

const top = () => screen.getAllByTestId("top-card")[0]!;
const current = () => screen.getByTestId("demo").getAttribute("data-current-slug");
const press = (key: string) => fireEvent.keyDown(document.body, { key });
const setDesktop = (yes: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: yes && q.includes("min-width"), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
};

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  toastSpy.mockClear();
  fetchSpy = vi.fn(() => Promise.reject(new Error("no network expected")));
  vi.stubGlobal("fetch", fetchSpy);
  setDesktop(false);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SwipeStack", () => {
  it("shows the top card with the next two cards queued behind it by company and role", () => {
    const [a, b, c, d] = pick(false, 4);
    render(<SwipeStack cards={deck([a!, b!, c!, d!])} />);
    expect(current()).toBe(a);
    const behind = screen.getAllByTestId("behind-card");
    expect(behind).toHaveLength(2);
    expect(behind.map((e) => e.getAttribute("data-slug")).sort()).toEqual([b, c].sort());
    expect(within(behind[0]!).getAllByText(/^Co s/).length).toBeGreaterThan(0);
    expect(within(behind[0]!).getAllByText(/^Role s/).length).toBeGreaterThan(0);
  });

  it("passes with P or the left arrow, announces it, and offers undo", () => {
    const [a, b, c] = pick(false, 3);
    render(<SwipeStack cards={deck([a!, b!, c!])} />);
    press("p");
    expect(current()).toBe(b);
    expect(screen.getByTestId("live-region")).toHaveTextContent(`Passed Role ${a} at Co ${a}.`);
    expect(screen.getByTestId("undo-bar")).toHaveTextContent("Passed");
    press("ArrowLeft");
    expect(current()).toBe(c);
  });

  it("approves with A or the right arrow when nothing needs an answer, with the 4 second undo bar", () => {
    const [a, b] = pick(false, 2);
    render(<SwipeStack cards={deck([a!, b!])} />);
    press("a");
    expect(current()).toBe(b);
    expect(screen.getByTestId("live-region")).toHaveTextContent(`Approved Role ${a} at Co ${a}. Sending in 4 seconds. Press U to undo.`);
    expect(screen.getByTestId("undo-bar")).toHaveTextContent(`Sending to Co ${a} in 4.0s`);
  });

  it("U brings the same card back", async () => {
    const [a, b] = pick(false, 2);
    render(<SwipeStack cards={deck([a!, b!])} />);
    press("ArrowRight");
    expect(current()).toBe(b);
    press("u");
    expect(current()).toBe(a);
    await waitFor(() => expect(screen.queryByTestId("undo-bar")).toBeNull());
  });

  it("the Undo button works too", () => {
    const [a, b] = pick(false, 2);
    render(<SwipeStack cards={deck([a!, b!])} />);
    fireEvent.click(screen.getByRole("button", { name: "Pass" }));
    expect(current()).toBe(b);
    fireEvent.click(within(screen.getByTestId("undo-bar")).getByRole("button", { name: /Undo/ }));
    expect(current()).toBe(a);
  });

  it("the Needs-you gate refuses approve, focuses the field and shows the message", () => {
    const [a, b] = pick(true, 2);
    render(<SwipeStack cards={deck([a!, b!])} />);
    press("a");
    expect(current()).toBe(a);
    expect(screen.queryByTestId("undo-bar")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Answer this first. Hirelane never guesses.");
    expect(within(top()).getByTestId("needs-field").querySelector("input")).toHaveFocus();
    // Pass still works through the gate, and a quick answer opens it.
    press("Escape");
    fireEvent.click(within(top()).getAllByRole("button", { name: /^(Immediately|30 days|60 days|I am authorised|Need sponsorship|This month|Next month|In 3 months)$/ })[0]!);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(current()).toBe(b);
  });

  it("typing in the Needs-you field never triggers the shortcuts", () => {
    const [a] = pick(true, 1);
    render(<SwipeStack cards={deck([a!, "x1", "x2"])} />);
    const input = within(top()).getByTestId("needs-field").querySelector("input")!;
    fireEvent.keyDown(input, { key: "p" });
    fireEvent.keyDown(input, { key: "a" });
    expect(current()).toBe(a);
  });

  it("makes no network request on approve, undo, or when the undo window runs out", () => {
    vi.useFakeTimers();
    const [a, b, c] = pick(false, 3);
    render(<SwipeStack cards={deck([a!, b!, c!])} />);
    press("a");
    press("u");
    press("a");
    act(() => void vi.advanceTimersByTime(4500));
    expect(toastSpy).toHaveBeenCalledWith(`Handed off to Co ${a}'s site`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not hand off a card whose approve was undone", () => {
    vi.useFakeTimers();
    const [a, b] = pick(false, 2);
    render(<SwipeStack cards={deck([a!, b!])} />);
    press("a");
    press("u");
    act(() => void vi.advanceTimersByTime(5000));
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("Space opens details on a phone as a sheet, with every requirement, the pay trace and a safe link", () => {
    const [a, b] = pick(false, 2);
    render(<SwipeStack cards={deck([a!, b!])} />);
    screen.getByTestId("demo").focus();
    fireEvent.keyDown(screen.getByTestId("demo"), { key: " " });
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getAllByText(/Posting lists/)).toHaveLength(6);
    expect(within(dlg).getByTestId("pay-trace")).toBeInTheDocument();
    const link = within(dlg).getByRole("link", { name: /Open the posting/ });
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
    expect(dlg).toHaveTextContent("4 other open roles at");
    fireEvent.click(within(dlg).getByRole("button", { name: "Pass" }));
    expect(current()).toBe(b);
  });

  it("Space opens the expanding panel on desktop, and Escape closes it", async () => {
    setDesktop(true);
    const [a, b] = pick(false, 2);
    render(<SwipeStack cards={deck([a!, b!])} />);
    fireEvent.keyDown(screen.getByTestId("demo"), { key: " " });
    const panel = screen.getByTestId("details-panel");
    expect(within(panel).getByRole("button", { name: "Approve" })).toBeInTheDocument();
    fireEvent.keyDown(panel, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("details-panel")).toBeNull());
  });

  it("does not hijack Space when focus is elsewhere on the page", () => {
    const [a, b] = pick(false, 2);
    render(<SwipeStack cards={deck([a!, b!])} />);
    fireEvent.keyDown(document.body, { key: " " });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ends with real tallies, a Start with your resume link and Start over", () => {
    const [a, b] = pick(false, 2);
    render(<SwipeStack cards={deck([a!, b!])} />);
    press("a");
    press("p");
    const end = screen.getByTestId("end-of-queue");
    expect(end).toHaveTextContent("That's today's queue. 2 decided: 1 approved, 1 passed.");
    expect(within(end).getByRole("link", { name: "Start with your resume" })).toHaveAttribute("href", "#start");
    fireEvent.click(within(end).getByRole("button", { name: /Start over/ }));
    expect(current()).toBe(a);
  });

  it("reports the top card so the road sign can follow", () => {
    const onTop = vi.fn();
    const [a, b] = pick(false, 2);
    render(<SwipeStack cards={deck([a!, b!])} onTopChange={onTop} />);
    expect(onTop).toHaveBeenLastCalledWith(expect.objectContaining({ slug: a }));
    press("p");
    expect(onTop).toHaveBeenLastCalledWith(expect.objectContaining({ slug: b }));
  });

  it("shows the first-visit hint once and remembers it", () => {
    const [a, b] = pick(false, 2);
    const { unmount } = render(<SwipeStack cards={deck([a!, b!])} />);
    expect(screen.getByTestId("stack-caption")).toHaveTextContent("Swipe right to approve, left to pass. Or use A and P.");
    expect(localStorage.getItem("hirelane:swipe-hint")).toBe("1");
    unmount();
    render(<SwipeStack cards={deck([a!, b!])} />);
    expect(screen.getByTestId("stack-caption")).toHaveTextContent("Demo: nothing is sent.");
  });

  it("copes with an empty deck", () => {
    render(<SwipeStack cards={[]} />);
    expect(screen.getByTestId("demo")).toHaveAttribute("data-current-slug", "");
  });
});
