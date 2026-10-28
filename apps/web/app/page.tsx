import type { Metadata } from "next";
import { evaluateEligibility, parseCriteria, type EligibilityProfileInput } from "@hirelane/engine";
import { FrontPage, type DemoInput } from "@/components/landing/Front";

export const metadata: Metadata = {
  title: { absolute: "Hirelane: off-campus jobs students can actually get" },
  description: "Fresh roles from company career pages, checked against each student's own marks. For students and placement cells.",
};

const num = (v: string | undefined, max: number) => {
  const n = Number.parseFloat(String(v ?? "").trim());
  return Number.isFinite(n) && n >= 0 && n <= max ? n : undefined;
};

/** Public front page. The "try it" demo runs the real eligibility engine on the server; nothing is stored. */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const notice = (q.notice ?? "").slice(0, 4000);
  if (!notice) return <FrontPage demo={null} result={null} />;
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
  const result = evaluateEligibility(parseCriteria(notice), profile, { cgpaRule: null });
  return <FrontPage demo={demo} result={result} />;
}
