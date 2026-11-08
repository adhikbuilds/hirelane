import {
  defaultSkillIndex,
  formatSalary,
  parsePastedJob,
  scoreForProfile,
  skillLabel,
  type CgpaRule,
  type EligibilityProfileInput,
  type UniversityRule,
} from '@hirelane/engine';
import type { StudentFit } from '../picks/rank';
import type { PasteResult } from './types';

const skillIndex = defaultSkillIndex();
const labelOf = (id: string): string => skillLabel(skillIndex, id) ?? id;

export interface PasteContext {
  profile: EligibilityProfileInput | null;
  cgpaRule: CgpaRule;
  /** The university row of the student's campus, or null. */
  universityRule?: UniversityRule | null;
  fit: StudentFit;
  now: Date;
  /** A link shared with the paste. Parsed as a string only. */
  url: string | null;
}

/**
 * The paste-a-job verdict for one student. Pure: the existing engine parses the text (parsePastedJob), checks the stated rules
 * against the student's confirmed profile and weighs the fit (scoreForProfile), and reads scam signals (detectScamSignals).
 * Nothing is fetched, stored or sent to a model.
 */
export function assessPaste(text: string, ctx: PasteContext): PasteResult {
  const job = parsePastedJob(text, { sharedUrl: ctx.url });
  const score = scoreForProfile(
    job,
    { skillIds: ctx.fit.skillIds, cities: ctx.fit.cities, remote: ctx.fit.remote, yearsExperience: ctx.fit.yearsExperience },
    ctx.profile,
    { now: ctx.now, cgpaRule: ctx.cgpaRule, universityRule: ctx.universityRule ?? null },
  );

  const have = new Set(ctx.fit.skillIds);
  const matchedSkills: string[] = [];
  const missingSkills: string[] = [];
  for (const r of job.requirements) {
    if (r.kind !== 'must' || r.skillIds.length === 0) continue;
    const ok = r.skillIds.every((s) => have.has(s));
    for (const s of r.skillIds) {
      const label = labelOf(s);
      if (ok && !matchedSkills.includes(label)) matchedSkills.push(label);
      if (!ok && !have.has(s) && !missingSkills.includes(label)) missingSkills.push(label);
    }
  }

  const rules: PasteResult['eligibility']['rules'] =
    score.eligibility.verdicts.length === 0
      ? [{ text: 'The paste states no academic rules', status: score.eligibility.overall === 'fail' ? 'fail' : 'pass' }]
      : score.eligibility.verdicts.map((v) => ({ text: v.reason, status: v.status }));

  let pay: PasteResult['job']['pay'] = { stated: false, text: 'not stated' };
  if (job.salary) {
    let text = '';
    try {
      text = formatSalary({ minMinor: job.salary.minMinor, maxMinor: job.salary.maxMinor, currency: job.salary.currency, period: job.salary.period });
    } catch {
      text = '';
    }
    pay = { stated: true, text: text || 'Pay is stated in the paste' };
  }

  return {
    job: {
      title: job.title,
      company: job.company,
      locations: job.locations,
      workplace: job.workplace,
      level: job.level,
      fresher: { fresher: job.fresher.fresher, reason: job.fresher.reason },
      pay,
      applyUrl: job.applyUrl,
      source: job.sourceHint,
    },
    eligibility: {
      overall: score.eligibility.overall === 'pass' ? 'eligible' : score.eligibility.overall === 'fail' ? 'not_eligible' : 'check',
      rules,
    },
    fit: {
      verdict: score.verdict,
      mustHaves: { matched: score.mustHaves.matched, total: score.mustHaves.total, matchedSkills, missingSkills },
      conditions: score.worthwhile.conditions.map((c) => ({ name: c.name, pass: c.pass, detail: c.detail })),
      locationFit: score.worthwhile.info.locationFit,
    },
    scam: {
      risk: job.scamFlags.risk,
      flagged: job.scamFlags.flagged,
      signals: job.scamFlags.signals.map((s) => ({ id: s.id, severity: s.severity, quote: s.quote.slice(0, 200) })),
    },
  };
}
