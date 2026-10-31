// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({ Public_Sans: () => ({ variable: "v", className: "c" }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const loaders = vi.hoisted(() => ({
  loadHome: vi.fn(),
  loadDrives: vi.fn(),
  loadTracker: vi.fn(),
  loadCampusOverview: vi.fn(),
  loadCampusStudents: vi.fn(),
  loadCampusOutcomes: vi.fn(),
}));
vi.mock("@/lib/adapters/load", () => loaders);

import Home from "@/app/(app)/home/page";
import Drives from "@/app/(app)/drives/page";
import Tracker from "@/app/(app)/tracker/page";
import Students from "@/app/campus/students/page";
import Outcomes from "@/app/campus/outcomes/page";
import { SAMPLE_HOME } from "@/lib/sample/home";

beforeEach(() => vi.clearAllMocks());

describe("wired pages", () => {
  it("Home: sample source shows the labelled sample, real source shows the student's data without the note", async () => {
    loaders.loadHome.mockResolvedValueOnce({ source: "sample" });
    const a = render(await Home());
    expect(screen.getByText(/Sample student/)).toBeTruthy();
    expect(screen.getByText(`Good morning, ${SAMPLE_HOME.firstName}`)).toBeTruthy();
    a.unmount();
    loaders.loadHome.mockResolvedValueOnce({ source: "real", data: { home: { ...SAMPLE_HOME, sample: false, firstName: "Asha", drives: [] } } });
    render(await Home());
    expect(screen.getByText("Good morning, Asha")).toBeTruthy();
    expect(screen.queryByText(/Sample student/)).toBeNull();
  });

  it("Drives: real drives replace the sample and the sample line disappears", async () => {
    loaders.loadDrives.mockResolvedValueOnce({
      source: "real",
      data: { initial: "A", drives: [{ id: "d", company: "Your placement cell", role: "Teller", ctc: null, deadlineLabel: "x", daysLeft: 3, status: "eligible", headline: "You meet all 1 rule", rules: [{ text: "55%", status: "pass" }] }] },
    });
    render(await Drives());
    expect(screen.getByText("Teller")).toBeTruthy();
    expect(screen.queryByText(/Sample drives/)).toBeNull();
    expect(screen.queryByText("Process Associate")).toBeNull();
  });

  it("Tracker: an empty real list is empty, not sample", async () => {
    loaders.loadTracker.mockResolvedValueOnce({ source: "real", data: { initial: "A", items: [] } });
    render(await Tracker());
    expect(screen.getByText(/0 this week/)).toBeTruthy();
    expect(screen.queryByText("Zenoti")).toBeNull();
  });

  it("Students and Outcomes: sample keeps the note, real drops it", async () => {
    loaders.loadCampusStudents.mockResolvedValueOnce({ source: "sample" });
    const a = render(await Students());
    expect(screen.getByText(/Sample cohort for demos/)).toBeTruthy();
    a.unmount();
    loaders.loadCampusStudents.mockResolvedValueOnce({ source: "real", data: { college: "Sample University", rows: [{ programme: "B.Com (2026)", finalYears: 100, joined: 60, ready: 40, eligible: 0, applied: 0, interviews: 12, offers: 10 }] } });
    const b = render(await Students());
    expect(screen.queryByText(/Sample cohort for demos/)).toBeNull();
    expect(screen.getByText("B.Com (2026)")).toBeTruthy();
    b.unmount();
    loaders.loadCampusOutcomes.mockResolvedValueOnce({ source: "real", data: { college: "Sample University", offers: [], outgoing: 100 } });
    render(await Outcomes());
    expect(screen.queryByText(/Sample cohort for demos/)).toBeNull();
  });
});
