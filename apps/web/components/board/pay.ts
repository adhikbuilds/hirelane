import { formatSalary } from "../../lib/job-view";
import type { PublicSalary } from "../../lib/queries/jobs";

export type PayColumn = { main: string; original: string | null; converted: boolean };

/** Ledger Pay cell: the annual figure in `pref`, with the posting's own figure beneath when it differs. Never estimated. */
export function payColumn(s: PublicSalary | null, pref: "USD" | "INR"): PayColumn | null {
  if (!s) return null;
  const annual = pref === "USD" ? s.annualUsd : s.annualInr;
  if (annual && (annual.min !== null || annual.max !== null)) {
    const main = formatSalary({ minMinor: annual.min, maxMinor: annual.max, currency: pref, period: "year" });
    if (main) return { main, original: main === s.display ? null : s.display, converted: main !== s.display };
  }
  return { main: s.display, original: null, converted: false };
}
