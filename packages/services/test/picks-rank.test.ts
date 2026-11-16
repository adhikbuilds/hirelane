import { describe, expect, it } from 'vitest';
import { buildPicks, MAX_PICKS_PER_DAY, PICK_MAX_AGE_DAYS, PickSchema, PicksSchema, type JobCandidate, type PickInput } from '../src/picks';

// Pure ranking: no database, no clock, no network. Synthetic jobs only.
const NOW = new Date('2026-10-31T04:00:00Z');
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000);

let seq = 0;
function job(over: Partial<JobCandidate> = {}): JobCandidate {
  const n = ++seq;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    slug: `job-${n}`,
    companyId: `c-${n}`,
    companyName: `Acme ${n}`,
    title: `Graduate Engineer Trainee ${n}`,
    titleNorm: `graduate engineer trainee ${n}`,
    level: 'entry',
    descriptionText: 'Graduate Engineer Trainee. Open to freshers. Skills: Python, SQL.',
    locations: ['Pune'],
    remote: false,
    postedAt: daysAgo(2),
    firstSeenAt: daysAgo(2),
    lastSeenAt: daysAgo(0),
    closedAt: null,
    salary: null,
    salaryStated: false,
    musts: [{ text: 'Python', skillIds: ['python'], yearsMin: null }],
    ...over,
  };
}
const profile = (over: Record<string, unknown> = {}) =>
  ({ confirmed: true, pct_10: 82, pct_secondary: 74, grad_score: 7.8, grad_scale: 10, grad_pct_equiv: 74.1, grad_conversion: 'direct', active_backlogs: 0, backlog_history: 0, gap_years: 0, passout_year: 2026, degree: 'BTECH', branch_code: 'CSE', ...over }) as PickInput['profile'];
function run(jobs: JobCandidate[], over: Partial<PickInput> = {}) {
  return buildPicks({
    jobs,
    profile: profile(),
    cgpaRule: null,
    fit: { skillIds: ['python', 'sql'], cities: ['pune'], remote: false, yearsExperience: 0 },
    now: NOW,
    exclude: new Set(),
    placed: false,
    ...over,
  });
}

describe('eligibility verdicts decide what shows', () => {
  it('a hard fail never shows', () => {
    const failing = job({ descriptionText: 'Graduate Engineer Trainee. 2026 passout freshers. Minimum 80% in graduation. Skills: Python.' });
    const passing = job();
    const picks = run([failing, passing], { profile: profile({ grad_pct_equiv: 74.1 }) });
    expect(picks.map((p) => p.jobId)).toEqual([passing.id]);
  });

  it('an active backlog fails a no-backlog rule; the same job shows to a student with none', () => {
    const j = job({ descriptionText: 'Graduate Engineer Trainee. Freshers, 2026 passout. No active backlogs. Skills: Python.' });
    expect(run([j], { profile: profile({ active_backlogs: 2 }) })).toEqual([]);
    expect(run([j], { profile: profile({ active_backlogs: 0 }) })).toHaveLength(1);
  });

  it('an unknown rule shows, with its reason', () => {
    const j = job({ descriptionText: 'Graduate Engineer Trainee. Freshers. Minimum 60% in graduation. Skills: Python.' });
    const [p] = run([j], { profile: profile({ grad_pct_equiv: undefined, grad_conversion: 'unknown' }) });
    expect(p).toBeDefined();
    expect(p!.eligibility).toBe('check');
    const unknown = p!.rules.filter((r) => r.status === 'unknown');
    expect(unknown.length).toBeGreaterThan(0);
    expect(unknown[0]!.text.length).toBeGreaterThan(10);
  });

  it('a student with no confirmed profile sees roles marked as needing a check, never a block', () => {
    const j = job({ descriptionText: 'Graduate Engineer Trainee. Freshers. 2026 passout. No active backlogs. Skills: Python.' });
    const [p] = run([j], { profile: null });
    expect(p!.eligibility).toBe('check');
    expect(p!.rules.every((r) => r.status === 'unknown')).toBe(true);
  });

  it('every pass line carries its maths or the profile value it used', () => {
    const [p] = run([job({ descriptionText: 'Graduate Engineer Trainee. Freshers. 2026 passout. Minimum 60% in graduation. Skills: Python.' })]);
    expect(p!.eligibility).toBe('eligible');
    expect(p!.rules.length).toBeGreaterThan(0);
    expect(p!.rules.every((r) => r.status === 'pass' && /\d/.test(r.text))).toBe(true);
  });

  it('a posting with no stated academic rule says so instead of showing an empty list', () => {
    const [p] = run([job()]);
    expect(p!.rules).toEqual([{ text: 'The posting states no academic rules', status: 'pass' }]);
  });
});

describe('freshness, the worthwhile gate, duplicates and the daily cap', () => {
  it('a role older than 14 days never shows; 13 days does', () => {
    const old = job({ postedAt: daysAgo(PICK_MAX_AGE_DAYS + 1), firstSeenAt: daysAgo(PICK_MAX_AGE_DAYS + 1) });
    const edge = job({ postedAt: daysAgo(13), firstSeenAt: daysAgo(13) });
    expect(PICK_MAX_AGE_DAYS).toBe(14);
    expect(run([old, edge]).map((p) => p.jobId)).toEqual([edge.id]);
  });

  it('a role with no posted date is aged from when we first saw it', () => {
    const j = job({ postedAt: null, firstSeenAt: daysAgo(20) });
    expect(run([j])).toEqual([]);
    expect(run([job({ postedAt: null, firstSeenAt: daysAgo(3) })])).toHaveLength(1);
  });

  it('a closed role and a role we have not seen in over 14 days never show', () => {
    expect(run([job({ closedAt: daysAgo(1) })])).toEqual([]);
    expect(run([job({ lastSeenAt: daysAgo(15) })])).toEqual([]);
  });

  it('a role that is not for freshers is gated out', () => {
    expect(run([job({ title: 'Senior Staff Engineer', titleNorm: 'senior staff engineer', level: 'senior', descriptionText: '8+ years of experience building distributed systems.' })])).toEqual([]);
  });

  it('a role whose must-haves the student does not meet (under 60%) is gated out', () => {
    const j = job({
      musts: [
        { text: 'Rust', skillIds: ['rust'], yearsMin: null },
        { text: 'Go', skillIds: ['go'], yearsMin: null },
        { text: 'Kubernetes', skillIds: ['kubernetes'], yearsMin: null },
      ],
    });
    expect(run([j])).toEqual([]);
  });

  it('a role already applied to, or excluded, does not show again', () => {
    const j = job();
    expect(run([j], { exclude: new Set([j.id]) })).toEqual([]);
  });

  it('the same role posted twice is shown once, keeping the fresher posting', () => {
    const older = job({ companyId: 'same', titleNorm: 'graduate engineer', postedAt: daysAgo(6), firstSeenAt: daysAgo(6) });
    const newer = job({ companyId: 'same', titleNorm: 'graduate engineer', postedAt: daysAgo(1), firstSeenAt: daysAgo(1) });
    const other = job({ companyId: 'other', titleNorm: 'graduate engineer' });
    const ids = run([older, newer, other]).map((p) => p.jobId);
    expect(ids).toHaveLength(2);
    expect(ids).toContain(newer.id);
    expect(ids).not.toContain(older.id);
  });

  it('at most 10 a day, and the same input gives the same list in the same order', () => {
    const many = Array.from({ length: 40 }, () => job());
    const a = run(many);
    const b = run([...many].reverse());
    expect(MAX_PICKS_PER_DAY).toBe(10);
    expect(a).toHaveLength(10);
    expect(b.map((p) => p.jobId)).toEqual(a.map((p) => p.jobId));
    expect(a.map((p) => p.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('a placed student has no picks', () => {
    expect(run([job()], { placed: true })).toEqual([]);
  });

  it('eligible roles rank above roles that still need a check, then the better skill match', () => {
    const check = job({ descriptionText: 'Graduate Engineer Trainee. Freshers. Minimum 60% in 12th. Skills: Python.' });
    const full = job();
    const partial = job({
      musts: [
        { text: 'Python', skillIds: ['python'], yearsMin: null },
        { text: 'SQL', skillIds: ['sql'], yearsMin: null },
        { text: 'Docker', skillIds: ['docker'], yearsMin: null },
      ],
    });
    const picks = run([check, partial, full], { profile: profile({ pct_secondary: undefined }) });
    expect(picks.map((p) => p.jobId)).toEqual([full.id, partial.id, check.id]);
  });
});

describe('each pick carries its reasons', () => {
  it('shows pay as stated, or "not stated"', () => {
    const paid = job({ salaryStated: true, salary: { minMinor: 36_000_000, maxMinor: 36_000_000, currency: 'INR', period: 'year' } });
    const unparsed = job({ salaryStated: true, salary: null });
    const none = job();
    const by = Object.fromEntries(run([paid, unparsed, none]).map((p) => [p.jobId, p.pay]));
    expect(by[paid.id]).toEqual({ stated: true, text: expect.stringMatching(/₹.*3\.6/) });
    expect(by[unparsed.id]).toEqual({ stated: true, text: 'Pay is stated in the posting' });
    expect(by[none.id]).toEqual({ stated: false, text: 'not stated' });
  });

  it('shows matched and missing must-have skills', () => {
    const [p] = run([
      job({
        musts: [
          { text: 'Python', skillIds: ['python'], yearsMin: null },
          { text: 'SQL', skillIds: ['sql'], yearsMin: null },
          { text: 'Docker', skillIds: ['docker'], yearsMin: null },
        ],
      }),
    ]);
    expect(p!.mustHaves.matched).toBe(2);
    expect(p!.mustHaves.total).toBe(3);
    expect(p!.mustHaves.matchedSkills.map((x) => x.toLowerCase())).toEqual(['python', 'sql']);
    expect(p!.mustHaves.missingSkills.map((x) => x.toLowerCase())).toEqual(['docker']);
  });

  it('shows who you know when a source exists, and says nothing when none does', () => {
    const j = job();
    expect(run([j])[0]!.whoYouKnow).toBeNull();
    const withPeople = run([j], { whoYouKnow: (x) => (x.id === j.id ? ['Priya N. (same college, 2024)'] : null) });
    expect(withPeople[0]!.whoYouKnow).toEqual(['Priya N. (same college, 2024)']);
  });

  it('shows how long ago it was posted', () => {
    const picks = run([job({ postedAt: daysAgo(0), firstSeenAt: daysAgo(0) }), job({ postedAt: daysAgo(1), firstSeenAt: daysAgo(1) }), job({ postedAt: daysAgo(5), firstSeenAt: daysAgo(5) })]);
    const labels = picks.map((p) => p.posted.label).sort();
    expect(labels).toEqual(['Posted 1 day ago', 'Posted 5 days ago', 'Posted today']);
    expect(picks.every((p) => Number.isInteger(p.posted.ageDays) && typeof p.posted.at === 'string')).toBe(true);
  });

  it('is shaped exactly as the response schema says, and carries no scam field, no percentage ring and no score', () => {
    const picks = run([job(), job()]);
    expect(() => PicksSchema.parse({ placed: false, date: '2026-10-31', picks })).not.toThrow();
    for (const p of picks) {
      expect(Object.keys(p).sort()).toEqual(Object.keys(PickSchema.shape).sort());
      expect(Object.keys(p).join(',')).not.toMatch(/scam|score|percent/i);
    }
  });
});

describe('robustness', () => {
  it('empty input, a job with no description and an absurdly long description do not throw', () => {
    expect(run([])).toEqual([]);
    expect(() => run([job({ descriptionText: null })])).not.toThrow();
    expect(() => run([job({ descriptionText: 'Freshers. '.repeat(50_000) })])).not.toThrow();
  });
  it('a bad "now" is refused rather than guessed', () => {
    expect(() => run([job()], { now: new Date('nope') })).toThrow();
  });
});
