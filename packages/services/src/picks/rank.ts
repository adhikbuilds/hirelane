import {
  assessFresher,
  defaultSkillIndex,
  evaluateEligibility,
  formatSalary,
  isWorthwhile,
  parseCriteria,
  skillLabel,
  type CgpaRule,
  type EligibilityProfileInput,
  type Iso4217,
  type Level,
  type PayPeriod,
  type UniversityRule,
} from '@hirelane/engine';
import { LEVEL_VALUES } from './levels';
import type { Pick } from './types';

/** A pick must have been posted (or first seen) under this many days ago. */
export const PICK_MAX_AGE_DAYS = 14;
/** The most roles one student is shown in a day. */
export const MAX_PICKS_PER_DAY = 10;
const DAY_MS = 86_400_000;

/** What the ranking needs of one ingested job. Plain values; the loader builds these from the jobs tables. */
export interface JobCandidate {
  id: string;
  slug: string;
  companyId: string;
  companyName: string;
  title: string;
  titleNorm: string;
  level: string | null;
  descriptionText: string | null;
  locations: string[];
  remote: boolean;
  postedAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  closedAt: Date | null;
  salaryStated: boolean;
  salary: { minMinor: number | null; maxMinor: number | null; currency: string | null; period: string | null } | null;
  /** Must-have requirements: skill ids, or a years minimum. */
  musts: { text: string; skillIds: string[]; yearsMin: number | null }[];
}

export interface StudentFit {
  skillIds: readonly string[];
  cities: readonly string[];
  remote: boolean;
  yearsExperience: number;
}

export interface PickInput {
  jobs: readonly JobCandidate[];
  /** The confirmed eligibility profile, or null (every academic rule is then "could not be checked", never a block). */
  profile: EligibilityProfileInput | null;
  cgpaRule: CgpaRule;
  /** The university row of the student's campus, or null. */
  universityRule?: UniversityRule | null;
  fit: StudentFit;
  now: Date;
  /** Job ids not to show again (already applied to). */
  exclude: ReadonlySet<string>;
  /** A placed student has no picks. */
  placed: boolean;
  /** People the student knows at this job's company, or null when there is no source. */
  whoYouKnow?: (job: JobCandidate) => string[] | null;
}

const skillIndex = defaultSkillIndex();
const labelOf = (id: string): string => skillLabel(skillIndex, id) ?? id;

const asLevel = (l: string | null): Level | null => ((LEVEL_VALUES as readonly string[]).includes(l ?? '') ? (l as Level) : null);

function payOf(j: JobCandidate): Pick['pay'] {
  if (!j.salaryStated) return { stated: false, text: 'not stated' };
  const s = j.salary;
  if (s && s.currency && s.period && (s.minMinor !== null || s.maxMinor !== null)) {
    try {
      const text = formatSalary({ minMinor: s.minMinor, maxMinor: s.maxMinor, currency: s.currency as Iso4217, period: s.period as PayPeriod });
      if (text) return { stated: true, text };
    } catch {
      // an unknown currency code falls through to the plain statement
    }
  }
  return { stated: true, text: 'Pay is stated in the posting' };
}

function postedOf(j: JobCandidate, now: Date): Pick['posted'] {
  const at = j.postedAt ?? j.firstSeenAt;
  const ageDays = Math.max(0, Math.floor((now.getTime() - at.getTime()) / DAY_MS));
  const label = ageDays === 0 ? 'Posted today' : `Posted ${ageDays} ${ageDays === 1 ? 'day' : 'days'} ago`;
  return { at: at.toISOString(), ageDays, label };
}

interface Scored {
  pick: Omit<Pick, 'rank'>;
  tier: 0 | 1;
  ratio: number;
  locationFit: boolean;
  ageMs: number;
  paid: boolean;
  id: string;
  dedupe: string;
}

/**
 * Today's ranked roles for one student, from ingested jobs. Pure: no database, no network, no clock (now is injected), 0 LLM
 * calls. In order:
 *  1. open, seen within 14 days, and posted (or first seen) under 14 days ago;
 *  2. the academic rules in the posting are checked against the confirmed profile: a hard fail is dropped and can never come
 *     back through ranking; an unknown rule stays, with its reason;
 *  3. the worthwhile gate (fresher-friendly, at least 60% of must-haves met, open, recently checked);
 *  4. the same role posted twice is kept once (the fresher posting);
 *  5. eligible before "check", then the better must-have match, location fit, newer, pay stated; ties by id;
 *  6. at most 10.
 */
export function buildPicks(input: PickInput): Pick[] {
  const nowMs = input.now.getTime();
  if (!Number.isFinite(nowMs)) throw new RangeError('buildPicks needs a valid now');
  if (input.placed) return [];
  const have = new Set(input.fit.skillIds);
  const scored: Scored[] = [];

  for (const j of input.jobs) {
    if (input.exclude.has(j.id) || j.closedAt !== null) continue;
    const postedMs = (j.postedAt ?? j.firstSeenAt).getTime();
    if (!(nowMs - postedMs < PICK_MAX_AGE_DAYS * DAY_MS)) continue;
    if (!(nowMs - j.lastSeenAt.getTime() < PICK_MAX_AGE_DAYS * DAY_MS)) continue;

    const text = j.descriptionText ?? '';
    const eligibility = evaluateEligibility(parseCriteria(text), input.profile, { cgpaRule: input.cgpaRule, universityRule: input.universityRule ?? null });
    if (eligibility.overall === 'fail') continue;

    let matched = 0;
    let total = 0;
    const matchedSkills: string[] = [];
    const missingSkills: string[] = [];
    for (const m of j.musts) {
      if (m.skillIds.length > 0) {
        total++;
        if (m.skillIds.every((s) => have.has(s))) {
          matched++;
          for (const s of m.skillIds) if (!matchedSkills.includes(s)) matchedSkills.push(s);
        } else {
          for (const s of m.skillIds) if (!have.has(s) && !missingSkills.includes(s)) missingSkills.push(s);
        }
      } else if (m.yearsMin !== null) {
        total++;
        if (input.fit.yearsExperience >= m.yearsMin) matched++;
      }
    }

    const fresher = assessFresher({
      title: j.title,
      level: asLevel(j.level),
      requirements: j.musts.map((m) => ({ kind: 'must', text: m.text, yearsMin: m.yearsMin, spanStart: 0, spanEnd: m.text.length })),
      text,
    });
    const gate = isWorthwhile({
      job: { fresher: fresher.fresher, open: true, lastCheckedAt: j.lastSeenAt, payStated: j.salaryStated, remote: j.remote, locations: j.locations },
      evidence: { mustMet: matched, mustTotal: total },
      user: { cities: input.fit.cities, remote: input.fit.remote },
      now: input.now,
      eligibility,
    });
    if (!gate.worthwhile) continue;

    const rules: Pick['rules'] =
      eligibility.verdicts.length === 0
        ? [{ text: 'The posting states no academic rules', status: 'pass' }]
        : eligibility.verdicts.map((v) => ({ text: v.reason, status: v.status === 'pass' ? ('pass' as const) : ('unknown' as const) }));
    const check = rules.some((r) => r.status === 'unknown');

    scored.push({
      pick: {
        jobId: j.id,
        slug: j.slug,
        company: j.companyName,
        title: j.title,
        locations: j.locations,
        remote: j.remote,
        eligibility: check ? 'check' : 'eligible',
        rules,
        mustHaves: { matched, total, matchedSkills: matchedSkills.map(labelOf), missingSkills: missingSkills.map(labelOf) },
        pay: payOf(j),
        whoYouKnow: input.whoYouKnow?.(j) ?? null,
        posted: postedOf(j, input.now),
      },
      tier: check ? 1 : 0,
      ratio: total === 0 ? 1 : matched / total,
      locationFit: gate.info.locationFit,
      ageMs: nowMs - postedMs,
      paid: j.salaryStated,
      id: j.id,
      dedupe: `${j.companyId}\u0000${j.titleNorm}`,
    });
  }

  const order = (a: Scored, b: Scored): number =>
    a.tier - b.tier ||
    b.ratio - a.ratio ||
    Number(b.locationFit) - Number(a.locationFit) ||
    a.ageMs - b.ageMs ||
    Number(b.paid) - Number(a.paid) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  scored.sort(order);
  const seen = new Set<string>();
  const out: Pick[] = [];
  for (const s of scored) {
    // The fresher posting of a duplicated role sorts first within its tier; keep only the best-ranked one of each role.
    if (seen.has(s.dedupe)) continue;
    seen.add(s.dedupe);
    out.push({ ...s.pick, rank: out.length + 1 });
    if (out.length === MAX_PICKS_PER_DAY) break;
  }
  return out;
}
