// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Public_Sans: () => ({ variable: "v", className: "c" }),
  Geist: () => ({ variable: "g" }),
  Geist_Mono: () => ({ variable: "gm" }),
  Bricolage_Grotesque: () => ({ variable: "b" }),
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { DrivesList, Tracker } from "@/components/app/DrivesTracker";
import { CampusDash } from "@/components/campus/Dash";
import { OutcomesPage, StudentsPage } from "@/components/campus/Pages";
import { HomeA } from "@/components/student/HomeA";
import { toCampusOverview, toProgrammeRows } from "@/lib/adapters/campus";
import { toHomeView } from "@/lib/student/map";

const NOW = new Date("2026-10-29T04:00:00Z");
const me = { id: "u", email: "s@example.test", displayName: null, role: "student", createdAt: "2026-10-01T00:00:00.000Z" };

describe("the unedited components accept empty real data", () => {
  it("HomeA renders a brand-new student: no deck, zero counts, no resume", () => {
    const data = toHomeView({ me, picks: { placed: false, date: "2026-10-29", picks: [] }, apps: [], inbox: [], drives: [], resumes: [], settings: { autoApply: false, applyAddress: null }, now: NOW });
    render(<HomeA data={data} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Good morning, there");
    expect(screen.getByText(/0 applied this week, 0 replies/)).toBeTruthy();
    expect(screen.getByText("No new roles yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Paste a job/ })).toHaveProperty("href", expect.stringContaining("/paste"));
    expect(screen.queryByText(/Sample student/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/NaN|Infinity|undefined/);
  });
  it("Drives and Tracker render empty lists", () => {
    render(
      <>
        <DrivesList drives={[]} />
        <Tracker items={[]} />
      </>,
    );
    expect(screen.getByText(/0 this week/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/NaN|Infinity|undefined/);
  });
  it("the console overview renders with no cohorts and with an all-hidden cohort", () => {
    const empty = toCampusOverview({ campusName: "Sample University", cohorts: [], stats: {}, drives: [], counts: {} });
    const { unmount } = render(<CampusDash data={empty} by="programme" />);
    expect(screen.queryByText(/Sample cohort for demos/)).toBeNull();
    unmount();
    const hidden = toCampusOverview({
      campusName: "Sample University",
      cohorts: [{ id: "c1", passoutYear: 2026, programme: "B.Com", rosterSize: 9, snapshotDay: null, joined: null, joinedSuppressed: true }],
      stats: { c1: { day: null, metrics: [] } },
      drives: [],
      counts: {},
    });
    render(<CampusDash data={hidden} by="blocker" />);
    expect(document.body.textContent).not.toMatch(/NaN|Infinity|undefined/);
  });
  it("Students and Outcomes render a hidden row and no offers", () => {
    const rows = toProgrammeRows({ cohorts: [{ id: "c1", passoutYear: 2026, programme: "BBA", rosterSize: 9, snapshotDay: null, joined: null, joinedSuppressed: true }], stats: {} });
    render(
      <>
        <StudentsPage rows={rows} />
        <OutcomesPage offers={[]} outgoing={0} higherStudies={0} />
      </>,
    );
    expect(document.body.textContent).not.toMatch(/NaN|Infinity|undefined/);
  });
});
