// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
const api = vi.hoisted(() => ({ postJson: vi.fn(), readSet: vi.fn(() => new Set<string>()), writeSet: vi.fn() }));
vi.mock("@/lib/student/client", () => api);

import { Deck } from "@/components/student/Deck";
import { SAMPLE_CARDS } from "@/lib/student/sample";
import type { CardData } from "@/lib/student/types";

const real = (n: number): CardData[] => SAMPLE_CARDS.map((c, i) => ({ ...c, id: `job-${i}`, jobId: `00000000-0000-4000-8000-00000000000${i + 1}`, role: `${c.role} ${n}` }));

beforeEach(() => {
  api.postJson.mockReset();
  api.readSet.mockReset().mockReturnValue(new Set<string>());
  api.writeSet.mockReset();
  // motion off: cards leave at once so tests do not wait on a timer
  window.matchMedia = ((q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {}, media: q })) as never;
});
afterEach(() => vi.useRealTimers());

const role = () => screen.getByRole("heading", { level: 3 }).textContent;

describe("Deck", () => {
  it("a right swipe on a real card creates the application and says so, with the address it sends from", async () => {
    api.postJson.mockResolvedValue({ ok: true, status: 201, data: { application: { id: "app-1" } }, error: null });
    const cards = real(1);
    render(<Deck cards={cards} variant="home" autoApply address="rahul.k3x@apply.hirelane.in" network />);
    expect(screen.getByText("rahul.k3x@apply.hirelane.in")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Apply/ }));
    expect(api.postJson).toHaveBeenCalledWith("/api/v1/apply/swipe", { jobId: cards[0]!.jobId });
    await waitFor(() => expect(role()).toBe(cards[1]!.role));
    expect(screen.getByRole("status").textContent).toContain(`Applied: ${cards[0]!.role}, Trellis Cloud`);
    expect(screen.getByRole("status").textContent).toContain("Sends from your Hirelane address in 4 seconds");
    expect(screen.getByText("2 of 3")).toBeTruthy();
  });

  it("Undo inside the window takes the application back and returns the card", async () => {
    api.postJson.mockImplementation(async (url: string) => (url.endsWith("/swipe") ? { ok: true, status: 201, data: { application: { id: "app-1" } }, error: null } : { ok: true, status: 200, data: { id: "app-1", status: "undone" }, error: null }));
    const cards = real(2);
    render(<Deck cards={cards} variant="home" autoApply address={null} network />);
    await userEvent.click(screen.getByRole("button", { name: /Apply/ }));
    await waitFor(() => expect(role()).toBe(cards[1]!.role));
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(role()).toBe(cards[0]!.role));
    expect(api.postJson).toHaveBeenCalledWith("/api/v1/apply/applications/app-1/undo");
  });

  it("when the window has passed, Undo says so and does not pretend", async () => {
    api.postJson.mockImplementation(async (url: string) => (url.endsWith("/swipe") ? { ok: true, status: 201, data: { application: { id: "app-1" } }, error: null } : { ok: false, status: 409, data: null, error: "conflict" }));
    const cards = real(3);
    render(<Deck cards={cards} variant="home" autoApply address={null} network />);
    await userEvent.click(screen.getByRole("button", { name: /Apply/ }));
    await waitFor(() => expect(role()).toBe(cards[1]!.role));
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Too late to take that back"));
    expect(role()).toBe(cards[1]!.role);
  });

  it("a swipe the server refuses puts the card back and says nothing was sent", async () => {
    api.postJson.mockResolvedValue({ ok: false, status: 503, data: null, error: "auto_apply_off" });
    const cards = real(4);
    render(<Deck cards={cards} variant="home" autoApply address={null} network />);
    await userEvent.click(screen.getByRole("button", { name: /Apply/ }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("That one didn’t go through"));
    expect(screen.getByRole("status").textContent).toContain("isn’t switched on yet");
    await waitFor(() => expect(role()).toBe(cards[0]!.role));
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("skip and save never touch the network, and remember the choice on this device", async () => {
    const cards = real(5);
    render(<Deck cards={cards} variant="home" autoApply address={null} network />);
    await userEvent.click(screen.getByRole("button", { name: /Skip/ }));
    await waitFor(() => expect(role()).toBe(cards[1]!.role));
    expect(screen.getByRole("status").textContent).toContain("Skipped Trellis Cloud");
    expect(screen.getByRole("status").textContent).toContain("on this device");
    await userEvent.click(screen.getByRole("button", { name: /Save/ }));
    expect(api.postJson).not.toHaveBeenCalled();
    expect(api.writeSet).toHaveBeenCalledWith("skipped", expect.any(Set));
    expect(api.writeSet).toHaveBeenCalledWith("saved", expect.any(Set));
  });

  it("before the pilot the buttons say ready and nothing is sent", async () => {
    const cards = real(6);
    render(<Deck cards={cards} variant="home" autoApply={false} address="rahul.k3x@apply.hirelane.in" network={false} />);
    expect(screen.getByRole("button", { name: /Get it ready/ })).toBeTruthy();
    expect(screen.getByText(/Ready from/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Get it ready/ }));
    expect(api.postJson).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Ready: "));
    expect(screen.getByRole("status").textContent).toContain("Open their form to submit");
  });

  it("arrow keys decide, Space opens the details, Ctrl+Z undoes", async () => {
    const cards = real(7);
    render(<Deck cards={cards} variant="home" autoApply={false} address={null} network={false} />);
    const deck = screen.getByLabelText(/Left arrow skips/);
    deck.focus();
    fireEvent.keyDown(deck, { key: " " });
    expect(screen.getByRole("button", { name: /Details/ }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(deck, { key: "ArrowLeft" });
    await waitFor(() => expect(role()).toBe(cards[1]!.role));
    fireEvent.keyDown(deck, { key: "z", ctrlKey: true });
    await waitFor(() => expect(role()).toBe(cards[0]!.role));
  });

  it("an empty deck sends the student somewhere: paste a job", () => {
    render(<Deck cards={[]} variant="home" autoApply={false} address={null} network />);
    expect(screen.getByText("No new roles yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Paste a job/ }).getAttribute("href")).toBe("/paste");
    expect(screen.queryByRole("button", { name: /Skip/ })).toBeNull();
  });

  it("when the last card is decided the deck says so and points to the Tracker", async () => {
    const cards = real(8).slice(0, 1);
    render(<Deck cards={cards} variant="home" autoApply={false} address={null} network={false} />);
    await userEvent.click(screen.getByRole("button", { name: /Skip/ }));
    await waitFor(() => expect(screen.getByText("That’s today’s picks.")).toBeTruthy());
    expect(screen.getByRole("link", { name: /See your Tracker/ }).getAttribute("href")).toBe("/tracker");
  });

  it("drag past the threshold applies; a short drag springs back", async () => {
    const cards = real(9);
    render(<Deck cards={cards} variant="home" autoApply={false} address={null} network={false} />);
    const card = screen.getByRole("article");
    card.setPointerCapture = vi.fn();
    Object.defineProperty(screen.getByLabelText(/Left arrow skips/), "offsetWidth", { value: 400, configurable: true });
    fireEvent.pointerDown(card, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(card, { clientX: 140, pointerId: 1 });
    fireEvent.pointerUp(card, { clientX: 140, pointerId: 1 });
    expect(role()).toBe(cards[0]!.role);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    fireEvent.pointerDown(card, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(card, { clientX: 300, pointerId: 1 });
    fireEvent.pointerUp(card, { clientX: 300, pointerId: 1 });
    await waitFor(() => expect(role()).toBe(cards[1]!.role));
    expect(screen.getByRole("status").textContent).toContain("Ready: ");
  });

  it("the picks variant lists every role, shows the maths on the side and opens details by itself", () => {
    render(<Deck cards={SAMPLE_CARDS} variant="picks" autoApply address={null} network={false} />);
    expect(screen.getAllByRole("button", { name: /LPA/ })).toHaveLength(3);
    expect(screen.getByText("Your check for this role")).toBeTruthy();
    expect(screen.getAllByText("12th: 58%, needs 55%").length).toBeGreaterThan(0);
    expect(screen.getByText("The rounds")).toBeTruthy();
  });

  it("a card with no stated pay says so and never estimates", () => {
    render(<Deck cards={[{ ...SAMPLE_CARDS[0]!, pay: { stated: false, headline: "Pay not stated", monthly: null } }]} variant="home" autoApply address={null} network={false} />);
    expect(screen.getByText("Pay not stated")).toBeTruthy();
    expect(screen.getByText(/We never estimate it/)).toBeTruthy();
    expect(screen.queryByText(/LPA/)).toBeNull();
  });

  it("what was skipped earlier today stays out of the deck", async () => {
    const cards = real(10);
    api.readSet.mockImplementation(((kind: string) => (kind === "skipped" ? new Set([cards[0]!.id]) : new Set())) as never);
    render(<Deck cards={cards} variant="home" autoApply address={null} network />);
    await waitFor(() => expect(role()).toBe(cards[1]!.role));
    await act(async () => {});
  });
});
