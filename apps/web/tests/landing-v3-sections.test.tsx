// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLANS, priceFor } from "../components/landing/pricing-model";
import { LandingHeader } from "../components/landing-v3/header";
import { PricingPanel } from "../components/landing-v3/sections/pricing-panel";
import { YourRule, CompanyCloud, LiveBoard } from "../components/landing-v3/sections/moments-panels";
import { parsePerWeek, ruleUrl, RULE_DEBOUNCE_MS } from "../components/landing-v3/sections/rule-model";
import { StartPanelView } from "../components/landing-v3/sections/start-panel";

vi.mock("next/image", () => ({
  default: ({ fill: _f, priority: _p, ...props }: Record<string, unknown>) => <img alt="" {...(props as object)} />,
}));

const basic = PLANS.find((p) => p.code === "basic")!;

describe("pricing panel", () => {
  it("opens on Basic monthly in the visitor's currency and shows values from pricing-model", () => {
    render(<PricingPanel initialCurrency="INR" />);
    const want = priceFor(basic, "monthly", "INR")!;
    expect(screen.getByTestId("price")).toHaveTextContent(want.price);
    expect(screen.getByTestId("apps")).toHaveTextContent(`${want.applications} applications`);
    expect(screen.getByTestId("per-app")).toHaveTextContent(want.perApplication);
    expect(screen.getByRole("radio", { name: "Basic" })).toBeChecked();
    expect(screen.getByText("Planned prices. Checkout opens soon.")).toBeInTheDocument();
  });

  it("switches plan, period and currency", async () => {
    const user = userEvent.setup();
    render(<PricingPanel initialCurrency="USD" />);
    await user.click(screen.getByRole("radio", { name: "Ultra" }));
    await user.click(within(screen.getByRole("radiogroup", { name: "Billing period" })).getByRole("radio", { name: "Quarterly" }));
    const ultra = PLANS.find((p) => p.code === "ultra")!;
    await waitFor(() => expect(screen.getByTestId("price")).toHaveTextContent(priceFor(ultra, "quarterly", "USD")!.price));
    await user.click(within(screen.getByRole("radiogroup", { name: "Currency" })).getByRole("radio", { name: "INR" }));
    await waitFor(() => expect(screen.getByTestId("price")).toHaveTextContent(priceFor(ultra, "quarterly", "INR")!.price));
    expect(screen.getByTestId("per-app")).toHaveTextContent(priceFor(ultra, "quarterly", "INR")!.perApplication);
  });

  it("shows Free with its lifetime allowance and disables the period toggle", async () => {
    const user = userEvent.setup();
    render(<PricingPanel initialCurrency="USD" />);
    await user.click(screen.getByRole("radio", { name: "Free" }));
    await waitFor(() => expect(screen.getByTestId("price")).toHaveTextContent("Free"));
    expect(screen.getByTestId("apps")).toHaveTextContent("10 applications");
    expect(screen.queryByTestId("per-app")).toBeNull();
    for (const r of within(screen.getByRole("radiogroup", { name: "Billing period" })).getAllByRole("radio")) expect(r).toBeDisabled();
  });

  it("keeps the current choice when the active toggle is pressed again", async () => {
    const user = userEvent.setup();
    render(<PricingPanel initialCurrency="USD" />);
    const usd = within(screen.getByRole("radiogroup", { name: "Currency" })).getByRole("radio", { name: "USD" });
    await user.click(usd);
    expect(usd).toBeChecked();
  });

  it("moves between plans with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<PricingPanel initialCurrency="USD" />);
    screen.getByRole("radio", { name: "Basic" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Pro" })).toBeChecked();
  });
});

describe("rule model", () => {
  it("sends only min, clamped to 0-100", () => {
    expect(ruleUrl(55)).toBe("/api/public/stats/autopilot?min=55");
    expect(ruleUrl(250)).toBe("/api/public/stats/autopilot?min=100");
    expect(ruleUrl(-3)).toBe("/api/public/stats/autopilot?min=0");
    expect(ruleUrl(Number.NaN)).toBe("/api/public/stats/autopilot?min=70");
  });
  it("reads perWeek only when it is a real number", () => {
    expect(parsePerWeek({ perWeek: 412 })).toBe(412);
    expect(parsePerWeek({ perWeek: "412" })).toBeNull();
    expect(parsePerWeek(null)).toBeNull();
  });
});

describe("your rule slider", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const okJson = (n: number) => ({ ok: true, json: async () => ({ perWeek: n }) }) as Response;
  const slider = () => screen.getByRole("slider");

  it("renders the server number without fetching on mount", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<YourRule initialPerWeek={1234} />);
    expect(screen.getByTestId("rule-number")).toHaveTextContent("1,234");
    act(() => vi.advanceTimersByTime(1000));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("debounces, requests only ?min=, and aborts the previous request", async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      signals.push(init!.signal!);
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<YourRule initialPerWeek={100} />);
    slider().focus();
    fireEvent.keyDown(slider(), { key: "ArrowLeft" }); // 70 -> 65
    fireEvent.keyDown(slider(), { key: "ArrowLeft" }); // 65 -> 60
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(RULE_DEBOUNCE_MS + 10));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/public/stats/autopilot?min=60");
    fireEvent.keyDown(slider(), { key: "ArrowLeft" }); // 55
    expect(signals[0]!.aborted).toBe(true);
    act(() => vi.advanceTimersByTime(RULE_DEBOUNCE_MS + 10));
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/public/stats/autopilot?min=55");
  });

  it("shows the new number, and keeps the last one when the request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okJson(321)).mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) }).mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    render(<YourRule initialPerWeek={100} />);
    slider().focus();
    fireEvent.keyDown(slider(), { key: "ArrowLeft" });
    await act(async () => void vi.advanceTimersByTime(RULE_DEBOUNCE_MS + 10));
    await waitFor(() => expect(screen.getByTestId("rule-number")).toHaveTextContent("321"));
    fireEvent.keyDown(slider(), { key: "ArrowLeft" });
    await act(async () => void vi.advanceTimersByTime(RULE_DEBOUNCE_MS + 10));
    fireEvent.keyDown(slider(), { key: "ArrowLeft" });
    await act(async () => void vi.advanceTimersByTime(RULE_DEBOUNCE_MS + 10));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("rule-number")).toHaveTextContent("321");
  });

  it("fetches on mount when the server had no number", () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    render(<YourRule initialPerWeek={null} />);
    act(() => vi.advanceTimersByTime(RULE_DEBOUNCE_MS + 10));
    expect(fetchMock).toHaveBeenCalledWith("/api/public/stats/autopilot?min=70", expect.anything());
  });
});

describe("moment panels", () => {
  it("names the first two companies and counts the rest from the database total", () => {
    const companies = Array.from({ length: 12 }, (_, i) => ({ name: `Co${i}`, openRoles: 100 - i }));
    render(<CompanyCloud companies={companies} totalCompanies={117} />);
    expect(screen.getByText(/Reading open roles at/).textContent).toBe("Reading open roles at Co0, Co1 and 115 more.");
    expect(screen.getAllByRole("listitem")).toHaveLength(12);
  });
  it("lists at most the jobs it is given, each linking to its job page", () => {
    const jobs = Array.from({ length: 6 }, (_, i) => ({ slug: `job-${i}`, title: `Role ${i}`, company: `Co${i}`, logoPath: null, freshAt: "2026-10-16T08:00:00.000Z" }));
    render(<LiveBoard jobs={jobs} openJobs={16320} nowIso="2026-10-16T10:00:00.000Z" />);
    expect(screen.getByText(/roles\. Refreshed every six hours\./).textContent).toBe("16,320 roles. Refreshed every six hours.");
    expect(screen.getAllByRole("link", { name: /Role 0/ })[0]).toHaveAttribute("href", "/job/job-0");
    expect(screen.getAllByText("2h ago").length).toBeGreaterThan(0);
  });
});

describe("start panel", () => {
  const pdf = () => new File(["%PDF-1.7\n..."], "cv.pdf", { type: "application/pdf" });
  let spies: ReturnType<typeof vi.fn>[];
  beforeEach(() => {
    const f = vi.fn();
    const b = vi.fn();
    vi.stubGlobal("fetch", f);
    Object.defineProperty(navigator, "sendBeacon", { value: b, configurable: true });
    const xhr = vi.fn();
    vi.stubGlobal("XMLHttpRequest", xhr);
    spies = [f, b, xhr];
  });
  afterEach(() => vi.unstubAllGlobals());
  const input = () => screen.getByLabelText("Resume PDF") as HTMLInputElement;
  const noNetwork = () => spies.forEach((s) => expect(s).not.toHaveBeenCalled());

  it("is the #start section with its heading", () => {
    const { container } = render(<StartPanelView />);
    expect(container.querySelector("#start")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Start with your resume." })).toBeInTheDocument();
  });

  it("rejects a text file", async () => {
    render(<StartPanelView />);
    fireEvent.change(input(), { target: { files: [new File(["hello"], "notes.txt", { type: "text/plain" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("not a PDF");
    expect(screen.queryByTestId("resume-parse")).toBeNull();
    noNetwork();
  });

  it("rejects a .pdf whose bytes are not a PDF", async () => {
    render(<StartPanelView />);
    fireEvent.change(input(), { target: { files: [new File(["<html>nope</html>"], "fake.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("not a PDF");
    expect(screen.queryByTestId("resume-parse")).toBeNull();
    noNetwork();
  });

  it("parses a real PDF into a card with 6 skill chips and a disabled account button, and uploads nothing", async () => {
    render(<StartPanelView />);
    fireEvent.change(input(), { target: { files: [pdf()] } });
    expect(await screen.findByTestId("resume-parse")).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByTestId("parse-skills")).getAllByRole("listitem")).toHaveLength(6), { timeout: 5000 });
    expect(await screen.findByText("Create your account to save this. Coming in the next release.", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create your account" })).toBeDisabled();
    noNetwork();
  });

  it("goes back to the drop zone with Try another PDF", async () => {
    const user = userEvent.setup();
    render(<StartPanelView />);
    fireEvent.change(input(), { target: { files: [pdf()] } });
    await user.click(await screen.findByRole("button", { name: /Try another PDF/ }, { timeout: 5000 }));
    expect(screen.getByTestId("drop-zone")).toBeInTheDocument();
  });
}, 20000);

describe("landing header", () => {
  const setY = (y: number) => {
    Object.defineProperty(window, "scrollY", { value: y, configurable: true });
    fireEvent.scroll(window);
  };
  afterEach(() => setY(0));

  it("is transparent at the top and a panel after scroll", () => {
    render(<LandingHeader />);
    const header = document.querySelector("[data-site-header]")!;
    expect(header).toHaveAttribute("data-solid", "false");
    expect(header.firstElementChild!.className).toContain("bg-transparent");
    setY(400);
    expect(header).toHaveAttribute("data-solid", "true");
    expect(header.firstElementChild!.className).toContain("backdrop-blur");
  });

  it("has the wordmark, Jobs, Pricing and Start free", () => {
    render(<LandingHeader />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Jobs" })).toHaveAttribute("href", "/jobs");
    expect(within(nav).getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "/#pricing");
    expect(within(nav).getByRole("link", { name: "Start free" })).toHaveAttribute("href", "/#start");
    expect(screen.getByRole("link", { name: "hirelane home" })).toHaveAttribute("href", "/");
  });

  it("opens a menu sheet that closes on Escape and returns focus to the button", async () => {
    const user = userEvent.setup();
    render(<LandingHeader />);
    const trigger = screen.getByRole("button", { name: "Open menu" });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Menu" });
    expect(dialog).toHaveAttribute("data-landing", "v3");
    expect(within(dialog).getByRole("link", { name: "Start free" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("keeps focus inside the open sheet", async () => {
    const user = userEvent.setup();
    render(<LandingHeader />);
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const dialog = await screen.findByRole("dialog", { name: "Menu" });
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });
});
