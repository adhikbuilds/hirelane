import type { Metadata } from "next";
import { evaluateEligibility, parseCriteria, type EligibilityProfileInput } from "@hirelane/engine";
import { StudentsPage, type DemoInput } from "@/components/landing/Front";

export const metadata: Metadata = {
  title: "For students",
  description: "Check if you qualify for a drive in seconds, then swipe roles picked for your marks. Free for students.",
};

const num = (v: string | undefined, max: number) => {
  const n = Number.parseFloat(String(v ?? "").trim());
  return Number.isFinite(n) && n >= 0 && n <= max ? n : undefined;
};

/** For students. The demo runs the real eligibility engine on the server; nothing is stored. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const notice = (q.notice ?? "").slice(0, 4000);
  if (!notice) return <StudentsPage demo={null} result={null} />;
  const demo: DemoInput = { notice, pct10: q.pct10 ?? "", pct12: q.pct12 ?? "", grad: q.grad ?? "", degree: (q.degree ?? "").slice(0, 40), year: q.year ?? "", backlogs: q.backlogs ?? "" };
  const grad = num(demo.grad, 100);
  const profile: EligibilityProfileInput = {
    confirmed: true,
    pct_10: num(demo.pct10, 100),
    secondary_kind: "12th",
    pct_secondary: num(demo.pct12, 100),
    degree: demo.degree || undefined,
    grad_pct_equiv: grad,
    grad_conversion: grad === undefined ? undefined : "direct",
    passout_year: num(demo.year, 2100),
    active_backlogs: num(demo.backlogs, 50),
  };
  return <StudentsPage demo={demo} result={evaluateEligibility(parseCriteria(notice), profile, { cgpaRule: null })} />;
}
