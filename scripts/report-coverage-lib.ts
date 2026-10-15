/** Pure scoring/formatting for `pnpm report:coverage` (PLAN Phase 2 acceptance). */

export interface Stats {
  openJobs: number;
  withSalary: number;
  salaryStatedAnywhere: number;
  salaryAmongStated: number;
  salaryWithoutTrace: number;
  withMustRequirement: number;
  withGeo: number;
  withRoleFamily: number;
  workplaceKnown: number;
  levelKnown: number;
  postings: { total: number; open: number; linked: number; openUnlinked: number };
  clusters: { jobsWithMultiplePostings: number; mergedPostings: number };
  llmCalls: number;
}

export interface Check {
  name: string;
  value: number;
  target: number;
  pass: boolean;
  note?: string;
}

export interface Report {
  checks: Check[];
  ok: boolean;
  salaryOfAll: number;
  ceilingOfAll: number;
  /** Share of jobs that state pay anywhere for which we produced a salary. */
  salaryOfCeiling: number;
}

const ratio = (n: number, d: number): number => (d > 0 ? n / d : 0);
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

export const TARGETS = { salaryOfCeiling: 0.5, mustReq: 0.9, geo: 0.98, roleFamily: 0.95 } as const;

export function evaluate(s: Stats): Report {
  const salaryOfAll = ratio(s.withSalary, s.openJobs);
  const ceilingOfAll = ratio(s.salaryStatedAnywhere, s.openJobs);
  const salaryOfCeiling = ratio(s.withSalary, s.salaryStatedAnywhere);
  const checks: Check[] = [
    { name: 'Salary captured / stated-anywhere ceiling', value: salaryOfCeiling, target: TARGETS.salaryOfCeiling, pass: s.openJobs > 0 && salaryOfCeiling >= TARGETS.salaryOfCeiling },
    { name: 'Salaried jobs missing a salary_trace', value: s.salaryWithoutTrace, target: 0, pass: s.salaryWithoutTrace === 0 },
    { name: 'Jobs with >= 1 must-have requirement', value: ratio(s.withMustRequirement, s.openJobs), target: TARGETS.mustReq, pass: s.openJobs > 0 && ratio(s.withMustRequirement, s.openJobs) >= TARGETS.mustReq },
    { name: 'Jobs with a country or remote:worldwide', value: ratio(s.withGeo, s.openJobs), target: TARGETS.geo, pass: s.openJobs > 0 && ratio(s.withGeo, s.openJobs) >= TARGETS.geo },
    { name: 'Jobs with a role family', value: ratio(s.withRoleFamily, s.openJobs), target: TARGETS.roleFamily, pass: s.openJobs > 0 && ratio(s.withRoleFamily, s.openJobs) >= TARGETS.roleFamily },
    { name: 'Open postings not linked to a job', value: s.postings.openUnlinked, target: 0, pass: s.postings.openUnlinked === 0 },
    { name: 'llm_calls rows', value: s.llmCalls, target: 0, pass: s.llmCalls === 0 },
  ];
  return { checks, ok: checks.every((c) => c.pass), salaryOfAll, ceilingOfAll, salaryOfCeiling };
}

export function formatReport(r: Report, s: Stats): string {
  const L: string[] = [];
  L.push('Hirelane enrichment coverage (open jobs)');
  L.push('');
  L.push(`  open jobs                         ${s.openJobs}`);
  L.push(`  postings                          ${s.postings.open} open / ${s.postings.total} total, ${s.postings.linked} linked`);
  L.push(`  dedup clusters                    ${s.clusters.jobsWithMultiplePostings} jobs hold ${s.clusters.mergedPostings} merged postings`);
  L.push('');
  L.push('  Salary');
  L.push(`    stated anywhere (ceiling)       ${s.salaryStatedAnywhere}  ${pct(r.ceilingOfAll)} of all jobs`);
  L.push(`    parsed into a salary            ${s.withSalary}  ${pct(r.salaryOfAll)} of all jobs`);
  L.push(`    captured / ceiling              ${pct(r.salaryOfCeiling)}   <- gated at >= ${pct(TARGETS.salaryOfCeiling)}`);
  L.push(`    stated anywhere AND parsed      ${s.salaryAmongStated}`);
  L.push('');
  L.push(`  workplace known                   ${pct(ratio(s.workplaceKnown, s.openJobs))}`);
  L.push(`  level known                       ${pct(ratio(s.levelKnown, s.openJobs))}`);
  L.push('');
  for (const c of r.checks) {
    const isCount = c.target === 0;
    const v = isCount ? String(c.value) : pct(c.value);
    const t = isCount ? '= 0' : `>= ${pct(c.target)}`;
    L.push(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name.padEnd(44)} ${v.padStart(8)}   (target ${t})`);
  }
  L.push('');
  L.push(`  llm_calls=${s.llmCalls}`);
  L.push(r.ok ? 'RESULT: PASS' : 'RESULT: FAIL');
  return L.join('\n');
}
