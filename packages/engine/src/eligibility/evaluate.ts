/**
 * evaluateEligibility: criteria x confirmed profile -> pass / fail / unknown per criterion (Amendment B section 8).
 * Rule that protects students: fail only on a definite contrary value. Anything missing, invalid, inferred or
 * dependent on an absent CGPA rule is unknown. Unknown never blocks the worthwhile gate; fail does.
 *
 * Reasons are plain English with the maths shown (PRD E6): "Your 12th: 58%. Needs 60%. Short by 2%".
 * CGPA to percentage uses, in order: the campus rule, then the university rule when it is verified or the student
 * confirmed it, else the verdict stays unknown and says which rule is missing (PRD E5).
 */
import { applyCgpaRule, invertCgpaRule } from './cgpa';
import { branchesRelated, canonBranch, canonDegree } from './criteria';
import type { CgpaRule, Criterion, CriterionVerdict, EligibilityProfileInput, EligibilityResult, LevelVerdict, VerdictLevel, VerdictStatus } from './types';
import { toCgpaRule, type UniversityRule } from './university';

export interface EvaluateOptions {
  /** The campus rule (campuses.cgpa_rule). Always wins over a university rule. */
  cgpaRule: CgpaRule;
  /** The student's university rule from data/cgpa-rules.json. */
  universityRule?: UniversityRule | null;
  /** The student or the campus confirmed the university rule. Needed when the row is not verified. */
  universityRuleConfirmed?: boolean;
}

type Field = keyof EligibilityProfileInput;
interface Part {
  status: VerdictStatus;
  reason: string;
  field?: Field;
  level?: VerdictLevel;
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
/** A finite number inside [lo, hi]; JSON null, NaN and out-of-range values read as absent. */
const val = (x: unknown, lo: number, hi: number): number | undefined => (isNum(x) && x >= lo && x <= hi ? x : undefined);
const unk = (reason: string, field?: Field): Part => (field ? { status: 'unknown', reason, field } : { status: 'unknown', reason });

/** Trimmed number for what the student typed: 58, 55.5, 71.25. */
const fmt = (n: number): string => String(Math.round(n * 100 + 1e-9) / 100);
/** One decimal, for converted values and gaps. The +1e-9 keeps 76.94999999999999 printing as 77.0. */
export const round1 = (n: number): number => Math.round(n * 10 + 1e-9) / 10;
export const fmt1 = (n: number): string => round1(n).toFixed(1);
const gap = (n: number): string => String(Math.round(n * 10 + 1e-9) / 10);

const LEVEL_NAME: Record<VerdictLevel, string> = { '10th': 'Your 10th', '12th': 'Your 12th', diploma: 'Your diploma', graduation: 'Your graduation' };

function roll(parts: Part[]): Part {
  const fail = parts.find((p) => p.status === 'fail');
  if (fail) return fail;
  const unknown = parts.find((p) => p.status === 'unknown');
  if (unknown) return unknown;
  return parts[0] ?? unk('There is nothing to check');
}

/** A stated number against a minimum: "Your 12th: 58%. Needs 60%. Short by 2%". */
function compareStated(have: number, need: number, level: VerdictLevel, field: Field, unit: '%' | ' CGPA'): Part {
  const label = unit === '%' ? `${LEVEL_NAME[level]}: ${fmt(have)}%` : `${LEVEL_NAME[level]} CGPA: ${fmt(have)}`;
  const needTxt = unit === '%' ? `${fmt(need)}%` : fmt(need);
  return have >= need
    ? { status: 'pass', reason: `${label}. Needs ${needTxt}: you meet it`, field, level }
    : { status: 'fail', reason: `${label}. Needs ${needTxt}. Short by ${gap(need - have)}${unit === '%' ? '%' : ''}`, field, level };
}

export interface Conversion {
  rule: { a: number; b: number };
  /** "RGPV's rule" or "your campus's rule" */
  who: string;
}
export interface Resolved {
  conv: Conversion | null;
  /** Why there is no conversion, for the unknown reason. */
  missing: string;
}

export function resolveConversion(opts: EvaluateOptions): Resolved {
  const campus = opts.cgpaRule;
  if (campus && campus.kind === 'linear' && isNum(campus.a) && isNum(campus.b)) return { conv: { rule: campus, who: "your campus's rule" }, missing: '' };
  const u = opts.universityRule;
  if (u) {
    if (u.verified || opts.universityRuleConfirmed === true) return { conv: { rule: toCgpaRule(u), who: `${u.short}'s rule` }, missing: '' };
    return { conv: null, missing: `${u.short}'s rule (${u.formula}) is not confirmed yet. Confirm it to see if you meet this` };
  }
  return { conv: null, missing: 'We need your university\'s CGPA to % rule. Pick your university or ask your campus' };
}

function secondary(c: Extract<Criterion, { type: 'min_score' }>, p: EligibilityProfileInput): Part {
  const hasTwelve = c.levels.includes('12th');
  const hasDip = c.levels.includes('diploma');
  const kind = p.secondary_kind === '12th' || p.secondary_kind === 'diploma' ? p.secondary_kind : undefined;
  const lvl: VerdictLevel = kind ?? (hasTwelve ? '12th' : 'diploma');
  if (!kind) return { ...unk('Your profile does not say if you did 12th or a diploma. Add it to check this', 'secondary_kind'), level: lvl };
  if (kind === 'diploma' && !hasDip) return { ...unk('You did a diploma and this notice names 12th without saying a diploma is accepted. Ask the campus', 'secondary_kind'), level: lvl };
  if (kind === '12th' && !hasTwelve) return { status: 'pass', reason: 'This rule is for diploma holders. It does not apply to your 12th', field: 'secondary_kind', level: lvl };
  const have = val(p.pct_secondary, 0, 100);
  if (have === undefined) return { ...unk(`Your ${kind} percentage is missing. Add it to check this`, 'pct_secondary'), level: lvl };
  if (!isNum(c.pct)) return { ...unk(`The notice states no percentage for ${kind}`, 'pct_secondary'), level: lvl };
  return compareStated(have, c.pct, lvl, 'pct_secondary', '%');
}

function graduation(c: Extract<Criterion, { type: 'min_score' }>, p: EligibilityProfileInput, opts: EvaluateOptions): Part {
  const L: VerdictLevel = 'graduation';
  const score = p.grad_score;
  const scale = p.grad_scale;
  const cgpaScore = scale === 10 ? val(score, 0, 10) : undefined;
  const { conv, missing } = resolveConversion(opts);
  const four = scale === 4 || scale === 5;

  // The student's graduation result on the percent side: a number plus how it was reached.
  let pct: number | null = null;
  /** The converted value before rounding. Cutoffs are compared on this, never on the one-decimal display value. */
  let pctExact: number | null = null;
  let how = '';
  if (scale === 100) {
    pct = val(score, 0, 100) ?? null;
    if (pct !== null) how = `${LEVEL_NAME[L]}: ${fmt(pct)}%`;
  } else if (p.grad_conversion === 'direct') {
    pct = val(p.grad_pct_equiv, 0, 100) ?? null;
    if (pct !== null) how = `${LEVEL_NAME[L]}: ${fmt(pct)}%`;
  } else if (cgpaScore !== undefined && conv) {
    const converted = applyCgpaRule(cgpaScore, conv.rule as NonNullable<CgpaRule>);
    if (converted !== null) {
      pct = round1(converted);
      pctExact = converted;
      how = `${cgpaScore.toFixed(1)} CGPA = ${fmt1(pct)}% by ${conv.who}`;
    }
  }
  const converted = how.includes(' by ');

  const routes: Part[] = [];
  if (isNum(c.pct)) {
    if (pct === null) {
      let why: string;
      if (cgpaScore !== undefined) why = `Your ${cgpaScore.toFixed(1)} CGPA cannot be turned into a percentage yet. ${missing}`;
      else if (four) why = `Your CGPA is out of ${scale}. A % rule for it is not available`;
      else why = 'Your graduation score is missing or on a scale we cannot read. Add it to check this';
      routes.push({ ...unk(why, 'grad_score'), level: L });
    } else {
      const need = c.pct;
      // Compared at the two decimals universities print, not at the one-decimal display value: 59.9999 is 60.00 and meets 60,
      // 59.95 is not 60.
      const ok = Math.round((pctExact ?? pct) * 100 + 1e-9) / 100 >= need;
      const needTxt = `${fmt(need)}%`;
      if (converted) {
        // 59.95 shows as 60.0 at one decimal; when that would hide a miss, show two decimals so the reason is not self-contradicting.
        const shown = !ok && pct >= need && pctExact !== null ? how.replace(`${fmt1(pct)}%`, `${(Math.floor(pctExact * 100) / 100).toFixed(2)}%`) : how;
        const short = pct < need || pctExact === null ? need - pct : Math.round((need - pctExact) * 100) / 100;
        routes.push({ status: ok ? 'pass' : 'fail', reason: ok ? `${shown}, needs ${needTxt}: you meet it` : `${shown}, needs ${needTxt}. Short by ${short < 0.1 ? short.toFixed(2) : gap(short)}%`, field: 'grad_score', level: L });
      } else routes.push(compareStated(pct, need, L, 'grad_score', '%'));
    }
  }
  if (isNum(c.cgpa)) {
    if (cgpaScore !== undefined) routes.push(compareStated(cgpaScore, c.cgpa, L, 'grad_score', ' CGPA'));
    else {
      const stated = scale === 100 ? val(score, 0, 100) : p.grad_conversion === 'direct' ? val(p.grad_pct_equiv, 0, 100) : undefined;
      const cg = stated !== undefined && conv ? invertCgpaRule(stated, conv.rule as NonNullable<CgpaRule>) : null;
      if (cg === null || stated === undefined) routes.push({ ...unk(`Your graduation score cannot be put on the 10-point scale yet. ${missing || 'Add a 10-point CGPA to check this'}`, 'grad_score'), level: L });
      else {
        const r = Math.round(cg * 100 + 1e-9) / 100;
        const ok = r >= c.cgpa;
        const how2 = `${fmt(stated)}% = ${r.toFixed(2)} CGPA by ${conv!.who}`;
        routes.push({ status: ok ? 'pass' : 'fail', reason: ok ? `${how2}, needs ${fmt(c.cgpa)} CGPA: you meet it` : `${how2}, needs ${fmt(c.cgpa)} CGPA. Short by ${gap(c.cgpa - r)}`, field: 'grad_score', level: L });
      }
    }
  }
  if (!routes.length) return { ...unk('The notice gives no graduation minimum we can read', 'grad_score'), level: L };
  const pass = routes.find((r) => r.status === 'pass');
  if (pass) return pass;
  const result = routes.every((r) => r.status === 'fail') ? routes[0]! : (routes.find((r) => r.status === 'unknown') ?? routes[0]!);
  if (result.status === 'fail' && p.grad_is_final === false) return { ...unk(`${result.reason}. Your degree is not finished, so your score can still change`, 'grad_is_final'), level: L };
  return result;
}

function minScore(c: Extract<Criterion, { type: 'min_score' }>, p: EligibilityProfileInput, opts: EvaluateOptions): { top: Part; levels: LevelVerdict[] } {
  const parts: Part[] = [];
  if (c.levels.includes('10th')) {
    const have = val(p.pct_10, 0, 100);
    parts.push(
      have === undefined
        ? { ...unk('Your 10th percentage is missing. Add it to check this', 'pct_10'), level: '10th' }
        : isNum(c.pct)
          ? compareStated(have, c.pct, '10th', 'pct_10', '%')
          : { ...unk('The notice states no percentage for 10th', 'pct_10'), level: '10th' },
    );
  }
  if (c.levels.includes('12th') || c.levels.includes('diploma')) parts.push(secondary(c, p));
  if (c.levels.includes('ug') || c.levels.includes('pg')) parts.push(graduation(c, p, opts));
  const levels: LevelVerdict[] = parts.map((x) => {
    const l: LevelVerdict = { level: x.level ?? 'graduation', status: x.status, reason: x.reason };
    if (x.field) l.profileField = x.field;
    return l;
  });
  let top = roll(parts);
  if (parts.length > 1 && parts.every((x) => x.status === 'pass') && isNum(c.pct)) {
    top = { status: 'pass', reason: `You meet ${fmt(c.pct)}% at every level: ${levels.map((l) => (l.level === 'graduation' ? 'graduation' : l.level)).join(', ')}`, field: parts[0]!.field };
  }
  return { top, levels };
}

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;

function evalOne(c: Criterion, p: EligibilityProfileInput, opts: EvaluateOptions): Part & { levels?: LevelVerdict[] } {
  switch (c.type) {
    case 'min_score': {
      const r = minScore(c, p, opts);
      return { ...r.top, levels: r.levels };
    }
    case 'no_active_backlogs': {
      const n = val(p.active_backlogs, 0, 1000);
      if (n === undefined) return unk('Your active backlogs are not in your profile yet. Add them to check this', 'active_backlogs');
      return n === 0 ? { status: 'pass', reason: 'You have no active backlogs: you meet it', field: 'active_backlogs' } : { status: 'fail', reason: `You have ${plural(n, 'active backlog')}. This drive needs none`, field: 'active_backlogs' };
    }
    case 'max_backlog_history': {
      const n = val(p.backlog_history, 0, 1000);
      if (n === undefined) return unk('Your backlog history is not in your profile yet. Add it to check this', 'backlog_history');
      return n <= c.n
        ? { status: 'pass', reason: `Your backlog history: ${n}. Allowed up to ${c.n}: you meet it`, field: 'backlog_history' }
        : { status: 'fail', reason: `Your backlog history: ${n}. Allowed up to ${c.n}. Over by ${n - c.n}`, field: 'backlog_history' };
    }
    case 'passout_years': {
      const y = val(p.passout_year, 1990, 2100);
      if (y === undefined) return unk('Your passout year is not in your profile yet. Add it to check this', 'passout_year');
      return c.years.includes(y)
        ? { status: 'pass', reason: `Your passout year ${y} is accepted`, field: 'passout_year' }
        : { status: 'fail', reason: `Your passout year is ${y}. This drive takes ${c.years.join(', ')}`, field: 'passout_year' };
    }
    case 'degrees': {
      const code = canonDegree(p.degree);
      if (!code) return unk('Your degree is missing or we do not recognise it. Check your profile', 'degree');
      return c.list.includes(code)
        ? { status: 'pass', reason: `Your degree ${code} is on the list`, field: 'degree' }
        : { status: 'fail', reason: `Your degree is ${code}. This drive takes ${c.list.join(', ')}`, field: 'degree' };
    }
    case 'branches': {
      const code = canonBranch(p.branch_code) ?? canonBranch(p.branch_raw);
      if (!code) return unk('Your branch is missing or we do not recognise it. Check your profile', 'branch_code');
      if (c.list.includes(code)) return { status: 'pass', reason: `Your branch ${code} is on the list`, field: 'branch_code' };
      if (c.list.some((b) => branchesRelated(code, b))) return unk(`Your branch ${code} is close to ${c.list.join(', ')}. The drive may accept it, so ask the campus`, 'branch_code');
      return { status: 'fail', reason: `Your branch is ${code}. This drive takes ${c.list.join(', ')}`, field: 'branch_code' };
    }
    case 'max_gap_years': {
      const g = val(p.gap_years, 0, 100);
      if (g === undefined) return unk('Your education gap is not in your profile yet. Add it to check this', 'gap_years');
      return g <= c.n
        ? { status: 'pass', reason: `Your gap: ${plural(g, 'year')}. Allowed up to ${c.n}: you meet it`, field: 'gap_years' }
        : { status: 'fail', reason: `Your gap: ${plural(g, 'year')}. Allowed up to ${c.n}. Over by ${g - c.n}`, field: 'gap_years' };
    }
  }
}

export function evaluateEligibility(
  criteria: readonly Criterion[],
  profile: EligibilityProfileInput | null | undefined,
  opts: EvaluateOptions = { cgpaRule: null },
): EligibilityResult {
  const confirmed = !!profile && (profile as { confirmed?: unknown }).confirmed === true;
  const o: EvaluateOptions = { cgpaRule: opts?.cgpaRule ?? null, universityRule: opts?.universityRule ?? null, universityRuleConfirmed: opts?.universityRuleConfirmed === true };
  const verdicts: CriterionVerdict[] = criteria.map((criterion) => {
    if (!confirmed) return { criterion, status: 'unknown', reason: 'Your profile is not confirmed yet. Confirm it to check this' };
    const part = evalOne(criterion, profile as EligibilityProfileInput, o);
    const v: CriterionVerdict = { criterion, status: part.status, reason: part.reason };
    if (part.field) v.profileField = part.field;
    if (part.levels) v.levels = part.levels;
    return v;
  });
  const overall: VerdictStatus = !confirmed ? 'unknown' : verdicts.some((v) => v.status === 'fail') ? 'fail' : verdicts.some((v) => v.status === 'unknown') ? 'unknown' : 'pass';
  return { overall, verdicts };
}
