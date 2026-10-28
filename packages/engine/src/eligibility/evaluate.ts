/**
 * evaluateEligibility: criteria x confirmed profile -> pass / fail / unknown per criterion (Amendment B section 8).
 * Rule that protects students: fail only on a definite contrary value. Anything missing, invalid, inferred or
 * dependent on an absent CGPA rule is unknown. Unknown never blocks the worthwhile gate; fail does.
 */
import { applyCgpaRule, invertCgpaRule } from './cgpa';
import { branchesRelated, canonBranch, canonDegree } from './criteria';
import type { CgpaRule, Criterion, CriterionVerdict, EligibilityProfileInput, EligibilityResult, VerdictStatus } from './types';

export interface EvaluateOptions {
  cgpaRule: CgpaRule;
}

type Field = keyof EligibilityProfileInput;
interface Part {
  status: VerdictStatus;
  reason: string;
  field?: Field;
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
/** A finite number inside [lo, hi]; JSON null, NaN and out-of-range values read as absent. */
const val = (x: unknown, lo: number, hi: number): number | undefined => (isNum(x) && x >= lo && x <= hi ? x : undefined);
const unk = (reason: string, field?: Field): Part => (field ? { status: 'unknown', reason, field } : { status: 'unknown', reason });

function roll(parts: Part[]): Part {
  const fail = parts.find((p) => p.status === 'fail');
  if (fail) return fail;
  const unknown = parts.find((p) => p.status === 'unknown');
  if (unknown) return unknown;
  return parts[0] ?? unk('nothing to check');
}

function compare(have: number, need: number, label: string, field: Field): Part {
  return have >= need
    ? { status: 'pass', reason: `${label} ${have} meets the ${need} minimum`, field }
    : { status: 'fail', reason: `${label} ${have} is below the ${need} minimum`, field };
}

function secondary(c: Extract<Criterion, { type: 'min_score' }>, p: EligibilityProfileInput): Part {
  const hasTwelve = c.levels.includes('12th');
  const hasDip = c.levels.includes('diploma');
  const kind = p.secondary_kind === '12th' || p.secondary_kind === 'diploma' ? p.secondary_kind : undefined;
  if (!kind) return unk('12th or diploma not stated in the profile', 'secondary_kind');
  if (kind === 'diploma' && !hasDip) return unk('the notice names 12th and does not say diploma is accepted', 'secondary_kind');
  if (kind === '12th' && !hasTwelve) return { status: 'pass', reason: 'diploma-only rule does not apply to a 12th student', field: 'secondary_kind' };
  const have = val(p.pct_secondary, 0, 100);
  if (have === undefined) return unk(`${kind} percentage missing`, 'pct_secondary');
  if (!isNum(c.pct)) return unk(`the notice states no percentage for ${kind}`, 'pct_secondary');
  return compare(have, c.pct, kind, 'pct_secondary');
}

function graduation(c: Extract<Criterion, { type: 'min_score' }>, p: EligibilityProfileInput, rule: CgpaRule): Part {
  const score = p.grad_score;
  const scale = p.grad_scale;
  const cgpaScore = scale === 10 ? val(score, 0, 10) : undefined;
  let pct: number | null = null;
  if (scale === 100) pct = val(score, 0, 100) ?? null;
  else if (p.grad_conversion === 'direct') pct = val(p.grad_pct_equiv, 0, 100) ?? null;
  else if (cgpaScore !== undefined) pct = applyCgpaRule(cgpaScore, rule);

  const routes: Part[] = [];
  if (isNum(c.pct)) {
    routes.push(pct === null ? unk(cgpaScore !== undefined ? 'CGPA cannot be converted to a percentage without a campus rule' : 'graduation score missing or on an unmapped scale', 'grad_score') : compare(Math.round(pct * 100) / 100, c.pct, 'graduation %', 'grad_score'));
  }
  if (isNum(c.cgpa)) {
    let cg: number | null = cgpaScore ?? null;
    if (cg === null && pct !== null) cg = invertCgpaRule(pct, rule);
    routes.push(cg === null ? unk('graduation score cannot be put on the 10-point scale without a campus rule', 'grad_score') : compare(Math.round(cg * 100) / 100, c.cgpa, 'graduation CGPA', 'grad_score'));
  }
  if (!routes.length) return unk('no usable threshold in the notice', 'grad_score');
  const pass = routes.find((r) => r.status === 'pass');
  if (pass) return pass;
  const result = routes.every((r) => r.status === 'fail') ? routes[0]! : (routes.find((r) => r.status === 'unknown') ?? routes[0]!);
  if (result.status === 'fail' && p.grad_is_final === false) return unk(`${result.reason}, but the degree is not complete so the score can still change`, 'grad_is_final');
  return result;
}

function minScore(c: Extract<Criterion, { type: 'min_score' }>, p: EligibilityProfileInput, rule: CgpaRule): Part {
  const parts: Part[] = [];
  if (c.levels.includes('10th')) {
    const have = val(p.pct_10, 0, 100);
    parts.push(have === undefined ? unk('10th percentage missing', 'pct_10') : isNum(c.pct) ? compare(have, c.pct, '10th %', 'pct_10') : unk('the notice states no percentage for 10th', 'pct_10'));
  }
  if (c.levels.includes('12th') || c.levels.includes('diploma')) parts.push(secondary(c, p));
  if (c.levels.includes('ug') || c.levels.includes('pg')) parts.push(graduation(c, p, rule));
  return roll(parts);
}

function evalOne(c: Criterion, p: EligibilityProfileInput, rule: CgpaRule): Part {
  switch (c.type) {
    case 'min_score':
      return minScore(c, p, rule);
    case 'no_active_backlogs': {
      const n = val(p.active_backlogs, 0, 1000);
      if (n === undefined) return unk('active backlogs not stated', 'active_backlogs');
      return n === 0 ? { status: 'pass', reason: 'no active backlogs', field: 'active_backlogs' } : { status: 'fail', reason: `${n} active backlog(s)`, field: 'active_backlogs' };
    }
    case 'max_backlog_history': {
      const n = val(p.backlog_history, 0, 1000);
      if (n === undefined) return unk('backlog history not stated', 'backlog_history');
      return n <= c.n ? { status: 'pass', reason: `${n} backlog(s) in history, limit ${c.n}`, field: 'backlog_history' } : { status: 'fail', reason: `${n} backlog(s) in history, limit ${c.n}`, field: 'backlog_history' };
    }
    case 'passout_years': {
      const y = val(p.passout_year, 1990, 2100);
      if (y === undefined) return unk('passout year not stated', 'passout_year');
      return c.years.includes(y) ? { status: 'pass', reason: `passout ${y} is accepted`, field: 'passout_year' } : { status: 'fail', reason: `passout ${y} is not in ${c.years.join(', ')}`, field: 'passout_year' };
    }
    case 'degrees': {
      const code = canonDegree(p.degree);
      if (!code) return unk('degree missing or not recognised', 'degree');
      return c.list.includes(code) ? { status: 'pass', reason: `${code} is listed`, field: 'degree' } : { status: 'fail', reason: `${code} is not among ${c.list.join(', ')}`, field: 'degree' };
    }
    case 'branches': {
      const code = canonBranch(p.branch_code) ?? canonBranch(p.branch_raw);
      if (!code) return unk('branch missing or not recognised', 'branch_code');
      if (c.list.includes(code)) return { status: 'pass', reason: `${code} is listed`, field: 'branch_code' };
      if (c.list.some((b) => branchesRelated(code, b))) return unk(`${code} is related to a listed branch; the notice may accept it`, 'branch_code');
      return { status: 'fail', reason: `${code} is not among ${c.list.join(', ')}`, field: 'branch_code' };
    }
    case 'max_gap_years': {
      const g = val(p.gap_years, 0, 100);
      if (g === undefined) return unk('education gap not stated', 'gap_years');
      return g <= c.n ? { status: 'pass', reason: `gap ${g} year(s), limit ${c.n}`, field: 'gap_years' } : { status: 'fail', reason: `gap ${g} year(s), limit ${c.n}`, field: 'gap_years' };
    }
  }
}

export function evaluateEligibility(
  criteria: readonly Criterion[],
  profile: EligibilityProfileInput | null | undefined,
  opts: EvaluateOptions = { cgpaRule: null },
): EligibilityResult {
  const confirmed = !!profile && (profile as { confirmed?: unknown }).confirmed === true;
  const rule = opts?.cgpaRule ?? null;
  const verdicts: CriterionVerdict[] = criteria.map((criterion) => {
    const part: Part = confirmed ? evalOne(criterion, profile as EligibilityProfileInput, rule) : unk('profile not confirmed by the student');
    const v: CriterionVerdict = { criterion, status: part.status, reason: part.reason };
    if (part.field) v.profileField = part.field;
    return v;
  });
  const overall: VerdictStatus = !confirmed ? 'unknown' : verdicts.some((v) => v.status === 'fail') ? 'fail' : verdicts.some((v) => v.status === 'unknown') ? 'unknown' : 'pass';
  return { overall, verdicts };
}
