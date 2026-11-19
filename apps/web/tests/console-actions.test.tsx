// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const saved = vi.hoisted(() => [] as { name: string; text: Promise<string> }[]);
vi.mock("@/lib/campus-client", async (orig) => ({
  ...(await orig<typeof import("@/lib/campus-client")>()),
  saveBlob: (b: Blob, name: string) => saved.push({ name, text: b.text() }),
}));

import { DriveConsole } from "@/components/campus/DriveConsole";
import { NaacDownload, OutcomesTable, RosterImport } from "@/components/campus/Actions";
import type { DriveInboxData } from "@/lib/adapters/campus-drives";

const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
type Reply = { status?: number; json?: unknown; text?: string; type?: string };
let replies: Record<string, Reply | ((body: unknown) => Reply)> = {};
beforeEach(() => {
  calls.length = 0;
  saved.length = 0;
  replies = {};
  refresh.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const body = typeof init.body === "string" ? (init.headers && (init.headers as Record<string, string>)["content-type"] === "application/json" ? JSON.parse(init.body) : init.body) : init.body;
      calls.push({ url, method, headers: (init.headers ?? {}) as Record<string, string>, body });
      const r0 = replies[`${method} ${url}`] ?? replies[`${method} ${url.split("?")[0]}`];
      const r = (typeof r0 === "function" ? r0(body) : r0) ?? { status: 404, json: { code: "not_found" } };
      return new Response(r.text ?? JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { "content-type": r.type ?? "application/json" } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const INBOX: DriveInboxData = { college: "Test College", cohorts: [{ id: "c1", label: "B.Com, batch of 2026" }], counts: { draft: 1, live: 0, closed: 0 }, drives: [] };

describe("DriveConsole", () => {
  it("walks notice, check, draft, announce, then close, calling only the drive routes with an Idempotency-Key", async () => {
    replies["POST /api/v1/tpo/drives/preview"] = {
      json: { step: "parsed", title: "Acme", cohortId: "c1", rules: ["60% throughout", "No active backlogs"], criteria: [], scam: { risk: "none", flags: [] }, suggestedDeadline: "2099-12-30" },
    };
    replies["POST /api/v1/tpo/drives/draft"] = {
      json: { id: "d1", status: "draft", step: "counting", reach: { state: "pending" }, rules: [], criteria: [], scam: { risk: "none", flags: [] }, suggestedDeadline: null },
    };
    replies["POST /api/v1/tpo/drives/d1/announce"] = { json: { id: "d1", status: "live" } };
    render(<DriveConsole data={INBOX} />);
    fireEvent.change(screen.getByLabelText("Drive title"), { target: { value: "Acme Works" } });
    fireEvent.change(screen.getByLabelText("Notice text"), { target: { value: "Eligibility: 60% throughout. Apply by 30 Dec 2099." } });
    fireEvent.click(screen.getByRole("button", { name: "Check the notice" }));
    expect(await screen.findByText("60% throughout")).toBeTruthy();
    expect(screen.getByText("No active backlogs")).toBeTruthy();
    expect(calls.map((c) => c.url)).toEqual(["/api/v1/tpo/drives/preview"]);
    expect(calls[0]!.body).toMatchObject({ cohortId: "c1", title: "Acme Works" });
    expect(calls[0]!.headers["idempotency-key"]).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));
    await screen.findByText(/Saved as a draft/);
    expect(calls[1]!.body).toMatchObject({ deadline: "2099-12-30" }); // the suggested date, which the TPO confirmed by leaving it
    fireEvent.click(screen.getByRole("button", { name: "Announce to students" }));
    await screen.findByText(/The drive is live/);
    expect(calls.at(-1)!.url).toBe("/api/v1/tpo/drives/d1/announce");
    expect(refresh).toHaveBeenCalled();
  });

  it("shows an error, not a success, when a call fails, and never saves before the notice is checked", async () => {
    render(<DriveConsole data={INBOX} />);
    expect(screen.queryByRole("button", { name: "Save as draft" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Drive title"), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText("Notice text"), { target: { value: "y" } });
    fireEvent.click(screen.getByRole("button", { name: "Check the notice" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/not available|did not work/i);
    expect(screen.queryByRole("button", { name: "Save as draft" })).toBeNull();
  });

  it("lists drives with their status and closes a live one; a hidden reach is said to be hidden, not shown as 0", async () => {
    replies["POST /api/v1/tpo/drives/d9/close"] = { json: { id: "d9", status: "closed" } };
    const data: DriveInboxData = {
      ...INBOX,
      counts: { draft: 0, live: 1, closed: 0 },
      drives: [
        {
          id: "d9",
          title: "Bank Teller",
          host: "bank.example.test",
          cohort: "B.Com, batch of 2026",
          status: "live",
          step: "live",
          next: null,
          deadlineLabel: "Wed 30 Dec",
          daysLeft: 20,
          closesTomorrow: false,
          rounds: null,
          documents: null,
          rules: ["60% throughout"],
          scam: { risk: "none", flags: [] },
          reach: { state: "ready", qualify: null, couldntCheck: null, hidden: true, label: "Both figures are hidden because the groups are too small to show." },
        },
      ],
    };
    render(<DriveConsole data={data} />);
    expect(screen.getByText("Bank Teller")).toBeTruthy();
    expect(screen.getByText(/hidden because the groups are too small/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close this drive" }));
    await waitFor(() => expect(calls.at(-1)!.url).toBe("/api/v1/tpo/drives/d9/close"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe("NaacDownload", () => {
  it("POSTs the export once (the audited action) and also saves the README with the caveat", async () => {
    replies["POST /api/v1/tpo/export/naac"] = { text: "Year,Name\r\n", type: "text/csv; charset=utf-8" };
    replies["GET /api/v1/tpo/export/naac"] = { text: "NAAC 5.2.1 export\r\nnot been checked", type: "text/plain; charset=utf-8" };
    render(<NaacDownload sample={false} />);
    expect(screen.getByText(/not been checked against the official/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Download 5\.2\.1 list/ }));
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(calls.find((c) => c.method === "GET")!.url).toContain("format=readme");
    expect(saved.map((s) => s.name)).toEqual([expect.stringMatching(/\.csv$/), expect.stringMatching(/README.*\.txt$/)]);
    expect(await saved[0]!.text).toBe("Year,Name\r\n");
  });

  it("sample mode makes no request", () => {
    render(<NaacDownload sample />);
    fireEvent.click(screen.getByRole("button", { name: /Download 5\.2\.1 list/ }));
    expect(calls).toEqual([]);
    expect(screen.getByText(/Sample: nothing was downloaded/)).toBeTruthy();
  });
});

const OFFERS = [
  { id: "o1", student: "A student who chose not to share a name", programme: "B.Com (2026)", employer: "Retail Co", lpa: 3.2, source: "Hirelane" as const, letter: true, status: "waiting" as const },
  { id: "o2", student: "A student who chose not to share a name", programme: "B.Com (2026)", employer: "Bank Co", lpa: 0, source: "Hirelane" as const, letter: false, status: "verified" as const },
];

describe("OutcomesTable", () => {
  it("names nobody until Show names is pressed, then calls the logged reveal route once", async () => {
    replies["POST /api/v1/tpo/outcomes/reveal"] = {
      json: {
        outcomes: [
          { id: "o1", studentName: "Asha Verma" },
          { id: "o2", studentName: null },
        ],
      },
    };
    render(<OutcomesTable offers={OFFERS} sample={false} />);
    expect(screen.queryByText("Asha Verma")).toBeNull();
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /Show names/ }));
    expect(await screen.findByText("Asha Verma")).toBeTruthy();
    expect(calls.filter((c) => c.url.endsWith("/outcomes/reveal"))).toHaveLength(1);
  });

  it("an unknown package is blank, never 0.0 LPA", () => {
    render(<OutcomesTable offers={OFFERS} sample={false} />);
    const row = screen.getByText("Bank Co").closest("tr")!;
    expect(within(row).queryByText(/0\.0 LPA/)).toBeNull();
    expect(within(screen.getByText("Retail Co").closest("tr")!).getByText("3.2 LPA")).toBeTruthy();
  });

  it("Mark verified calls the verify route and flips the row", async () => {
    replies["POST /api/v1/tpo/outcomes/o1/verify"] = { json: { id: "o1", verification: "tpo_verified" } };
    render(<OutcomesTable offers={OFFERS} sample={false} />);
    const row = screen.getByText("Retail Co").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Mark verified" }));
    await waitFor(() => expect(within(row).getByText("Verified")).toBeTruthy());
    expect(calls.at(-1)!.url).toBe("/api/v1/tpo/outcomes/o1/verify");
  });

  it("sample mode makes no request", () => {
    render(<OutcomesTable offers={OFFERS} sample />);
    fireEvent.click(screen.getByRole("button", { name: /Show names/ }));
    expect(calls).toEqual([]);
  });
});

describe("RosterImport", () => {
  const file = new File(["email,placed\na@x.example.test,no\n"], "roster.csv", { type: "text/csv" });
  it("previews first (no email echoed), and imports only after the preview says it can", async () => {
    replies["POST /api/v1/tpo/cohorts/c1/roster/preview"] = {
      json: { rowsTotal: 12, validEmails: 12, invalidEmails: 0, duplicates: 0, uniqueEmails: 12, canStage: true, columns: { email: "email", placed: "placed" }, headers: ["email", "placed"] },
    };
    replies["POST /api/v1/tpo/cohorts/c1/roster"] = { json: { rowsTotal: 12, rowsValid: 12, rowsRejected: 0 } };
    render(<RosterImport cohorts={[{ id: "c1", label: "B.Com (2026)" }]} />);
    expect(screen.queryByRole("button", { name: "Import this list" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Roster CSV"), { target: { files: [file] } });
    expect(await screen.findByText(/12 different email addresses/)).toBeTruthy();
    expect(calls.map((c) => c.url)).toEqual(["/api/v1/tpo/cohorts/c1/roster/preview"]);
    fireEvent.click(screen.getByRole("button", { name: "Import this list" }));
    await screen.findByText(/Imported 12/);
    expect(calls.at(-1)!.url).toBe("/api/v1/tpo/cohorts/c1/roster");
    expect(refresh).toHaveBeenCalled();
  });

  it("a list that is too small cannot be imported", async () => {
    replies["POST /api/v1/tpo/cohorts/c1/roster/preview"] = {
      json: { rowsTotal: 3, validEmails: 3, invalidEmails: 0, duplicates: 0, uniqueEmails: 3, canStage: false, columns: { email: "email", placed: null }, headers: ["email"] },
    };
    render(<RosterImport cohorts={[{ id: "c1", label: "B.Com (2026)" }]} />);
    fireEvent.change(screen.getByLabelText("Roster CSV"), { target: { files: [file] } });
    await screen.findByText(/3 different email addresses/);
    expect(screen.queryByRole("button", { name: "Import this list" })).toBeNull();
    expect(screen.getByText(/at least 10/i)).toBeTruthy();
  });
});
