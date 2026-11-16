import { describe, expect, it } from 'vitest';
import { EnvKeyProvider, generateMasterKey } from '@hirelane/vault';
import { profileFromRow, universityFor } from '../src/campus/drives';
import { notifyNewDrives } from '../src/notify';
import { assessPaste } from '../src/paste';
import { buildPicks, type JobCandidate } from '../src/picks';
import { EligibilityValues } from '../src/eligibility';

// A campus rule must not override a scheme-keyed (VTU) or disputed (Mumbai) university row, and the scheme the student stored
// must reach every place that evaluates eligibility. Pure: no database, no network, no model.
const NOW = new Date('2026-10-31T04:00:00Z');
const CAMPUS = { kind: 'linear', a: 10, b: 0 } as const; // 7.8 CGPA -> 78%
const GRAD70 = 'Graduate Engineer Trainee. Freshers, 2026 passout. Minimum 80% in graduation. Skills: Python.'; // 78% would FAIL this
const row = (over: Record<string, unknown> = {}) => ({ pct_10: 82, pct_secondary: 74, grad_score: '7.80', grad_scale: 10, grad_conversion: 'unknown', active_backlogs: 0, passout_year: 2026, degree: 'BTECH', branch_code: 'CSE', ...over });

describe('universityFor', () => {
  it('finds the row from the campus name, or null: never a guess', () => {
    expect(universityFor('ABC Institute of Technology, affiliated to VTU')?.id).toBe('vtu');
    expect(universityFor('Bengaluru Test College')).toBeNull();
    expect(universityFor(null)).toBeNull();
    expect(universityFor(undefined)).toBeNull();
    expect(universityFor(42)).toBeNull();
  });
});

describe('profileFromRow carries the stored scheme and admission year', () => {
  it('both reach the engine input; blanks and nulls are left out', () => {
    expect(profileFromRow(row({ university_scheme: '2018', admission_year: 2018 }))).toMatchObject({ university_scheme: '2018', admission_year: 2018 });
    const none = profileFromRow(row({ university_scheme: null, admission_year: null }))!;
    expect(none).not.toHaveProperty('university_scheme');
    expect(none).not.toHaveProperty('admission_year');
  });
});

describe('the profile accepts a scheme and an admission year', () => {
  it('validates them', () => {
    expect(EligibilityValues.parse({ university_scheme: '2022', admission_year: 2022 })).toMatchObject({ university_scheme: '2022', admission_year: 2022 });
    for (const bad of [{ admission_year: 1800 }, { admission_year: 2022.5 }, { university_scheme: '' }, { university_scheme: 'x'.repeat(41) }, { admission_year: 2023, passout_year: 2022 }]) {
      expect(() => EligibilityValues.parse(bad), JSON.stringify(bad)).toThrow();
    }
  });
});

const job = (text: string): JobCandidate => ({
  id: '00000000-0000-4000-8000-000000000001', slug: 'j', companyId: 'c', companyName: 'Acme', title: 'Graduate Engineer Trainee', titleNorm: 'graduate engineer trainee', level: 'entry',
  descriptionText: text, locations: ['Pune'], remote: false, postedAt: NOW, firstSeenAt: NOW, lastSeenAt: NOW, closedAt: null, salary: null, salaryStated: false,
  musts: [{ text: 'Python', skillIds: ['python'], yearsMin: null }],
});
const fit = { skillIds: ['python'], cities: ['pune'], remote: false, yearsExperience: 0 };
const picks = (campusName: string, over: Record<string, unknown> = {}) =>
  buildPicks({ jobs: [job(GRAD70)], profile: profileFromRow(row(over)), cgpaRule: CAMPUS, universityRule: universityFor(campusName), fit, now: NOW, exclude: new Set(), placed: false });

describe('picks', () => {
  it('a VTU campus with a campus rule: the 78% is not trusted, the job stays visible as "check"', () => {
    const p = picks('Test College affiliated to VTU');
    expect(p).toHaveLength(1);
    expect(p[0]!.eligibility).toBe('check');
  });
  it('an unrelated campus keeps the campus rule: 78% fails an 80% notice and the job is hidden', () => {
    expect(picks('Bengaluru Test College')).toHaveLength(0);
  });
});

describe('paste', () => {
  const ctx = (campusName: string) => ({ profile: profileFromRow(row()), cgpaRule: CAMPUS, universityRule: universityFor(campusName), fit, now: NOW, url: null });
  const TEXT = `Job Title: Graduate Engineer Trainee\nCompany: Acme Systems\nLocation: Pune\nEligibility: B.Tech 2026 passout. Minimum 80% in graduation.\nRequirements:\n- Python\n`;
  it('a VTU campus cannot turn the campus rule into a "not eligible"', () => {
    expect(assessPaste(TEXT, ctx('Test College affiliated to VTU')).eligibility.overall).not.toBe('not_eligible');
  });
  it('an unrelated campus still gets the verdict from the campus rule', () => {
    expect(assessPaste(TEXT, ctx('Bengaluru Test College')).eligibility.overall).toBe('not_eligible');
  });
});

describe('notify audience', () => {
  const keys = new EnvKeyProvider({ HIRELANE_MASTER_KEY: generateMasterKey() } as never);
  async function notified(campusName: string): Promise<string[]> {
    const inserted: string[][] = [];
    const db = {
      async query(text: string, values?: unknown[]) {
        if (text.includes('FROM drives d JOIN campuses')) return { rowCount: 1, rows: [{ id: 'd1', title: 'Acme drive', cohort_id: 'c1', criteria: JSON.parse(JSON.stringify([{ type: 'min_score', levels: ['ug'], pct: 80, throughout: false, evidence: [] }])), cgpa_rule: CAMPUS, campus_name: campusName }] };
        if (text.includes('FROM cohort_members')) return { rowCount: 1, rows: [{ user_id: 'u1' }] };
        if (text.includes('FROM eligibility_profiles')) return { rowCount: 1, rows: [{ user_id: 'u1', confirmed_at: NOW, ...row() }] };
        if (text.includes('INSERT INTO notifications')) {
          inserted.push((values as string[][])[0]!);
          return { rowCount: 1, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      },
    };
    await notifyNewDrives({ db, mailer: {} as never, keys, now: () => NOW, appUrl: 'https://app.example.test' });
    return inserted.flat();
  }
  it('a VTU campus rule does not drop a student: the student is told to check', async () => {
    expect(await notified('Test College affiliated to VTU')).toEqual(['u1']);
  });
  it('an unrelated campus: the campus rule fails the 78% student, so nobody is notified', async () => {
    expect(await notified('Bengaluru Test College')).toEqual([]);
  });
});

describe('OutcomeInput higher_studies', () => {
  it('is accepted with an institution and a programme, and refuses a package', async () => {
    const { OutcomeInput } = await import('../src/campus/inputs');
    expect(OutcomeInput.parse({ kind: 'higher_studies', employer: 'Test Institute of Science', roleTitle: 'M.Tech VLSI' })).toMatchObject({ kind: 'higher_studies' });
    expect(() => OutcomeInput.parse({ kind: 'higher_studies', employer: 'X', packageLpa: 5 })).toThrow();
    expect(OutcomeInput.parse({ kind: 'offer', employer: 'X', packageLpa: 5 }).packageLpa).toBe(5);
    expect(() => OutcomeInput.parse({ kind: 'astronaut', employer: 'X' })).toThrow();
  });
});
