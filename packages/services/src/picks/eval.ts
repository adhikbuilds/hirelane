import type { EligibilityProfileInput } from '@hirelane/engine';
import { parseCriteria } from '@hirelane/engine';
import { buildPicks, type JobCandidate, type PickInput } from './rank';
import type { Pick } from './types';

/**
 * The picks eval. It builds a synthetic corpus (profiles and postings whose rules are known by construction), asks the picker for
 * each profile's picks, and fails if ANY pick breaks a hard eligibility rule.
 *
 * The judge is not the engine. Every posting is generated from a small rule set (a minimum percentage per level, "no active
 * backlogs", a passout year), so the expected verdict is plain arithmetic on the profile's numbers, written here. If the picker
 * (or the engine under it) ever lets a pick through that this arithmetic says fails, that is a violation. A rule the engine does
 * not parse back out of the text is reported too, because it would make the picker blind to that rule.
 *
 * Synthetic data only. 0 LLM calls, no network, no database.
 */

export const NOW = new Date('2026-10-31T04:00:00Z');
const DAY_MS = 86_400_000;

/** The rules a generated posting states. Absent means "not stated". */
export interface RuleSet {
  gradMin?: number;
  tenthMin?: number;
  twelfthMin?: number;
  noBacklog?: boolean;
  passout?: number;
}

/** The numbers a generated profile holds. Absent means the student has not given that figure (unknown, never a fail). */
export interface Numbers {
  grad?: number;
  tenth?: number;
  twelfth?: number;
  backlogs?: number;
  passout?: number;
}

/** Plain arithmetic: the first stated rule the numbers break, or null. */
export function hardFailure(rules: RuleSet, n: Numbers): string | null {
  if (rules.gradMin !== undefined && n.grad !== undefined && n.grad < rules.gradMin) return `graduation ${n.grad}% is under ${rules.gradMin}%`;
  if (rules.tenthMin !== undefined && n.tenth !== undefined && n.tenth < rules.tenthMin) return `10th ${n.tenth}% is under ${rules.tenthMin}%`;
  if (rules.twelfthMin !== undefined && n.twelfth !== undefined && n.twelfth < rules.twelfthMin) return `12th ${n.twelfth}% is under ${rules.twelfthMin}%`;
  if (rules.noBacklog && n.backlogs !== undefined && n.backlogs > 0) return `${n.backlogs} active backlogs against a no-backlog rule`;
  if (rules.passout !== undefined && n.passout !== undefined && n.passout !== rules.passout) return `passout ${n.passout} is not ${rules.passout}`;
  return null;
}

/** Number of rules the posting text states, which is how many criteria the engine must read back out of it. */
const ruleCount = (r: RuleSet): number => [r.gradMin, r.tenthMin, r.twelfthMin, r.noBacklog, r.passout].filter((x) => x !== undefined && x !== false).length;

export function postingText(r: RuleSet, i: number): string {
  const lines = [`Graduate Engineer Trainee ${i}. Open to freshers.`];
  if (r.gradMin !== undefined) lines.push(`Minimum ${r.gradMin}% in graduation.`);
  if (r.tenthMin !== undefined) lines.push(`Minimum ${r.tenthMin}% in 10th.`);
  if (r.twelfthMin !== undefined) lines.push(`Minimum ${r.twelfthMin}% in 12th.`);
  if (r.noBacklog) lines.push('No active backlogs.');
  if (r.passout !== undefined) lines.push(`${r.passout} passout only.`);
  lines.push('Skills: Python, SQL.');
  return lines.join('\n');
}

export function profileOf(n: Numbers): EligibilityProfileInput {
  const p: Record<string, unknown> = { confirmed: true, degree: 'BTECH', branch_code: 'CSE', gap_years: 0, backlog_history: 0, grad_conversion: 'direct', grad_scale: 100 };
  if (n.grad !== undefined) {
    p['grad_score'] = n.grad;
    p['grad_pct_equiv'] = n.grad;
    p['grad_is_final'] = true;
  }
  if (n.tenth !== undefined) p['pct_10'] = n.tenth;
  if (n.twelfth !== undefined) {
    p['pct_secondary'] = n.twelfth;
    p['secondary_kind'] = '12th';
  }
  if (n.backlogs !== undefined) p['active_backlogs'] = n.backlogs;
  if (n.passout !== undefined) p['passout_year'] = n.passout;
  return p as unknown as EligibilityProfileInput;
}

/** Small deterministic generator (mulberry32), so a failure reproduces from its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Violation {
  profile: number;
  job: string;
  why: string;
}
export interface EvalReport {
  profiles: number;
  jobs: number;
  /** Jobs the arithmetic says fail some profile: how often the gate had something to refuse. */
  hardFailsOffered: number;
  picksShown: number;
  violations: Violation[];
  /** A rule written into a posting that the engine did not read back. */
  unreadRules: string[];
}

export interface EvalOptions {
  seed?: number;
  profiles?: number;
  jobsPerProfile?: number;
  /** The function under test. Defaults to the real picker; the tests pass a broken one to prove this eval can fail. */
  pick?: (input: PickInput) => Pick[];
}

export function runPicksEval(opts: EvalOptions = {}): EvalReport {
  const rand = rng(opts.seed ?? 20261031);
  const choose = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const pick = opts.pick ?? buildPicks;
  const nProfiles = opts.profiles ?? 60;
  const nJobs = opts.jobsPerProfile ?? 40;
  const report: EvalReport = { profiles: nProfiles, jobs: 0, hardFailsOffered: 0, picksShown: 0, violations: [], unreadRules: [] };

  // The same postings are offered to every profile, with the rules each was built from.
  const rulesByJob = new Map<string, RuleSet>();
  const jobs: JobCandidate[] = [];
  for (let i = 0; i < nJobs; i++) {
    const rules: RuleSet = {};
    if (rand() < 0.5) rules.gradMin = choose([50, 55, 60, 65, 70, 75]);
    if (rand() < 0.3) rules.tenthMin = choose([50, 55, 60, 65]);
    if (rand() < 0.3) rules.twelfthMin = choose([50, 55, 60, 65]);
    if (rand() < 0.35) rules.noBacklog = true;
    if (rand() < 0.3) rules.passout = choose([2025, 2026]);
    const text = postingText(rules, i);
    const read = parseCriteria(text).length;
    if (read !== ruleCount(rules)) report.unreadRules.push(`job ${i}: wrote ${ruleCount(rules)} rule(s), the engine read ${read}: ${JSON.stringify(rules)}`);
    const id = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    rulesByJob.set(id, rules);
    jobs.push({
      id,
      slug: `eval-${i}`,
      companyId: `co-${i}`,
      companyName: `Eval Co ${i}`,
      title: `Graduate Engineer Trainee ${i}`,
      titleNorm: `graduate engineer trainee ${i}`,
      level: 'entry',
      descriptionText: text,
      locations: ['Pune'],
      remote: false,
      postedAt: new Date(NOW.getTime() - (i % 10) * DAY_MS),
      firstSeenAt: new Date(NOW.getTime() - (i % 10) * DAY_MS),
      lastSeenAt: NOW,
      closedAt: null,
      salary: null,
      salaryStated: false,
      musts: [{ text: 'Python', skillIds: ['python'], yearsMin: null }],
    });
    report.jobs++;
  }

  for (let p = 0; p < nProfiles; p++) {
    // Some figures are left out on purpose: an unknown must never be treated as a fail, and a fail must never slip through.
    const n: Numbers = {};
    if (rand() < 0.9) n.grad = choose([45, 52, 58, 61, 66, 72, 80]);
    if (rand() < 0.85) n.tenth = choose([48, 56, 63, 78, 90]);
    if (rand() < 0.85) n.twelfth = choose([49, 57, 64, 77, 88]);
    if (rand() < 0.9) n.backlogs = choose([0, 0, 0, 1, 3]);
    if (rand() < 0.9) n.passout = choose([2025, 2026, 2027]);
    for (const j of jobs) if (hardFailure(rulesByJob.get(j.id)!, n)) report.hardFailsOffered++;
    const picks = pick({ jobs, profile: profileOf(n), cgpaRule: null, fit: { skillIds: ['python', 'sql'], cities: ['pune'], remote: false, yearsExperience: 0 }, now: NOW, exclude: new Set(), placed: false });
    report.picksShown += picks.length;
    for (const k of picks) {
      const why = hardFailure(rulesByJob.get(k.jobId) ?? {}, n);
      if (why) report.violations.push({ profile: p, job: k.jobId, why });
    }
  }
  return report;
}

/** The eval's verdict as lines to print, and whether it passed. A run that checked nothing is a failure, not a pass. */
export function summarize(r: EvalReport): { ok: boolean; lines: string[] } {
  const lines = [`picks:eval ${r.profiles} profiles x ${r.jobs} postings: ${r.picksShown} picks shown, ${r.hardFailsOffered} hard fails offered to the gate, ${r.violations.length} violations, ${r.unreadRules.length} unread rules`];
  for (const v of r.violations.slice(0, 20)) lines.push(`  VIOLATION profile ${v.profile} job ${v.job}: ${v.why}`);
  for (const u of r.unreadRules.slice(0, 20)) lines.push(`  UNREAD ${u}`);
  const vacuous = r.picksShown === 0 || r.hardFailsOffered === 0;
  if (vacuous) lines.push('  the eval checked nothing (no picks, or no hard fails to refuse)');
  return { ok: r.violations.length === 0 && r.unreadRules.length === 0 && !vacuous, lines };
}
