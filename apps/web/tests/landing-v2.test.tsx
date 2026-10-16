// @vitest-environment jsdom
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DemoStack } from "../components/landing/demo-stack";
import { agoShort, asOfLabel, hashString, matchFixture, roleLabel } from "../components/landing/demo-model";
import { PLANS, currencyFor, formatPerApplication, formatPrice, priceFor, quarterlySaving } from "../components/landing/pricing-model";
import { buildTraceDemo } from "../components/landing/trace-model";
import { weeklyDrafts } from "../components/landing/autopilot";
import type { DemoJob } from "../components/landing/types";

const jobs: DemoJob[] = ["Alpha", "Beta", "Gamma"].map((c, i) => ({
  slug: `${c.toLowerCase()}-engineer-${i}`,
  title: `${c} Engineer`,
  company: c,
  logoPath: null,
  where: "Remote",
  payAnnual: "$100K-$140K/yr",
  payStated: null,
  payMaxUsdMinor: 14_000_000,
  skills: ["Python", "SQL", "Kafka", "AWS", "dbt", "Airflow", "Spark"],
}));

describe("matchFixture", () => {
  it("is deterministic and its maths equals the chips shown", () => {
    const a = matchFixture("some-slug", jobs[0]!.skills);
    expect(matchFixture("some-slug", jobs[0]!.skills)).toEqual(a);
    expect(a.chips).toHaveLength(a.total);
    expect(a.chips.filter((c) => c.met)).toHaveLength(a.matched);
    expect(a.maths).toContain(`${a.matched} of ${a.total} requirements`);
    expect(a.total - a.matched).toBeGreaterThanOrEqual(1);
    expect(a.total - a.matched).toBeLessThanOrEqual(3);
    expect(a.score).toBeGreaterThanOrEqual(0);
    expect(a.score).toBeLessThanOrEqual(100);
  });
  it("compares the pay floor against the job's real pay, and says so when pay is missing", () => {
    expect(matchFixture("x", ["a", "b"], 34_000_000).maths).toContain("salary above your floor");
    expect(matchFixture("x", ["a", "b"], 1_000_000).maths).toContain("salary below your floor");
    expect(matchFixture("x", ["a", "b"], null).maths).toContain("pay not stated");
  });
  it("caps requirements at eight, dedupes, and handles no skills", () => {
    expect(matchFixture("x", Array.from({ length: 20 }, (_, i) => `s${i}`)).total).toBe(8);
    expect(matchFixture("x", ["a", "a", " a "]).total).toBe(1);
    expect(matchFixture("x", []).score).toBe(0);
  });
  it("hashes stably", () => {
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abd"));
  });
});

describe("small formatters", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  it("agoShort", () => {
    expect(agoShort("2026-10-16T11:59:30Z", now)).toBe("just now");
    expect(agoShort("2026-10-16T11:48:00Z", now)).toBe("12m ago");
    expect(agoShort("2026-10-16T10:00:00Z", now)).toBe("2h ago");
    expect(agoShort("2026-10-13T12:00:00Z", now)).toBe("3d ago");
    expect(agoShort("2026-10-17T12:00:00Z", now)).toBe("just now");
  });
  it("asOfLabel and roleLabel", () => {
    expect(asOfLabel("2026-10-15T19:30:00Z")).toBe("15 Oct, 19:30 UTC");
    expect(asOfLabel(null)).toBeNull();
    expect(asOfLabel("nope")).toBeNull();
    expect(roleLabel("software-engineer-frontend")).toBe("Software engineer frontend");
  });
});

describe("pricing model", () => {
  it("anchors Basic on the PLAN prices", () => {
    const basic = PLANS.find((p) => p.code === "basic")!;
    expect(basic.prices!.weekly).toMatchObject({ inr: 99, usd: 3, applications: 30 });
    expect(basic.prices!.monthly).toMatchObject({ inr: 299, usd: 9, applications: 120 });
    expect(PLANS.find((p) => p.code === "free")!.freeApplications).toBe(10);
  });
  it("groups digits by market and computes per-application cost", () => {
    expect(formatPrice(1599, "INR")).toBe("₹1,599");
    expect(formatPrice(100000, "INR")).toBe("₹1,00,000");
    expect(formatPrice(39, "USD")).toBe("$39");
    expect(formatPerApplication({ inr: 299, usd: 9, applications: 120 }, "INR")).toBe("₹2.49");
    expect(formatPerApplication({ inr: 299, usd: 9, applications: 120 }, "USD")).toBe("$0.075");
    expect(priceFor(PLANS[0]!, "monthly", "INR")).toBeNull();
  });
  it("quarterly is cheaper than three months", () => {
    for (const p of PLANS.filter((x) => x.prices)) expect(quarterlySaving(p)).toBeGreaterThan(0);
  });
  it("picks INR only for en-IN, hi and Indian regions", () => {
    expect(currencyFor("en-IN,en;q=0.9")).toBe("INR");
    expect(currencyFor("hi")).toBe("INR");
    expect(currencyFor("hi-IN")).toBe("INR");
    expect(currencyFor("en-US,en;q=0.9")).toBe("USD");
    expect(currencyFor("en;q=0.5, hi;q=0.9")).toBe("INR");
    expect(currencyFor(null)).toBe("USD");
    expect(currencyFor("")).toBe("USD");
    expect(currencyFor("*")).toBe("USD");
  });
});

describe("weeklyDrafts", () => {
  it("is held down by the daily cap", () => {
    expect(weeklyDrafts(312, 3)).toBe(21);
    expect(weeklyDrafts(5, 10)).toBe(5);
    expect(weeklyDrafts(-4, 3)).toBe(0);
  });
});

describe("buildTraceDemo", () => {
  const text = "x".repeat(300) + "The base salary range is $88,000 - $103,000 per year. " + "y".repeat(300);
  const start = text.indexOf("$88,000");
  const end = start + "$88,000 - $103,000".length;
  const ev = [{ start, end, quote: text.slice(start, end), source: "description" }];
  const step = (seq: number, ruleId: string, evidence = ev, inputs = {}) => ({ seq, ruleId, label: ruleId, inputs, evidence });
  const trace = {
    steps: [
      step(0, "salary.num.western_grouping"),
      step(1, "salary.currency.symbol"),
      step(2, "salary.period.explicit"),
      step(3, "salary.fx.convert", [], { from: "USD", to: "INR", rate: "88.5", asOf: "2026-10-15" }),
    ],
  };
  const base = { slug: "s", title: "t", company: "c", headline: "h" };
  it("builds an excerpt whose spans match the text", () => {
    const d = buildTraceDemo({ ...base, text, trace })!;
    expect(d).not.toBeNull();
    const s0 = d.steps[0]!.span!;
    expect(d.excerpt.slice(s0.start, s0.end)).toBe("$88,000 - $103,000");
    expect(d.steps[3]!.span).toBeNull();
    expect(d.steps[3]!.label).toBe("USD to INR at 88.5, rate table of 2026-10-15");
    expect(d.fxDate).toBe("2026-10-15");
  });
  it("refuses a stale trace, missing text and garbage", () => {
    expect(buildTraceDemo({ ...base, text: text.replace("$88,000", "$99,000"), trace })).toBeNull();
    expect(buildTraceDemo({ ...base, text: null, trace })).toBeNull();
    expect(buildTraceDemo({ ...base, text, trace: "nope" })).toBeNull();
    expect(buildTraceDemo({ ...base, text, trace: { steps: trace.steps.slice(0, 2) } })).toBeNull();
  });
});

describe("DemoStack", () => {
  it("is labelled, blocks approval until the Needs-you field is filled, then undo works", async () => {
    const user = userEvent.setup();
    render(<DemoStack jobs={jobs} />);
    expect(screen.getByText("Demo: nothing is sent")).toBeInTheDocument();
    expect(screen.getByTestId("demo-card")).toHaveAttribute("data-slug", jobs[0]!.slug);

    await user.click(screen.getByRole("button", { name: /Approve & send/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Answer this first/);
    expect(screen.queryByTestId("undo-bar")).toBeNull();

    await user.click(screen.getByRole("button", { name: "30 days" }));
    await user.click(screen.getByRole("button", { name: /Approve & send/ }));
    expect(screen.getByTestId("undo-bar")).toBeInTheDocument();
    expect(screen.getByText("Sending to Alpha")).toBeInTheDocument();

    await user.keyboard("u");
    expect(screen.queryByTestId("undo-bar")).toBeNull();
    expect(screen.getByTestId("demo-card")).toHaveAttribute("data-slug", jobs[0]!.slug);
  });

  it("P passes to the next card, and typing a in the field does not approve", async () => {
    const user = userEvent.setup();
    render(<DemoStack jobs={jobs} />);
    await user.click(screen.getByLabelText(/Notice period/));
    await user.keyboard("pa");
    expect(screen.getByTestId("demo-card")).toHaveAttribute("data-slug", jobs[0]!.slug);
    expect(screen.queryByTestId("undo-bar")).toBeNull();
    await act(async () => {
      (document.activeElement as HTMLElement).blur();
    });
    await user.keyboard("p");
    await screen.findByText("Beta Engineer");
  });
});
