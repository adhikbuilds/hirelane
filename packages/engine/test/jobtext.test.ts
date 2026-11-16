import { describe, expect, it } from 'vitest';
import { parsePastedJob, scoreForProfile, sourceHintFromUrl } from '../src/jobtext';
import type { EligibilityProfileInput } from '../src/eligibility/types';

const NAUKRI = `Graduate Engineer Trainee
Zorvane Systems
4.1 ★ | 842 Reviews
0-1 Yrs   ₹ 4-6 LPA   Pune

Job description
Zorvane Systems is looking for fresh graduates.

Eligibility Criteria
• 60% or 6.0 CGPA throughout in 10th, 12th and graduation
• No active backlogs at the time of joining

Key Skills
Python, SQL

Apply: https://www.naukri.com/job-listings-graduate-engineer-trainee-250001`;

const WA = `🚀 *Kestrel Logic is hiring!* 🚀
*Role:* Associate Software Engineer
*Location:* Noida
*Experience:* 0-2 Yrs

✅ *Eligibility*
✅ 2025 and 2026 passouts
✅ B.E/B.Tech (all branches)

👉 Apply here: https://careers.kestrel.example.test/apply/4

Forwarded as received. Please share with your friends 🙏`;

describe('parsePastedJob: fields', () => {
  it('parses a Naukri card', () => {
    const j = parsePastedJob(NAUKRI);
    expect(j.title).toBe('Graduate Engineer Trainee');
    expect(j.company).toBe('Zorvane Systems');
    expect(j.sourceHint).toBe('naukri');
    expect(j.applyUrl).toContain('naukri.com/job-listings');
    expect(j.fresher.fresher).toBe(true);
    expect(j.locations).toContain('Pune');
    expect(j.salary?.minMinor).toBe(40000000);
    expect(j.criteria.map((c) => c.type).sort()).toEqual(['min_score', 'no_active_backlogs']);
  });
  it('parses a WhatsApp forward', () => {
    const j = parsePastedJob(WA);
    expect(j.title).toBe('Associate Software Engineer');
    expect(j.company).toBe('Kestrel Logic');
    expect(j.sourceHint).toBe('whatsapp');
    expect(j.locations).toEqual(['Noida']);
    expect(j.criteria.map((c) => c.type).sort()).toEqual(['degrees', 'passout_years']);
  });
  it('parses a LinkedIn paste with a lnkd.in shared url', () => {
    const j = parsePastedJob('Kestrel Logic is hiring: Python Developer\n📍 Pune, India (Hybrid)\n\nAbout the job\nWe invite applications.', { sharedUrl: 'https://lnkd.in/abCd12' });
    expect(j.title).toBe('Python Developer');
    expect(j.company).toBe('Kestrel Logic');
    expect(j.sourceHint).toBe('linkedin');
    expect(j.applyUrl).toBe('https://lnkd.in/abCd12');
    expect(j.workplace).toBe('hybrid');
  });
  it('parses a drive notice', () => {
    const j = parsePastedJob('Zorvane Systems Off Campus Drive for 2026 Batch\nPost: Software Developer Trainee\nQualification:\n2026 batch only\nNo active backlogs\nJob Location: Chennai\nApply Link: https://forms.example.test/drive/1');
    expect(j.title).toBe('Software Developer Trainee');
    expect(j.company).toBe('Zorvane Systems');
    expect(j.fresher.fresher).toBe(true);
    expect(j.criteria.map((c) => c.type).sort()).toEqual(['no_active_backlogs', 'passout_years']);
  });
  it('evidence offsets slice the returned text', () => {
    const j = parsePastedJob(NAUKRI);
    expect(j.evidence.length).toBeGreaterThan(0);
    for (const e of j.evidence) expect(j.text.slice(e.start, e.end)).toBe(e.quote);
    const title = j.evidence.find((e) => e.field === 'title')!;
    expect(j.text.slice(title.start, title.end)).toBe('Graduate Engineer Trainee');
    for (const c of j.criteria) for (const ev of c.evidence) expect(j.text.slice(ev.start, ev.end).length).toBeGreaterThan(0);
  });
  it('runs scam detection on the same text', () => {
    const j = parsePastedJob('Data Entry Executive\nQuickhire Co\nPay Rs 1,500 registration fee to confirm. Apply https://bit.ly/3Demo');
    expect(j.scamFlags.flagged).toBe(true);
    for (const s of j.scamFlags.signals) if (s.start !== null) expect(j.text.slice(s.start, s.end!)).toBe(s.quote);
  });
  it('flags a senior role as not fresher', () => {
    const j = parsePastedJob('Senior Backend Engineer\nZorvane Systems\nRequirements:\n- 5+ years of experience in Java');
    expect(j.fresher.fresher).toBe(false);
  });
});

describe('parsePastedJob: edges', () => {
  it('returns empties for empty, whitespace, null and non-strings', () => {
    for (const v of ['', '  \n ', null, undefined, 7 as unknown as string]) {
      const j = parsePastedJob(v as string);
      expect(j.title).toBeNull();
      expect(j.company).toBeNull();
      expect(j.criteria).toEqual([]);
      expect(j.applyUrl).toBeNull();
      expect(j.sourceHint).toBe('other');
      expect(j.scamFlags.signals).toEqual([]);
    }
  });
  it('survives CRLF, tabs, zero-width chars and html-ish text', () => {
    const j = parsePastedJob('Role:​ Junior Accountant\r\nCompany:\tPalmgrove Solutions\r\n<b>Location:</b> Jaipur & Kochi');
    expect(j.title).toBe('Junior Accountant');
    expect(j.company).toBe('Palmgrove Solutions');
  });
  it('never throws on pathological input and stays fast', () => {
    const huge = 'Role: x\n' + 'a'.repeat(300_000);
    const t0 = Date.now();
    expect(() => parsePastedJob(huge)).not.toThrow();
    expect(() => parsePastedJob('*'.repeat(5000) + '_'.repeat(5000))).not.toThrow();
    expect(Date.now() - t0).toBeLessThan(5000);
  });
  it('is deterministic', () => {
    expect(JSON.stringify(parsePastedJob(WA))).toBe(JSON.stringify(parsePastedJob(WA)));
  });
  it('never fetches: the module has no network or fs imports', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/jobtext.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\bfetch\s*\(|node:(?:http|https|net|dns|fs)|XMLHttpRequest|new URL\(/);
  });
});

describe('sourceHintFromUrl', () => {
  it.each([
    ['https://www.naukri.com/job-listings-x-1', 'naukri'],
    ['naukri.com/job-listings-x', 'naukri'],
    ['https://www.linkedin.com/jobs/view/1', 'linkedin'],
    ['https://lnkd.in/abc', 'linkedin'],
    ['https://wa.me/9000000001', 'whatsapp'],
    ['https://chat.whatsapp.com/Abc', 'whatsapp'],
    ['https://careers.example.test/a', 'other'],
    ['https://evilnaukri.com.example.test/a', 'other'],
    ['not a url', 'other'],
    ['', 'other'],
  ])('%s -> %s', (u, h) => expect(sourceHintFromUrl(u)).toBe(h));
});

describe('scoreForProfile', () => {
  const NOW = '2026-10-29T00:00:00Z';
  const prof = { skillIds: ['python', 'sql'], cities: ['Pune'], remote: false };
  const elig: EligibilityProfileInput = { confirmed: true, pct_10: 80, pct_secondary: 78, secondary_kind: '12th', grad_score: 7.4, grad_scale: 10, grad_is_final: true, active_backlogs: 0, passout_year: 2026 };

  it('passes a matching fresher job', () => {
    const j = parsePastedJob(NAUKRI);
    const r = scoreForProfile(j, prof, elig, { now: NOW });
    expect(r.eligibility.overall).not.toBe('fail');
    expect(r.mustHaves.total).toBeGreaterThanOrEqual(1);
    expect(r.mustHaves.matched).toBe(r.mustHaves.total);
    expect(r.worthwhile.worthwhile).toBe(true);
    expect(r.verdict).toBe('worthwhile');
    expect(r.reasons.length).toBeGreaterThan(0);
  });
  it('blocks on an academic fail', () => {
    const j = parsePastedJob(NAUKRI);
    const r = scoreForProfile(j, prof, { ...elig, active_backlogs: 2 }, { now: NOW });
    expect(r.eligibility.overall).toBe('fail');
    expect(r.verdict).toBe('not_worthwhile');
    expect(r.reasons.join(' ')).toMatch(/academic/i);
  });
  it('counts unmatched must-have skills', () => {
    const j = parsePastedJob('Backend Developer\nZorvane Systems\nRequirements:\n- Java and Spring Boot\n- Docker\n- Python');
    const r = scoreForProfile(j, prof, null, { now: NOW });
    expect(r.mustHaves.total).toBe(3);
    expect(r.mustHaves.matched).toBe(1);
    expect(r.worthwhile.worthwhile).toBe(false);
  });
  it('reports a scam job as suspicious regardless of fit', () => {
    const j = parsePastedJob('Associate Analyst\nQuickhire Co\nPay Rs 2,000 security deposit before joining. Fresher.');
    const r = scoreForProfile(j, prof, elig, { now: NOW });
    expect(r.verdict).toBe('suspicious');
  });
  it('treats a missing eligibility profile as unknown, not fail', () => {
    const r = scoreForProfile(parsePastedJob(NAUKRI), prof, null, { now: NOW });
    expect(r.eligibility.overall).toBe('unknown');
  });
  it('rejects an invalid now', () => {
    expect(() => scoreForProfile(parsePastedJob(NAUKRI), prof, null, { now: 'nope' })).toThrow();
  });
});

describe('parsePastedJob: held-out phrasings (not in the generated corpus)', () => {
  const cases: [string, string, string, string][] = [
    ['all-bold whatsapp labels', '*HIRING*\n*Company: Tessellate Labs*\n*Post: Test Automation Engineer*\n*Batch: 2025/2026*', 'Test Automation Engineer', 'Tessellate Labs'],
    ['linkedin header with remote city line', 'Business Development Associate\nMarigold Retail Tech\nGurugram, Haryana, India (Remote)\nFull-time · Entry level', 'Business Development Associate', 'Marigold Retail Tech'],
    ['urgent opening sentence', 'Urgent opening for Operations Analyst at Fernhill Commerce, Location Kolkata. Freshers apply.', 'Operations Analyst', 'Fernhill Commerce'],
    ['company hiring role, no "for"', '📢 Mass hiring\nBasalt Quantum Labs hiring Machine Learning Intern\nStipend 20k', 'Machine Learning Intern', 'Basalt Quantum Labs'],
    ['pipe separated labels', 'Job: Junior Accountant | Company: Stonebridge Consulting | Loc: Jaipur', 'Junior Accountant', 'Stonebridge Consulting'],
    ['dear students sentence', 'Dear Students,\nVantora Networks is conducting an off-campus drive for Network Support Engineer.\nBatch 2026', 'Network Support Engineer', 'Vantora Networks'],
    ['company line before role line', 'Cobalt Meridian\nHR Recruiter\nPune\n0-1 yrs', 'HR Recruiter', 'Cobalt Meridian'],
    ['title dash company (city)', 'Application Developer - Ember Quay Software (Chennai)', 'Application Developer', 'Ember Quay Software'],
  ];
  it.each(cases)('%s', (_n, text, title, company) => {
    const j = parsePastedJob(text);
    expect(j.title).toBe(title);
    expect(j.company).toBe(company);
  });
  it('finds locations in a pipe label line and a bare city line', () => {
    expect(parsePastedJob('Job: Junior Accountant | Company: Stonebridge Consulting | Loc: Jaipur').locations).toEqual(['Jaipur']);
    expect(parsePastedJob('Cobalt Meridian\nHR Recruiter\nPune\n0-1 yrs').locations).toEqual(['Pune']);
  });
  it('does not treat "We are hiring" as a company', () => {
    const j = parsePastedJob('We are hiring a Python Developer to join our team.');
    expect(j.company).toBeNull();
    expect(j.title).toBe('Python Developer');
  });
  it('merges a criterion stated twice into one', () => {
    const j = parsePastedJob('Zorvane Systems Off Campus Drive for 2026 Batch\nPost: Trainee Engineer\n2026 batch only');
    expect(j.criteria.filter((c) => c.type === 'passout_years')).toHaveLength(1);
  });
});

describe('fresher evidence offsets index the returned text', () => {
  const texts = [
    'Backend Developer\nZorvane Systems\n0-1 Yrs   ₹ 4 LPA   Pune\nFreshers can apply.',
    'Backend Developer\nZorvane Systems\nExperience: 0-1 Yrs',
    'Dear students,\nZorvane Systems is conducting a drive for Trainee Engineer.\nPassouts of 2026 only',
    'Trainee Engineer\nZorvane Systems\n2025 and 2026 passouts',
  ];
  it.each(texts)('%#', (raw) => {
    const j = parsePastedJob(raw);
    expect(j.fresher.fresher).toBe(true);
    expect(j.fresher.evidence.length).toBeGreaterThan(0);
    for (const e of j.fresher.evidence) if (e.source === 'description') expect(j.text.slice(e.start, e.end)).toBe(e.quote);
  });
});
