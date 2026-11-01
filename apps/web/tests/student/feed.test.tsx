// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
const api = vi.hoisted(() => ({ postJson: vi.fn(), readSet: vi.fn(() => new Set<string>()), writeSet: vi.fn() }));
vi.mock("@/lib/student/client", () => api);

import { Feed } from "@/components/student/Feed";
import { SAMPLE_CARDS } from "@/lib/student/sample";
import type { CardData } from "@/lib/student/types";

const real = (n: number): CardData[] => SAMPLE_CARDS.map((c, i) => ({ ...c, id: `job-${i}`, jobId: `00000000-0000-4000-8000-00000000000${i + 1}`, role: `${c.role} ${n}` }));
const swipeOk = { ok: true, status: 201, data: { application: { id: "app-1" } }, error: null };
const itemOf = (role: string) => screen.getByRole("article", { name: new RegExp(role) }).closest(".st-fitem") as HTMLElement;
const live = () => document.querySelector("[aria-live]")!.textContent;

beforeEach(() => {
  api.postJson.mockReset();
  api.readSet.mockReset().mockReturnValue(new Set<string>());
  api.writeSet.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("Feed", () => {
  it("lists every pick as its own card with Skip, Save and Apply, and counts what is left", () => {
    const cards = real(1);
    render(<Feed cards={cards} variant="home" autoApply address={null} network />);
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: /^Skip/ })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: /^Save/ })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: /^Apply/ })).toHaveLength(3);
    expect(screen.getByText("3 left")).toBeTruthy();
  });

  it("a card shows company, city, role, pay, the rules count and freshness", () => {
    render(<Feed cards={SAMPLE_CARDS} variant="home" autoApply address={null} network={false} />);
    const c = SAMPLE_CARDS[0]!;
    const item = itemOf(c.role);
    expect(within(item).getByText(c.company)).toBeTruthy();
    expect(within(item).getByText(c.pay.headline)).toBeTruthy();
    expect(within(item).getByText(c.verdict)).toBeTruthy();
    expect(within(item).getByText(c.fresh)).toBeTruthy();
  });

  it("Apply on a real card creates the application, collapses to a row and counts down", async () => {
    api.postJson.mockResolvedValue(swipeOk);
    const cards = real(2);
    render(<Feed cards={cards} variant="home" autoApply address="rahul.k3x@apply.hirelane.in" network />);
    expect(screen.getByText("rahul.k3x@apply.hirelane.in")).toBeTruthy();
    await userEvent.click(within(itemOf(cards[0]!.role)).getByRole("button", { name: /^Apply/ }));
    expect(api.postJson).toHaveBeenCalledWith("/api/v1/apply/swipe", { jobId: cards[0]!.jobId });
    const row = screen.getByText(`${cards[0]!.role}, Trellis Cloud`, { exact: false }).closest(".st-fdone") as HTMLElement;
    expect(row.textContent).toContain("Applied:");
    expect(row.textContent).toContain("Sends in 4 seconds");
    expect(within(row).getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(screen.queryByRole("article", { name: new RegExp(cards[0]!.role) })).toBeNull();
    expect(screen.getByText("2 left")).toBeTruthy();
    expect(live()).toContain("Applied");
  });

  it("after 4 seconds the row offers the receipt and no more Undo", async () => {
    vi.useFakeTimers();
    api.postJson.mockResolvedValue(swipeOk);
    const cards = real(3);
    render(<Feed cards={cards} variant="home" autoApply address={null} network />);
    await act(async () => {
      fireEvent.click(within(itemOf(cards[0]!.role)).getByRole("button", { name: /^Apply/ }));
    });
    await act(async () => {
      vi.advanceTimersByTime(4100);
    });
    expect(screen.getByRole("link", { name: "See receipt" }).getAttribute("href")).toBe("/tracker/app-1");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.queryByText("Sends in 4 seconds")).toBeNull();
  });

  it("Undo inside the window takes the application back and returns the card", async () => {
    api.postJson.mockImplementation(async (url: string) => (url.endsWith("/swipe") ? swipeOk : { ok: true, status: 200, data: { id: "app-1", status: "undone" }, error: null }));
    const cards = real(4);
    render(<Feed cards={cards} variant="home" autoApply address={null} network />);
    await userEvent.click(within(itemOf(cards[0]!.role)).getByRole("button", { name: /^Apply/ }));
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("article", { name: new RegExp(cards[0]!.role) })).toBeTruthy());
    expect(api.postJson).toHaveBeenCalledWith("/api/v1/apply/applications/app-1/undo");
    expect(screen.getByText("3 left")).toBeTruthy();
  });

  it("when the window has passed, Undo says so and keeps the row", async () => {
    api.postJson.mockImplementation(async (url: string) => (url.endsWith("/swipe") ? swipeOk : { ok: false, status: 409, data: null, error: "conflict" }));
    const cards = real(5);
    render(<Feed cards={cards} variant="home" autoApply address={null} network />);
    await userEvent.click(within(itemOf(cards[0]!.role)).getByRole("button", { name: /^Apply/ }));
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Too late to take that back"));
    expect(screen.getByText(/^Applied:/, { selector: "b" })).toBeTruthy();
  });

  it("an application the server refuses puts the card back and says nothing was sent", async () => {
    api.postJson.mockResolvedValue({ ok: false, status: 503, data: null, error: "auto_apply_off" });
    const cards = real(6);
    render(<Feed cards={cards} variant="home" autoApply address={null} network />);
    await userEvent.click(within(itemOf(cards[0]!.role)).getByRole("button", { name: /^Apply/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("That one didn’t go through"));
    expect(screen.getByRole("alert").textContent).toContain("isn’t switched on yet");
    expect(screen.getByRole("article", { name: new RegExp(cards[0]!.role) })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("Skip and Save never touch the network, remember the choice on this device and both have Undo", async () => {
    const cards = real(7);
    render(<Feed cards={cards} variant="home" autoApply address={null} network />);
    await userEvent.click(within(itemOf(cards[0]!.role)).getByRole("button", { name: /^Skip/ }));
    await userEvent.click(within(itemOf(cards[1]!.role)).getByRole("button", { name: /^Save/ }));
    expect(api.postJson).not.toHaveBeenCalled();
    expect(api.writeSet).toHaveBeenCalledWith("skipped", expect.any(Set));
    expect(api.writeSet).toHaveBeenCalledWith("saved", expect.any(Set));
    expect(screen.getByText(/^Skipped:/, { selector: "b" }).closest(".st-fdone")!.textContent).toContain("Trellis Cloud");
    expect(screen.getByText(/^Saved:/, { selector: "b" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(2);
    expect(screen.getByText("1 left")).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: "Undo" })[0]!);
    expect(screen.getByText("2 left")).toBeTruthy();
    expect(screen.getByRole("article", { name: new RegExp(cards[0]!.role) })).toBeTruthy();
  });

  it("before the pilot the buttons say Get it ready and nothing is sent", async () => {
    const cards = real(8);
    render(<Feed cards={cards} variant="home" autoApply={false} address="rahul.k3x@apply.hirelane.in" network={false} />);
    expect(screen.getAllByRole("button", { name: /Get it ready/ })).toHaveLength(3);
    expect(screen.getByText(/Ready from/)).toBeTruthy();
    await userEvent.click(within(itemOf(cards[0]!.role)).getByRole("button", { name: /Get it ready/ }));
    expect(api.postJson).not.toHaveBeenCalled();
    const row = screen.getByText(/^Ready:/, { selector: "b" }).closest(".st-fdone") as HTMLElement;
    expect(within(row).getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(row.textContent).not.toContain("Sends in");
  });

  it("Details opens the description, chips, rule maths, must-haves, who you know and the posting link", async () => {
    render(<Feed cards={SAMPLE_CARDS} variant="home" autoApply address={null} network={false} />);
    const item = itemOf(SAMPLE_CARDS[0]!.role);
    const toggle = within(item).getByRole("button", { name: /Details/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(item.querySelector(".st-rc.st-open")).not.toBeNull();
  });

  it("an empty feed sends the student somewhere: paste a job", () => {
    render(<Feed cards={[]} variant="home" autoApply={false} address={null} network />);
    expect(screen.getByText("No new roles yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Paste a job/ }).getAttribute("href")).toBe("/paste");
    expect(screen.queryByRole("button", { name: /Skip/ })).toBeNull();
    expect(screen.getByText("0 left")).toBeTruthy();
  });

  it("when the last card is decided the feed says so and points to the Tracker", async () => {
    const cards = real(9).slice(0, 1);
    render(<Feed cards={cards} variant="home" autoApply={false} address={null} network={false} />);
    await userEvent.click(screen.getByRole("button", { name: /^Skip/ }));
    expect(screen.getByText("That’s today’s picks.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /See your Tracker/ }).getAttribute("href")).toBe("/tracker");
  });

  it("a card with no stated pay says so and never estimates", () => {
    render(<Feed cards={[{ ...SAMPLE_CARDS[0]!, pay: { stated: false, headline: "Pay not stated", monthly: null } }]} variant="home" autoApply address={null} network={false} />);
    expect(screen.getByText("Pay not stated")).toBeTruthy();
    expect(screen.getByText(/We never estimate it/)).toBeTruthy();
    expect(screen.queryByText(/LPA/)).toBeNull();
  });

  it("what was skipped earlier today comes back as a Skipped row with Undo", async () => {
    const cards = real(10);
    api.readSet.mockImplementation(((kind: string) => (kind === "skipped" ? new Set([cards[0]!.id]) : new Set())) as never);
    render(<Feed cards={cards} variant="home" autoApply address={null} network />);
    await waitFor(() => expect(screen.getByText(/^Skipped:/, { selector: "b" })).toBeTruthy());
    expect(screen.getByText("2 left")).toBeTruthy();
  });

  it("has no drag, stamps, stacked ghost cards or swipe wording", () => {
    const { container } = render(<Feed cards={SAMPLE_CARDS} variant="picks" autoApply address={null} network={false} />);
    expect(container.querySelector(".st-stamp, .st-deck, .st-bars")).toBeNull();
    expect(container.textContent).not.toMatch(/swipe|drag|arrow key/i);
  });

  it("every action is a real button reachable by keyboard and announced in the live region", async () => {
    const cards = real(11);
    render(<Feed cards={cards} variant="home" autoApply={false} address={null} network={false} />);
    const skip = within(itemOf(cards[0]!.role)).getByRole("button", { name: /^Skip/ });
    expect(skip.tagName).toBe("BUTTON");
    expect(skip.getAttribute("tabindex")).not.toBe("-1");
    skip.focus();
    await userEvent.keyboard("{Enter}");
    expect(live()).toContain("Skipped");
    expect(live()).toContain(cards[0]!.role);
    expect(document.querySelector("[aria-live]")!.getAttribute("aria-live")).toBe("polite");
  });
});

describe("Feed, picks variant", () => {
  it("shows the check panel for the selected card and follows a tap or focus on another card", async () => {
    render(<Feed cards={SAMPLE_CARDS} variant="picks" autoApply address={null} network={false} />);
    const panel = screen.getByText("Your check for this role").closest(".st-pside") as HTMLElement;
    expect(panel).toBeTruthy();
    expect(within(panel).getAllByText("12th: 58%, needs 55%").length).toBeGreaterThan(0);
    expect(within(panel).getByText("The rounds")).toBeTruthy();
    const second = itemOf(SAMPLE_CARDS[1]!.role);
    await userEvent.click(second);
    expect(second.className).toContain("st-sel");
    expect(itemOf(SAMPLE_CARDS[0]!.role).className).not.toContain("st-sel");
  });

  it("the home variant has no side panel", () => {
    render(<Feed cards={SAMPLE_CARDS} variant="home" autoApply address={null} network={false} />);
    expect(screen.queryByText("Your check for this role")).toBeNull();
  });
});
