/**
 * The autopilot estimate: how many new jobs a week would clear a rule like "min match 70, role X".
 *
 * There is no resume at this point, so there is no real match score. The proxy is deterministic, rule-only and
 * computed from the jobs alone: for each role family, a skill is CORE when at least CORE_SHARE of that family's jobs
 * posted in the window list it. A job's proxy score is the percentage of its listed skills that are core. Read it as
 * "how standard is this job for its role": a candidate who holds the core skills of the role would cover that share.
 * A job with no extracted skills scores 0. It is an estimate of volume, never a prediction of anyone's match.
 */
export const WINDOW_DAYS = 28;
export const CORE_SHARE = 0.1;

export type ProxyJob = { roleFamily: string | null; skills: readonly string[] };

export const ALL_ROLES = "*";

export const PROXY_METHOD =
  "Estimate. Jobs posted in the last 28 days are scored by the share of their listed skills that are core to their role " +
  "family (listed by at least 10% of that family's recent jobs). It is a rule-only proxy, not a match against your resume. " +
  "perWeek is the count of jobs at or above min, divided by 4.";

/** Proxy score 0-100 for every job, in input order. */
export function proxyScores(jobs: readonly ProxyJob[]): number[] {
  const families = new Map<string, { n: number; counts: Map<string, number> }>();
  const keyOf = (j: ProxyJob) => j.roleFamily ?? "";
  for (const j of jobs) {
    const f = families.get(keyOf(j)) ?? { n: 0, counts: new Map<string, number>() };
    f.n += 1;
    for (const s of new Set(j.skills)) f.counts.set(s, (f.counts.get(s) ?? 0) + 1);
    families.set(keyOf(j), f);
  }
  return jobs.map((j) => {
    const skills = [...new Set(j.skills)];
    if (skills.length === 0) return 0;
    const f = families.get(keyOf(j))!;
    const core = skills.filter((s) => (f.counts.get(s) ?? 0) / f.n >= CORE_SHARE).length;
    return Math.round((100 * core) / skills.length);
  });
}

/** Histogram: `out[role][s]` = jobs with proxy score >= s (s = 0..100), for each role and for ALL_ROLES. */
export type Snapshot = { asOf: string; jobsInWindow: number; atLeast: Record<string, number[]> };

export function buildSnapshot(jobs: readonly ProxyJob[], asOf: Date): Snapshot {
  const scores = proxyScores(jobs);
  const exact = new Map<string, number[]>();
  const bump = (key: string, score: number) => {
    const arr = exact.get(key) ?? new Array<number>(101).fill(0);
    arr[score] = (arr[score] ?? 0) + 1;
    exact.set(key, arr);
  };
  jobs.forEach((j, i) => {
    bump(ALL_ROLES, scores[i]!);
    if (j.roleFamily) bump(j.roleFamily, scores[i]!);
  });
  const atLeast: Record<string, number[]> = {};
  for (const [key, arr] of exact) {
    const cum = new Array<number>(101).fill(0);
    let run = 0;
    for (let s = 100; s >= 0; s--) {
      run += arr[s] ?? 0;
      cum[s] = run;
    }
    atLeast[key] = cum;
  }
  return { asOf: asOf.toISOString(), jobsInWindow: jobs.length, atLeast };
}

/** Jobs a week at or above `min` for `role` (all roles when null). Weeks = WINDOW_DAYS / 7. */
export function perWeekFrom(snapshot: Snapshot, min: number, role: string | null): number {
  const arr = snapshot.atLeast[role ?? ALL_ROLES];
  const count = arr ? (arr[Math.min(100, Math.max(0, Math.trunc(min)))] ?? 0) : 0;
  return Math.round(count / (WINDOW_DAYS / 7));
}
