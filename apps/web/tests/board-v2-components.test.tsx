// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardRow } from "../components/board/row-model";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const actions = vi.hoisted(() => ({ loadMoreJobs: vi.fn(), loadJobPreview: vi.fn(), suggestJobs: vi.fn() }));
vi.mock("../app/jobs/actions", () => actions);

import { JobBoard } from "../components/board/job-board";
import { PreviewPanel } from "../components/board/preview-panel";
import { SearchBox } from "../components/board/search-box";

const row = (n: number, over: Partial<BoardRow> = {}): BoardRow => ({
  slug: `job-${n}`,
  title: `Role ${n}`,
  company: { slug: `co-${n}`, name: `Company ${n}`, logoPath: null },
  chips: ["IN", "Hybrid"],
  pay: "$100K-120K/yr",
  payNote: null,
  age: "2h",
  freshAt: "2026-10-16T10:00:00Z",
  fresh: "new",
  skills: ["Python", "SQL"],
  ats: "greenhouse",
  level: null,
  employment: null,
  ...over,
});
const preview = (slug: string) => ({
  slug,
  trace: [{ label: "Found 100-120K", ruleId: "salary.range.dash" }],
  requirements: [{ kind: "must" as const, text: `Needs SQL for ${slug}`, category: "skill", yearsMin: 3 }],
  requirementsTotal: 5,
  applyUrl: `https://boards.greenhouse.io/acme/jobs/${slug}`,
});

function wide(matches: boolean) {
  window.matchMedia = ((q: string) => ({ matches, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  vi.resetAllMocks();
  // the test IntersectionObserver fires at once, so the board auto-loads; default to an empty last page
  actions.loadMoreJobs.mockResolvedValue({ rows: [], page: 2, hasMore: false });
  wide(true);
});

describe("PreviewPanel", () => {
  it("shows the pay trace, requirements and a safe employer link", () => {
    render(<PreviewPanel row={row(1)} data={preview("job-1")} loading={false} />);
    expect(screen.getByTestId("preview-title")).toHaveTextContent("Role 1");
    expect(screen.getByTestId("preview-trace")).toHaveTextContent("Found 100-120K");
    expect(screen.getByTestId("preview-trace")).toHaveTextContent("1 of 1 steps");
    expect(screen.getByTestId("preview-requirements")).toHaveTextContent("Needs SQL for job-1");
    expect(screen.getByText("4 more on the full posting.", { exact: false })).toBeInTheDocument();
    const apply = screen.getByTestId("preview-apply");
    expect(apply).toHaveAttribute("href", "https://boards.greenhouse.io/acme/jobs/job-1");
    expect(apply).toHaveAttribute("target", "_blank");
    expect(apply.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText(/Hirelane sends nothing/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Full posting/ })).toHaveAttribute("href", "/job/job-1");
  });
  it("says so when pay is not stated, and never invents a number", () => {
    render(<PreviewPanel row={row(1, { pay: null })} data={preview("job-1")} loading={false} />);
    expect(screen.getByText(/Not stated in the posting/)).toBeInTheDocument();
    expect(screen.queryByTestId("preview-trace")).toBeNull();
  });
  it("shows skeletons and a disabled handoff while loading, and an honest note when details are unavailable", () => {
    const { rerender } = render(<PreviewPanel row={row(1)} data={null} loading />);
    expect(screen.queryByTestId("preview-apply")).toBeNull();
    expect(screen.getByText("Finding the employer link")).toHaveAttribute("aria-disabled", "true");
    rerender(<PreviewPanel row={row(1)} data={null} loading={false} />);
    expect(screen.getByText(/Details are not available/)).toBeInTheDocument();
    expect(screen.getByText("Employer link unavailable")).toBeInTheDocument();
  });
  it("renders an invitation when nothing is selected", () => {
    render(<PreviewPanel row={null} data={null} loading={false} />);
    expect(screen.getByTestId("job-preview-empty")).toHaveTextContent("Hover or focus a role");
  });
});

describe("JobBoard", () => {
  const props = (over = {}) => ({
    initialRows: [row(1), row(2), row(3)],
    initialPreviews: { "job-1": preview("job-1") },
    total: 7,
    page: 1,
    hasMore: true,
    qs: "remote=1",
    pageSize: 3,
    ...over,
  });

  it("previews the first row on load, then follows hover and focus without navigating", async () => {
    actions.loadJobPreview.mockImplementation(async (slug: string) => preview(slug));
    render(<JobBoard {...props()} />);
    const panel = () => screen.getByTestId("job-preview");
    expect(panel()).toHaveAttribute("data-slug", "job-1");

    const rows = screen.getAllByRole("listitem").filter((li) => li.hasAttribute("data-slug"));
    fireEvent.mouseEnter(rows[1]!);
    await waitFor(() => expect(panel()).toHaveAttribute("data-slug", "job-2"));
    await waitFor(() => expect(screen.getByTestId("preview-requirements")).toHaveTextContent("job-2"));
    expect(actions.loadJobPreview).toHaveBeenCalledWith("job-2");

    within(rows[2]!).getByRole("link", { name: "Role 3" }).focus();
    await waitFor(() => expect(panel()).toHaveAttribute("data-slug", "job-3"));
    // a pointer resting under keyboard-scrolled rows must not steal the preview
    fireEvent.mouseEnter(rows[1]!);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(panel()).toHaveAttribute("data-slug", "job-3");
    // after the grace period hover works again, and a job already fetched is not refetched
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    fireEvent.mouseEnter(rows[1]!);
    await waitFor(() => expect(panel()).toHaveAttribute("data-slug", "job-2"));
    expect(actions.loadJobPreview).toHaveBeenCalledTimes(2);
  });

  it("does not fetch previews below the xl breakpoint", async () => {
    wide(false);
    render(<JobBoard {...props()} />);
    const rows = screen.getAllByRole("listitem").filter((li) => li.hasAttribute("data-slug"));
    fireEvent.focus(within(rows[1]!).getByRole("link", { name: "Role 2" }));
    await act(async () => {});
    expect(actions.loadJobPreview).not.toHaveBeenCalled();
  });

  it("loads more pages, appends without duplicates, and stops when there is no more", async () => {
    actions.loadMoreJobs.mockResolvedValueOnce({ rows: [row(3), row(4), row(5)], page: 2, hasMore: true });
    actions.loadMoreJobs.mockResolvedValueOnce({ rows: [row(6), row(7)], page: 3, hasMore: false });
    render(<JobBoard {...props()} />);
    const btn = screen.getByTestId("jobs-load-more");
    expect(btn).toHaveAttribute("href", "/jobs?remote=1&page=2");
    // IntersectionObserver in the test setup fires at once, so the first page may already be loading; click is idempotent
    await userEvent.click(btn);
    await waitFor(() => expect(screen.getAllByRole("link", { name: /^Role \d$/ })).toHaveLength(7));
    expect(actions.loadMoreJobs).toHaveBeenNthCalledWith(1, "remote=1", 2);
    await waitFor(() => expect(screen.queryByTestId("jobs-load-more")).toBeNull());
    expect(screen.getByTestId("jobs-shown")).toHaveTextContent("Showing 1 to 7 of 7");
  });

  it("offers a retry when loading fails", async () => {
    actions.loadMoreJobs.mockRejectedValue(new Error("boom"));
    render(<JobBoard {...props({ hasMore: true })} />);
    await waitFor(() => expect(screen.getByTestId("jobs-load-more")).toHaveTextContent("Could not load, try again"));
    expect(screen.getAllByRole("link", { name: /^Role \d$/ })).toHaveLength(3);
  });

  it("links to the previous page on a deep page", () => {
    render(<JobBoard {...props({ page: 3, hasMore: false })} />);
    expect(screen.getByRole("link", { name: "Previous page" })).toHaveAttribute("href", "/jobs?remote=1&page=2");
    expect(screen.getByTestId("jobs-shown")).toHaveTextContent("Showing 7 to 9 of 7");
  });
});

describe("SearchBox", () => {
  it("is a GET form carrying the other filters, so it works without JavaScript", () => {
    render(<SearchBox defaultValue="data" carry={[["remote", "1"], ["sort", "pay"]]} />);
    const input = screen.getByRole("combobox");
    expect(input).toHaveValue("data");
    expect(input.closest("form")).toHaveAttribute("action", "/jobs");
    expect(input.closest("form")).toHaveAttribute("method", "get");
    expect(document.querySelector('input[type="hidden"][name="remote"]')).toHaveValue("1");
    expect(input).toHaveAttribute("id", "board-q");
  });

  it("suggests after two characters, navigates by keyboard, and keeps filters on a title", async () => {
    actions.suggestJobs.mockResolvedValue({
      companies: [{ slug: "acme", name: "Acme Labs", logoPath: null, open: 12 }],
      titles: [{ title: "Data Engineer", n: 40 }],
    });
    render(<SearchBox defaultValue="" carry={[["remote", "1"]]} />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "d");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(actions.suggestJobs).not.toHaveBeenCalled();
    await userEvent.type(input, "a");
    const opts = await screen.findAllByRole("option");
    expect(opts).toHaveLength(2);
    expect(input).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(opts[1]).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Enter}");
    expect(push).toHaveBeenCalledTimes(1);
    const url = new URL(push.mock.calls[0]![0] as string, "http://x");
    expect(url.pathname).toBe("/jobs");
    expect(url.searchParams.get("q")).toBe("data engineer");
    expect(url.searchParams.get("remote")).toBe("1");
  });

  it("goes to the company page when a company is chosen, and Escape closes the list", async () => {
    actions.suggestJobs.mockResolvedValue({ companies: [{ slug: "acme", name: "Acme Labs", logoPath: null, open: 1 }], titles: [] });
    render(<SearchBox defaultValue="" carry={[]} />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "ac");
    const [opt] = await screen.findAllByRole("option");
    fireEvent.pointerDown(opt!);
    expect(push).toHaveBeenCalledWith("/company/acme");
    await userEvent.type(input, "m");
    await screen.findAllByRole("option");
    await userEvent.keyboard("{Escape}");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("says plainly when nothing matches", async () => {
    actions.suggestJobs.mockResolvedValue({ companies: [], titles: [] });
    render(<SearchBox defaultValue="" carry={[]} />);
    await userEvent.type(screen.getByRole("combobox"), "zz");
    expect(await screen.findByText(/No title or company starts like that/)).toBeInTheDocument();
  });

  it("ignores a slow answer that arrives after a newer one", async () => {
    let slow!: (v: unknown) => void;
    actions.suggestJobs
      .mockImplementationOnce(() => new Promise((r) => (slow = r)))
      .mockResolvedValueOnce({ companies: [], titles: [{ title: "Newer", n: 1 }] });
    render(<SearchBox defaultValue="" carry={[]} />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "ab");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    await userEvent.type(input, "c");
    expect(await screen.findByText("Newer")).toBeInTheDocument();
    await act(async () => slow({ companies: [], titles: [{ title: "Stale", n: 9 }] }));
    expect(screen.queryByText("Stale")).toBeNull();
  });
});
