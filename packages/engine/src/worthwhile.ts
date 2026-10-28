/**
 * A8: the "worthwhile" gate. Pure; `now` is injected.
 * worthwhile = fresher-eligible AND >= 60% of must-haves with evidence AND job open AND checked within 14 days.
 * Pay and location are reported in `info` and never gate.
 */
import { EngineInvariantError } from './errors';
import { normPlace } from './places';

export const WORTHWHILE_MIN_MUST_RATIO = 0.6;
export const WORTHWHILE_MAX_CHECK_AGE_DAYS = 14;
const DAY_MS = 86_400_000;

type TimeLike = string | number | Date;

export interface WorthwhileInput {
  job: {
    fresher: boolean;
    open: boolean;
    lastCheckedAt: TimeLike | null;
    payStated: boolean;
    remote: boolean | null;
    locations: readonly string[];
  };
  evidence: { mustMet: number; mustTotal: number };
  user: { cities: readonly string[]; remote: boolean };
  now: TimeLike;
}

export interface WorthwhileCondition {
  name: 'fresher_eligible' | 'must_haves_met' | 'job_open' | 'recently_checked';
  pass: boolean;
  detail: string;
}

export interface WorthwhileResult {
  worthwhile: boolean;
  conditions: WorthwhileCondition[];
  info: { payStated: boolean; locationFit: boolean };
}

function toMs(t: TimeLike | null): number {
  if (t === null) return Number.NaN;
  return t instanceof Date ? t.getTime() : typeof t === 'number' ? t : Date.parse(t);
}

function locationFit(job: WorthwhileInput['job'], user: WorthwhileInput['user']): boolean {
  const wanted = user.cities.map(normPlace).filter((c) => c !== '');
  if (wanted.length === 0 && !user.remote) return true;
  if (user.remote && job.remote === true) return true;
  const places = job.locations.map(normPlace);
  return wanted.some((c) => places.some((p) => ` ${p} `.includes(` ${c} `)));
}

export function isWorthwhile(input: WorthwhileInput): WorthwhileResult {
  const { job, evidence: ev, user } = input;
  const nowMs = toMs(input.now);
  if (!Number.isFinite(nowMs)) throw new EngineInvariantError('worthwhile.now.invalid', 'now must be a valid time');
  const { mustMet, mustTotal } = ev;
  if (!Number.isInteger(mustMet) || !Number.isInteger(mustTotal) || mustMet < 0 || mustTotal < 0 || mustMet > mustTotal) {
    throw new EngineInvariantError('worthwhile.evidence.invalid', `invalid must-have counts ${mustMet}/${mustTotal}`);
  }

  const mustPass = mustTotal === 0 || mustMet / mustTotal >= WORTHWHILE_MIN_MUST_RATIO - 1e-12;
  const pct = mustTotal === 0 ? 100 : Math.round((mustMet / mustTotal) * 100);

  const checkedMs = toMs(job.lastCheckedAt);
  const ageDays = Number.isFinite(checkedMs) ? Math.max(0, (nowMs - checkedMs) / DAY_MS) : null;
  const fresh = ageDays !== null && ageDays <= WORTHWHILE_MAX_CHECK_AGE_DAYS;

  const conditions: WorthwhileCondition[] = [
    { name: 'fresher_eligible', pass: job.fresher, detail: job.fresher ? 'open to freshers' : 'not flagged as fresher-eligible' },
    {
      name: 'must_haves_met',
      pass: mustPass,
      detail: mustTotal === 0 ? 'no must-haves listed' : `${mustMet}/${mustTotal} must-haves with evidence (${pct}%, need ${WORTHWHILE_MIN_MUST_RATIO * 100}%)`,
    },
    { name: 'job_open', pass: job.open, detail: job.open ? 'job is open' : 'job is closed' },
    {
      name: 'recently_checked',
      pass: fresh,
      detail:
        ageDays === null
          ? 'never checked or unreadable check time'
          : `checked ${Math.floor(ageDays)} day${Math.floor(ageDays) === 1 ? '' : 's'} ago (limit ${WORTHWHILE_MAX_CHECK_AGE_DAYS})`,
    },
  ];
  return {
    worthwhile: conditions.every((c) => c.pass),
    conditions,
    info: { payStated: job.payStated, locationFit: locationFit(job, user) },
  };
}
