import type { JobPreviewData } from "../../lib/queries/jobs";

export type TraceGroup = "Read" | "Currency" | "Period" | "FX" | "Check";

export function traceGroup(ruleId: string): TraceGroup {
  if (ruleId.startsWith("salary.fx.")) return "FX";
  if (ruleId.startsWith("salary.period.")) return "Period";
  if (ruleId.startsWith("salary.currency.")) return "Currency";
  if (/^salary\.(num|range|structured)\./.test(ruleId) || ruleId === "salary.kind.ctc") return "Read";
  return "Check";
}

/**
 * A short, honest summary of a pay trace: the first step of each distinct group, in order, at most `max`.
 * `total` is the full step count so the panel can say "4 of 7 steps".
 */
export function traceSummary(trace: JobPreviewData["trace"], max = 4): { steps: { group: TraceGroup; label: string }[]; total: number } {
  const seen = new Set<TraceGroup>();
  const steps: { group: TraceGroup; label: string }[] = [];
  for (const s of trace) {
    const group = traceGroup(s.ruleId);
    if (seen.has(group)) continue;
    seen.add(group);
    steps.push({ group, label: s.label });
    if (steps.length >= max) break;
  }
  return { steps, total: trace.length };
}

export type SuggestItem =
  | { type: "company"; key: string; label: string; href: string; logoPath: string | null; meta: string }
  | { type: "title"; key: string; label: string; href: string; meta: string };

/** Flattens suggestions into one keyboard-navigable list: companies first, then titles. */
export function suggestItems(
  s: { companies: { slug: string; name: string; logoPath: string | null; open: number }[]; titles: { title: string; n: number }[] },
  hrefForTitle: (title: string) => string,
): SuggestItem[] {
  return [
    ...s.companies.map((c): SuggestItem => ({
      type: "company",
      key: `c:${c.slug}`,
      label: c.name,
      href: `/company/${c.slug}`,
      logoPath: c.logoPath,
      meta: `${c.open.toLocaleString("en-US")} open`,
    })),
    ...s.titles.map((t): SuggestItem => ({
      type: "title",
      key: `t:${t.title}`,
      label: t.title,
      href: hrefForTitle(t.title),
      meta: `${t.n.toLocaleString("en-US")} ${t.n === 1 ? "role" : "roles"}`,
    })),
  ];
}
