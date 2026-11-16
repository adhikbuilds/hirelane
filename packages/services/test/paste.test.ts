import { describe, expect, it, vi } from 'vitest';
import { assessPaste, PasteInput, PasteResultSchema } from '../src/paste';
import { parseInput } from '../src/schema';

// Pure: the pasted text goes through the existing engine (parsePastedJob, scoreForProfile, detectScamSignals). 0 LLM, no network.
const NOW = new Date('2026-10-31T04:00:00Z');
const fit = { skillIds: ['python', 'sql'], cities: ['pune'], remote: false, yearsExperience: 0 };
const profile = { confirmed: true, pct_10: 82, pct_secondary: 74, grad_score: 74, grad_scale: 100, grad_pct_equiv: 74, grad_conversion: 'direct', active_backlogs: 0, passout_year: 2026, degree: 'BTECH', branch_code: 'CSE' } as const;
const ctx = (over: Record<string, unknown> = {}) => ({ profile: profile as never, cgpaRule: null, fit, now: NOW, url: null as string | null, ...over });

const GOOD = `Job Title: Graduate Engineer Trainee
Company: Acme Systems
Location: Pune
CTC: 3.6 LPA
Eligibility: B.Tech 2026 passout. Minimum 60% in graduation. No active backlogs.
Requirements:
- Python
- SQL
Apply on the careers page.`;

describe('input', () => {
  it('takes the pasted text and an optional link, nothing else', () => {
    expect(parseInput(PasteInput, { text: GOOD })).toEqual({ text: GOOD });
    expect(parseInput(PasteInput, { text: GOOD, url: 'https://wa.me/123' }).url).toBe('https://wa.me/123');
    for (const bad of [{}, { text: '' }, { text: 'hi' }, { text: GOOD, extra: 1 }, { text: GOOD, url: 'javascript:alert(1)' }, { text: 'x'.repeat(20_001) }, null, 'str']) {
      expect(() => parseInput(PasteInput, bad), JSON.stringify(bad).slice(0, 40)).toThrow();
    }
  });
});

describe('assessPaste', () => {
  it('parses the job, shows eligibility with the maths, a scam check and the fit', () => {
    const r = assessPaste(GOOD, ctx());
    expect(() => PasteResultSchema.parse(r)).not.toThrow();
    expect(r.job).toMatchObject({ title: 'Graduate Engineer Trainee', company: 'Acme Systems' });
    expect(r.job.pay.stated).toBe(true);
    expect(r.job.pay.text).toMatch(/3\.6/);
    expect(r.eligibility.overall).toBe('eligible');
    expect(r.eligibility.rules.length).toBeGreaterThan(0);
    expect(r.eligibility.rules.every((x) => x.status === 'pass' && x.text.length > 5)).toBe(true);
    expect(r.scam).toMatchObject({ flagged: false, risk: 'none' });
    expect(r.fit.verdict).toBe('worthwhile');
    expect(r.fit.mustHaves.matched).toBe(r.fit.mustHaves.total);
    expect(r.fit.mustHaves.total).toBeGreaterThan(0);
  });

  it('says "not eligible" with the maths when a stated rule fails, and still returns the rest', () => {
    const r = assessPaste(GOOD.replace('60%', '80%'), ctx());
    expect(r.eligibility.overall).toBe('not_eligible');
    const failed = r.eligibility.rules.find((x) => x.status === 'fail');
    expect(failed?.text).toMatch(/74/);
    expect(failed?.text).toMatch(/80/);
    expect(r.job.title).toBe('Graduate Engineer Trainee');
  });

  it('never blocks on something it cannot check: no confirmed profile is "check", with the reason', () => {
    const r = assessPaste(GOOD, ctx({ profile: null }));
    expect(r.eligibility.overall).toBe('check');
    expect(r.eligibility.rules.every((x) => x.status === 'unknown')).toBe(true);
    expect(r.eligibility.rules[0]!.text).toMatch(/confirm/i);
  });

  it('flags a fee-for-a-job pasted forward, with the quote, and calls the fit suspicious', () => {
    const scam = `Urgent hiring! Work from home, earn 50,000 per month, no interview.
Pay a registration fee of Rs 1500 to confirm your seat. Contact on Telegram @fastjobs. Apply now for data entry.`;
    const r = assessPaste(scam, ctx());
    expect(r.scam.flagged).toBe(true);
    expect(['medium', 'high']).toContain(r.scam.risk);
    expect(r.scam.signals.length).toBeGreaterThan(0);
    expect(r.scam.signals.every((s) => s.quote.length > 0 && s.quote.length <= 200)).toBe(true);
    expect(r.fit.verdict).toBe('suspicious');
  });

  it('pay is "not stated" when the paste has none, never a guess', () => {
    const r = assessPaste(GOOD.replace('CTC: 3.6 LPA\n', ''), ctx());
    expect(r.job.pay).toEqual({ stated: false, text: 'not stated' });
  });

  it('never fetches the link: it reads the host as a string only', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const r = assessPaste(GOOD, ctx({ url: 'https://www.naukri.com/job-listings-graduate-engineer-123' }));
    expect(r.job.source).toBe('naukri');
    expect(r.job.applyUrl).toBe('https://www.naukri.com/job-listings-graduate-engineer-123'); // shown as text, never opened
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('survives hostile and degenerate pastes', () => {
    for (const text of ['<script>alert(1)</script> '.repeat(40), '\u0000​'.repeat(200) + 'Hiring', 'a'.repeat(19_999), '🙂'.repeat(500), 'Hiring '.repeat(2000)]) {
      expect(() => PasteResultSchema.parse(assessPaste(text, ctx())), text.slice(0, 20)).not.toThrow();
    }
  });
});
