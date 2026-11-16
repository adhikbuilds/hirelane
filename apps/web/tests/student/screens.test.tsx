// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({ Geist: () => ({ variable: "g" }), Geist_Mono: () => ({ variable: "gm" }), Bricolage_Grotesque: () => ({ variable: "b" }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }) }));
const api = vi.hoisted(() => ({ postJson: vi.fn(), putJson: vi.fn(), readSet: vi.fn(() => new Set<string>()), writeSet: vi.fn() }));
vi.mock("@/lib/student/client", () => api);

import { HomeA } from "@/components/student/HomeA";
import { ApplyStep, CollegeStep } from "@/components/student/Onboarding";
import { DrivesView } from "@/components/student/DrivesView";
import { FinishView } from "@/components/student/FinishView";
import { PasteForm } from "@/components/student/PasteForm";
import { TrackerPanes } from "@/components/student/TrackerView";
import { SAMPLE_DRIVES, SAMPLE_FINISH, SAMPLE_HOME, SAMPLE_MESSAGES, SAMPLE_RECEIPT, SAMPLE_TRACKER } from "@/lib/student/sample";
import { toTrackerView } from "@/lib/student/map";

beforeEach(() => {
  api.postJson.mockReset();
  api.putJson.mockReset();
  nav.push.mockReset();
  window.matchMedia = ((q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {}, media: q })) as never;
});

const ok = <T,>(data: T) => ({ ok: true, status: 200, data, error: null });
const fail = (status: number, error: string) => ({ ok: false, status, data: null, error });

describe("Home", () => {
  it("leads with the feed, then Needs you, drives, resume, marks, week and paste: each row goes somewhere", () => {
    const { container } = render(<HomeA data={SAMPLE_HOME} />);
    expect(screen.getByText("Good morning, Rahul")).toBeTruthy();
    expect(container.querySelector(".st-feed-list")).toBeTruthy();
    const panel = container.querySelector(".st-rp")!;
    const links = within(panel as HTMLElement).getAllByRole("link");
    const hrefs = links.map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining(["/tracker/brightdesk", "/drives?d=d1", "/drives?d=d2", "/resume", "/you", "/tracker", "/paste", "/drives"]));
    expect(within(panel as HTMLElement).getByText("482 913")).toBeTruthy();
    expect(within(panel as HTMLElement).getByRole("button", { name: "Copy code" })).toBeTruthy();
  });

  it("a real student with nothing waiting sees no Needs-you group and no sample line", () => {
    render(<HomeA data={{ ...SAMPLE_HOME, sample: false, codes: [], finish: [], drives: [], marks: null, resume: null, cards: [], week: { applied: 0, replies: 0, replyLine: null } }} />);
    expect(screen.queryByText("Needs you")).toBeNull();
    expect(screen.queryByText(/Sample student/)).toBeNull();
    expect(screen.getByText("Add your resume")).toBeTruthy();
    expect(screen.getByText("0 applied this week, 0 replies")).toBeTruthy();
    expect(screen.getByText("No new roles yet today")).toBeTruthy();
  });

  it("an application that needs answers says how many", () => {
    render(<HomeA data={{ ...SAMPLE_HOME, codes: [], finish: [{ id: "x", company: "Medhaa Learning", role: "Counsellor", reason: "2 answers need you.", url: null, needsAnswers: 2 }] }} />);
    expect(screen.getByText("Medhaa Learning needs 2 answers")).toBeTruthy();
  });

  it("the count line is honest about the singular and about not-new roles", () => {
    const { rerender } = render(<HomeA data={{ ...SAMPLE_HOME, newCount: 1 }} />);
    expect(screen.getByText("1 new role")).toBeTruthy();
    rerender(<HomeA data={{ ...SAMPLE_HOME, newCount: 0 }} />);
    expect(screen.getByText(/3 roles/)).toBeTruthy();
    expect(screen.getByText(/you qualify for today/)).toBeTruthy();
  });
});

describe("Drives", () => {
  it("splits open, could-not-check and closed, and shows the engine's maths for the picked one", () => {
    render(<DrivesView drives={SAMPLE_DRIVES} selectedId="d2" college="Sample University, Indore." />);
    expect(screen.getByText("Open, by deadline")).toBeTruthy();
    expect(screen.getByText("We couldn’t check")).toBeTruthy();
    expect(screen.getByText("Closed (2)")).toBeTruthy();
    const heading = screen.getByRole("heading", { level: 2, name: "Relationship Officer" });
    expect(heading).toBeTruthy();
    expect(screen.getAllByText(/Needs 60% in every semester/).length).toBeGreaterThan(0);
  });
  it("the first open drive is selected when none is asked for, and its apply link opens their form safely", () => {
    render(<DrivesView drives={SAMPLE_DRIVES} selectedId={null} college={null} />);
    const a = screen.getByRole("link", { name: "Apply on their form" });
    expect(a.getAttribute("href")).toBe("https://careers.anvayaretail.in/process-associate");
    expect(a.getAttribute("rel")).toContain("noopener");
  });
  it("no drives at all points to joining a college", () => {
    render(<DrivesView drives={{ open: [], check: [], closed: [] }} selectedId={null} college={null} />);
    expect(screen.getByText("No drives yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Join your college/ }).getAttribute("href")).toBe("/welcome/college");
  });
});

describe("Tracker", () => {
  const sel = { id: "kosha", company: "Kosha Payments", role: "Operations Analyst", receipt: SAMPLE_RECEIPT, fallbackUrl: null };
  it("shows every stage, the reply and the receipt, with an action on each", () => {
    const { container } = render(<TrackerPanes view={SAMPLE_TRACKER} selected={sel} message={SAMPLE_MESSAGES[0]!} tab="applications" sample />);
    for (const label of ["Needs you", "Replies", "Interview", "Applied", "Offer", "Not matched to an application"]) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Finish on their site" }).getAttribute("href")).toBe("/tracker/brightdesk");
    expect(screen.getByRole("link", { name: "Draft a follow-up" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Draft a reply" }).getAttribute("href")).toMatch(/^mailto:\?subject=/);
    expect(screen.getByText("Sender matches Kosha Payments")).toBeTruthy();
    expect(screen.getByText("Accepted by their form")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "I got an offer" }).length).toBeGreaterThan(0);
    expect(container.querySelector("a a")).toBeNull();
  });
  it("an empty Offer stage says what will appear there", () => {
    render(<TrackerPanes view={SAMPLE_TRACKER} selected={sel} message={null} tab="applications" sample />);
    expect(screen.getByText("Offers you record show here, with who can see them.")).toBeTruthy();
  });
  it("a student with nothing yet is pointed to the picks", () => {
    render(<TrackerPanes view={toTrackerView([], [], new Date("2026-10-31T04:30:00Z"))} selected={null} message={null} tab="applications" sample={false} />);
    expect(screen.getByRole("link", { name: "See today’s picks" }).getAttribute("href")).toBe("/picks");
    expect(screen.queryByText(/Sample student/)).toBeNull();
  });
  it("a message matched only by company name asks the student to check the sender", () => {
    render(<TrackerPanes view={SAMPLE_TRACKER} selected={sel} message={{ ...SAMPLE_MESSAGES[0]!, matchedBy: "company", fromAddr: null }} tab="applications" sample />);
    expect(screen.getByText(/Check the sender before you reply/)).toBeTruthy();
    expect(screen.queryByText(/Sender matches/)).toBeNull();
  });
  it("outcome buttons record the outcome, and a student outside a college is told how to join", async () => {
    api.postJson.mockResolvedValueOnce(fail(409, "not_in_campus"));
    render(<TrackerPanes view={SAMPLE_TRACKER} selected={sel} message={null} tab="applications" sample={false} />);
    await userEvent.click(screen.getAllByRole("button", { name: "I got an offer" })[0]!);
    expect(api.postJson).toHaveBeenCalledWith("/api/v1/campus/outcomes", { kind: "offer", employer: "Kosha Payments", roleTitle: "Operations Analyst" });
    await waitFor(() => expect(screen.getByText(/join your college first/)).toBeTruthy());
    api.postJson.mockResolvedValueOnce(ok({}));
    await userEvent.click(screen.getAllByRole("button", { name: "I got an interview" })[0]!);
    await waitFor(() => expect(screen.getByText(/Your placement cell sees it only if you share outcomes/)).toBeTruthy());
  });
});

describe("Needs you: finish on their site", () => {
  it("counts what has been copied and links to the company's own form", async () => {
    render(<FinishView finish={SAMPLE_FINISH} sample={false} />);
    expect(screen.getByText("0 of 6 copied")).toBeTruthy();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    await userEvent.click(screen.getByRole("button", { name: "Copy Full name" }));
    await waitFor(() => expect(screen.getByText("1 of 6 copied")).toBeTruthy());
    expect((navigator.clipboard.writeText as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("Rahul Verma");
    const open = screen.getByRole("link", { name: /Open Brightdesk’s form/ });
    expect(open.getAttribute("href")).toBe("https://careers.brightdesk.in/jobs/csa-2026");
    expect(open.getAttribute("rel")).toContain("noopener");
  });
  it("'I've submitted it' marks it finished and returns to the Tracker", async () => {
    api.postJson.mockResolvedValue(ok({ id: "brightdesk", status: "submitted" }));
    render(<FinishView finish={SAMPLE_FINISH} sample={false} />);
    await userEvent.click(screen.getByRole("button", { name: "I’ve submitted it" }));
    expect(api.postJson).toHaveBeenCalledWith("/api/v1/apply/applications/brightdesk/finish");
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/tracker"));
  });
  it("a question only the student can answer is saved, then the application is sent again", async () => {
    const finish = { ...SAMPLE_FINISH, needsAnswers: 1, answers: [...SAMPLE_FINISH.answers.slice(0, 1), { key: "shifts", answerable: true, label: "Can you work rotational shifts?", value: null, needsYou: true, suggestion: null }] };
    api.putJson.mockResolvedValue(ok({}));
    api.postJson.mockResolvedValue(ok({ id: "brightdesk", status: "ready" }));
    render(<FinishView finish={finish} sample={false} />);
    expect(screen.getByText("Answer, then send again")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Can you work rotational shifts?"), "Yes");
    await userEvent.click(screen.getByRole("button", { name: "Save answer" }));
    expect(api.putJson).toHaveBeenCalledWith("/api/v1/apply/answers", { questionKey: "shifts", answer: "Yes", labelSeen: "Can you work rotational shifts?" });
    await waitFor(() => expect(screen.getByText("Your answers are in")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "Send it again" }));
    expect(api.postJson).toHaveBeenCalledWith("/api/v1/apply/applications/brightdesk/rearm");
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/tracker"));
  });
  it("a refused rearm says why in words", async () => {
    const finish = { ...SAMPLE_FINISH, needsAnswers: 1, answers: [{ key: "q", answerable: true, label: "Q", value: null, needsYou: true, suggestion: null }] };
    api.postJson.mockResolvedValue(fail(409, "conflict"));
    render(<FinishView finish={finish} sample={false} />);
    expect((screen.getByRole("button", { name: "Send it again" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("Q"), "A");
    api.putJson.mockResolvedValue(ok({}));
    await userEvent.click(screen.getByRole("button", { name: "Save answer" }));
    await userEvent.click(await screen.findByRole("button", { name: "Send it again" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("once every question has an answer"));
    expect(nav.push).not.toHaveBeenCalled();
  });
  it("the sample changes nothing", async () => {
    render(<FinishView finish={SAMPLE_FINISH} sample />);
    await userEvent.click(screen.getByRole("button", { name: "I’ve submitted it" }));
    expect(api.postJson).not.toHaveBeenCalled();
  });
});

describe("Paste", () => {
  const result = {
    job: { title: "Claims Associate", company: "Neelgiri Insurance Brokers", locations: [], workplace: null, level: null, fresher: { fresher: true, reason: "" }, pay: { stated: false, text: "not stated" }, applyUrl: null, source: "whatsapp" },
    eligibility: { overall: "not_eligible", rules: [{ text: "12th: 58%, needs 60%", status: "fail" }, { text: "10th: 71%, needs 55%", status: "pass" }] },
    fit: { verdict: "worthwhile", mustHaves: { matched: 2, total: 3, matchedSkills: [], missingSkills: [] }, conditions: [], locationFit: true },
    scam: { risk: "none", flagged: false, signals: [] },
  };
  const paste = async (text = "Off-campus drive: Claims Associate, Neelgiri. Eligibility 60% in 12th.") => {
    await userEvent.type(screen.getByLabelText("Job post or drive notice"), text);
    await userEvent.click(screen.getByRole("button", { name: "Check this job" }));
  };
  it("posts the text and shows the verdict, the rules with misses first, and pay", async () => {
    api.postJson.mockResolvedValue(ok(result));
    render(<PasteForm sample={false} />);
    await paste();
    expect(api.postJson).toHaveBeenCalledWith("/api/v1/paste", { text: expect.stringContaining("Claims Associate") });
    await waitFor(() => expect(screen.getByText("You don't meet 1 of 2 rules")).toBeTruthy());
    const rows = screen.getAllByText(/needs (60|55)%/);
    expect(rows[0]!.textContent).toBe("12th: 58%, needs 60%");
    expect(screen.getByText("Pay not stated")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("sends the link only when one is given", async () => {
    api.postJson.mockResolvedValue(ok(result));
    render(<PasteForm sample={false} />);
    await userEvent.type(screen.getByLabelText("Link, if there is one"), "https://example.test/job");
    await paste();
    expect(api.postJson).toHaveBeenCalledWith("/api/v1/paste", { text: expect.any(String), url: "https://example.test/job" });
  });
  it("raises a scam warning in plain words with the quote", async () => {
    api.postJson.mockResolvedValue(ok({ ...result, scam: { risk: "high", flagged: true, signals: [{ id: "fee", severity: "high", quote: "pay ₹1,500 registration" }] } }));
    render(<PasteForm sample={false} />);
    await paste();
    await waitFor(() => expect(screen.getByText("This looks like a scam")).toBeTruthy());
    expect(screen.getByText(/pay ₹1,500 registration/)).toBeTruthy();
    expect(screen.getByText(/Real employers don’t ask you to pay to apply/)).toBeTruthy();
  });
  it("too little text is refused before any call; rate limits and network errors are explained", async () => {
    render(<PasteForm sample={false} />);
    await paste("short");
    expect(api.postJson).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Paste the whole post");
    api.postJson.mockResolvedValueOnce(fail(429, "rate_limited"));
    await userEvent.type(screen.getByLabelText("Job post or drive notice"), " plus a lot more text to pass the length check");
    await userEvent.click(screen.getByRole("button", { name: "Check this job" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("a lot of pastes"));
    api.postJson.mockResolvedValueOnce(fail(0, "network"));
    await userEvent.click(screen.getByRole("button", { name: "Check this job" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("couldn’t reach Hirelane"));
  });
  it("the sample never calls the service", async () => {
    render(<PasteForm sample />);
    await paste();
    expect(api.postJson).not.toHaveBeenCalled();
    expect(screen.getByText("You don’t meet 1 of 4 rules")).toBeTruthy();
  });
  it("states plainly that nothing is saved and the link is never opened", () => {
    render(<PasteForm sample={false} />);
    expect(screen.getByText("Nothing you paste is saved.")).toBeTruthy();
    expect(screen.getByText("We read the link as text. We never open it.")).toBeTruthy();
  });
});

describe("Onboarding", () => {
  it("step 4: turning on Apply records the consent, then goes to the college step", async () => {
    api.putJson.mockResolvedValue(ok({ autoApply: true }));
    render(<ApplyStep pilot address="rahul.k3x@apply.hirelane.in" sample={false} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Tap Apply, and we apply.");
    await userEvent.click(screen.getByRole("button", { name: "Turn on Apply" }));
    expect(api.putJson).toHaveBeenCalledWith("/api/v1/apply/consent", { granted: true });
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/welcome/college"));
  });
  it("step 4: 'I'll submit myself' records a no and still moves on", async () => {
    api.putJson.mockResolvedValue(ok({ autoApply: false }));
    render(<ApplyStep pilot address={null} sample={false} />);
    await userEvent.click(screen.getByRole("button", { name: "I’ll submit myself" }));
    expect(api.putJson).toHaveBeenCalledWith("/api/v1/apply/consent", { granted: false });
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/welcome/college"));
  });
  it("step 4: before the pilot the copy says ready, and a failed save stays on the step", async () => {
    api.putJson.mockResolvedValue(fail(500, "internal_error"));
    render(<ApplyStep pilot={false} address={null} sample={false} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Tap Get it ready, and it’s ready.");
    expect(screen.getByText(/You press submit on their site/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Use my Hirelane address" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("didn’t save"));
    expect(nav.push).not.toHaveBeenCalled();
  });
  it("step 5: a campus code checks the code, offers the batches, joins, then sets what the placement cell sees", async () => {
    api.postJson.mockResolvedValueOnce(ok({ status: "choose_cohort", campus: { id: "c", name: "Sample University" }, cohorts: [{ id: "00000000-0000-4000-8000-000000000001", passoutYear: 2026, programme: "B.Com" }, { id: "00000000-0000-4000-8000-000000000002", passoutYear: 2026, programme: "BBA" }] }));
    api.postJson.mockResolvedValueOnce(ok({ status: "joined", verifiedVia: "code" }));
    api.putJson.mockResolvedValue(ok({ shareLevel: "outcomes" }));
    render(<CollegeStep sample={false} joined={false} />);
    await userEvent.click(screen.getByRole("tab", { name: "Campus code" }));
    await userEvent.type(screen.getByLabelText("Campus code"), "ABCD-2345");
    await userEvent.click(screen.getByLabelText(/^Outcomes/));
    await userEvent.click(screen.getByRole("button", { name: "Check the code" }));
    await waitFor(() => expect(screen.getByText("Your batch at Sample University")).toBeTruthy());
    expect(api.postJson).toHaveBeenNthCalledWith(1, "/api/v1/campus/join", { code: "ABCD-2345" });
    await userEvent.click(screen.getByLabelText(/BBA/));
    await userEvent.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() => expect(api.postJson).toHaveBeenNthCalledWith(2, "/api/v1/campus/join", { code: "ABCD-2345", cohortId: "00000000-0000-4000-8000-000000000002" }));
    await waitFor(() => expect(api.putJson).toHaveBeenCalledWith("/api/v1/campus/share", { level: "outcomes" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/home"));
  });
  it("step 5: the default is totals only, a wrong code is explained, and skipping is always there", async () => {
    api.postJson.mockResolvedValueOnce(fail(400, "invalid_code"));
    render(<CollegeStep sample={false} joined={false} />);
    expect((screen.getByLabelText(/Totals only/) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("link", { name: /Skip, I’m not with a college/ }).getAttribute("href")).toBe("/home");
    await userEvent.click(screen.getByRole("tab", { name: "Campus code" }));
    await userEvent.type(screen.getByLabelText("Campus code"), "NOPE");
    await userEvent.click(screen.getByRole("button", { name: "Check the code" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("That code didn’t work"));
  });
  it("step 5: the college email sends a code first", async () => {
    api.postJson.mockResolvedValueOnce(ok({ sent: true }));
    render(<CollegeStep sample={false} joined={false} />);
    await userEvent.type(screen.getByLabelText("College email"), "rahul@sampleuni.ac.in");
    await userEvent.click(screen.getByRole("button", { name: "Send me a code" }));
    expect(api.postJson).toHaveBeenCalledWith("/api/v1/campus/join/email", { email: "rahul@sampleuni.ac.in" });
    await waitFor(() => expect(screen.getByLabelText("The 6-digit code we sent")).toBeTruthy());
  });
  it("a student already in a college sees that, not the form", () => {
    render(<CollegeStep sample={false} joined />);
    expect(screen.getByText("You’ve joined your college")).toBeTruthy();
    expect(screen.queryByLabelText("Campus code")).toBeNull();
  });
});
