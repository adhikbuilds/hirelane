// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Public_Sans: () => ({ variable: "v", className: "c" }),
  Geist: () => ({ variable: "g" }),
  Geist_Mono: () => ({ variable: "gm" }),
  Bricolage_Grotesque: () => ({ variable: "b" }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const loaders = vi.hoisted(() => ({
  loadCampusOverview: vi.fn(),
  loadCampusStudents: vi.fn(),
  loadCampusOutcomes: vi.fn(),
}));
vi.mock("@/lib/adapters/load", () => loaders);
const student = vi.hoisted(() => ({ loadStudentHome: vi.fn(), loadStudentDrives: vi.fn(), loadStudentTracker: vi.fn() }));
vi.mock("@/lib/student/load", () => student);

import Home from "@/app/(app)/home/page";
import Drives from "@/app/(app)/drives/page";
import Tracker from "@/app/(app)/tracker/page";
import Students from "@/app/campus/students/page";
import Outcomes from "@/app/campus/outcomes/page";
import { SAMPLE_HOME } from "@/lib/student/sample";
import { toDriveViews, toTrackerView } from "@/lib/student/map";

beforeEach(() => vi.clearAllMocks());

describe("wired pages", () => {
  it("Home: sample source shows the labelled sample, real source shows the student's data without the note", async () => {
    student.loadStudentHome.mockResolvedValueOnce({ source: "sample" });
    const a = render(await Home());
    expect(screen.getByText(/Sample student/)).toBeTruthy();
    expect(screen.getByText(`Good morning, ${SAMPLE_HOME.firstName}`)).toBeTruthy();
    a.unmount();
    student.loadStudentHome.mockResolvedValueOnce({ source: "real", data: { ...SAMPLE_HOME, sample: false, firstName: "Asha", drives: [], codes: [], finish: [], cards: [] } });
    render(await Home());
    expect(screen.getByText("Good morning, Asha")).toBeTruthy();
    expect(screen.queryByText(/Sample student/)).toBeNull();
    expect(screen.queryByText("Trellis Cloud")).toBeNull();
  });

  it("Drives: real drives replace the sample and the sample college line disappears", async () => {
    const drives = toDriveViews([{ id: "d", title: "Teller", link: null, noticeText: "", deadline: "2026-11-03", rounds: null, documents: null, publishedAt: "2026-10-28T05:00:00.000Z", verdict: "eligible", reasons: ["55% in 12th"] }], new Date("2026-10-29T04:00:00Z"));
    student.loadStudentDrives.mockResolvedValueOnce({ source: "real", data: { initial: "A", badge: 0, college: "Real College", drives } });
    const { container } = render(await Drives({ searchParams: Promise.resolve({}) }));
    expect(screen.getAllByText("Teller").length).toBeGreaterThan(0);
    expect(screen.getByText("Real College")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Sample University|Process Associate/);
  });

  it("Tracker: an empty real list is empty, not sample", async () => {
    student.loadStudentTracker.mockResolvedValueOnce({ source: "real", data: { initial: "A", badge: 0, view: toTrackerView([], [], new Date("2026-10-29T04:00:00Z")), selected: null, message: null } });
    render(await Tracker({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Nothing here yet")).toBeTruthy();
    expect(screen.queryByText("Kosha Payments")).toBeNull();
    expect(screen.queryByText(/Sample student/)).toBeNull();
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
