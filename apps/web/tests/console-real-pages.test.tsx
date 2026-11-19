// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

import { CampusDash } from "@/components/campus/Dash";
import { OutcomesPage, SettingsPage, StudentsPage } from "@/components/campus/Pages";
import type { CampusOverview } from "@/lib/sample/campus";

afterEach(cleanup);

/** Strings that exist only in the sample figures. None may reach a real screen. */
const SAMPLE_ONLY = [/Bank drive closed/, /Mass recruiter/, /B\.Com \(General\)/, /Process Associate/, /K7Q2/, /sampleuniversity/, /Sample University/, /Batch of 2026/, /27 students/, /\b268\b/, /\b412\b/];

const REAL: CampusOverview = {
  sample: false,
  college: "Real College",
  cohort: "B.Sc, batch of 2027",
  asOf: "2 Nov",
  finalYears: 60,
  joined: 42,
  placedOnCampus: 0,
  offCampusOffers: { total: 0, verified: 0 },
  funnel: [{ label: "Joined Hirelane", count: 42, action: "Invite the other 18" }],
  stuck: [{ blocker: "Active backlogs", students: 14, action: "Point them to drives with no backlog rule" }],
  hiddenGroups: 0,
  drives: [],
  programmes: [{ name: "B.Sc (2027)", joined: 42, offers: null }],
};

describe("console screens print no sample figure on real data", () => {
  it("overview", () => {
    const { container } = render(<CampusDash data={REAL} by="programme" />);
    for (const re of SAMPLE_ONLY) expect(container.textContent, String(re)).not.toMatch(re);
    expect(container.textContent).toContain("B.Sc (2027)");
    expect(container.textContent).toMatch(/active backlogs/i);
    expect(container.querySelector("svg.dk-chart")).toBeNull(); // the weekly chart has no data source
    expect(container.textContent).not.toMatch(/verified by you/);
    expect(container.querySelectorAll('a[href="#"]')).toHaveLength(0);
  });

  it("students: no 'Batch of 2026', no Eligible or Applied columns we cannot fill, a real import control", () => {
    const { container } = render(<StudentsPage real cohorts={[{ id: "c1", label: "B.Sc (2027)" }]} rows={[{ programme: "B.Sc (2027)", finalYears: 60, joined: 42, ready: 20, eligible: 0, applied: 0, interviews: 11, offers: 10 }]} />);
    expect(container.textContent).not.toMatch(/Batch of 2026/);
    const heads = [...container.querySelectorAll("th")].map((t) => t.textContent);
    expect(heads).not.toContain("Eligible");
    expect(heads).not.toContain("Applied");
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
    expect(container.querySelectorAll('a[href="#"]')).toHaveLength(0);
  });

  it("outcomes: counts come from the data, the placed total is not 96 + 22, no dead links", () => {
    const offers = [{ id: "o1", student: "x", programme: "B.Sc (2027)", employer: "Retail Co", lpa: 3, source: "Hirelane" as const, letter: false, status: "waiting" as const }];
    const { container, getByText } = render(<OutcomesPage real offers={offers} outgoing={60} higherStudies={2} placedOnRoster={12} verified={0} waiting={1} />);
    expect(container.textContent).not.toMatch(/\b118\b|\b96\b|9 waiting and 22/);
    expect(getByText("Placed (on campus and verified off campus)").nextElementSibling!.textContent).toBe("12");
    expect(container.textContent).toMatch(/1 waiting and 0 verified/);
    expect(container.querySelectorAll('a[href="#"]')).toHaveLength(0);
    expect(container.textContent).toContain("Download 5.2.1 list");
  });

  it("outcomes: a hidden roster-placed figure is said to be hidden and no percentage is invented", () => {
    const { container } = render(<OutcomesPage real offers={[]} outgoing={60} higherStudies={0} placedOnRoster={null} verified={0} waiting={0} />);
    expect(container.textContent).toMatch(/hidden/i);
    expect(container.textContent).not.toMatch(/\d+% so far/);
  });

  it("settings: only what the services hold, no sample join code, domain or staff", () => {
    const { container } = render(<SettingsPage real college="Real College" universityRule={null} staff={[{ id: "s1", role: "owner", claimed: true }]} />);
    for (const re of SAMPLE_ONLY) expect(container.textContent, String(re)).not.toMatch(re);
    expect(container.textContent).toMatch(/no rule on file/i);
    expect(container.textContent).toContain("Owner");
    expect(container.querySelectorAll('a[href="#"]')).toHaveLength(0);
  });
});
