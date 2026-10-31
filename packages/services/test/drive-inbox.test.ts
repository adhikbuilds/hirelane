import { describe, expect, it } from 'vitest';
import { parseDriveNotice, PublishDriveInput, suggestDeadline, toReach } from '../src/campus';
import { parseInput } from '../src/schema';

const NOW = new Date('2026-10-31T04:00:00Z'); // 31 Oct 2026, 09:30 IST
const id = '11111111-1111-4111-8111-111111111111';

describe('suggestDeadline', () => {
  it('reads the closing date a notice states', () => {
    expect(suggestDeadline('Apply on the careers page by 6 Nov.', NOW)).toBe('2026-11-06');
    expect(suggestDeadline('Last date to apply is 31st October 2026', NOW)).toBe('2026-10-31');
    expect(suggestDeadline('Registration closes on 15 Dec 2026.', NOW)).toBe('2026-12-15');
  });
  it('a date without a year is the next one from today', () => {
    expect(suggestDeadline('apply by 2 Jan', NOW)).toBe('2027-01-02');
    expect(suggestDeadline('apply by 31 Oct', NOW)).toBe('2026-10-31');
  });
  it('is null when the notice names no date or an impossible one', () => {
    expect(suggestDeadline('No date here, apply soon.', NOW)).toBeNull();
    expect(suggestDeadline('apply by 31 Feb 2026', NOW)).toBeNull();
    expect(suggestDeadline('', NOW)).toBeNull();
  });
});

describe('parseDriveNotice', () => {
  const notice = 'Off-campus drive: Customer Success Associate. B.Com 2026 passout. Minimum 60% in graduation. No active backlogs. Apply by 6 Nov.';
  it('returns the rules in plain lines, a suggested deadline and a clean scam check, without any network', () => {
    const p = parseDriveNotice(notice, null, NOW);
    expect(p.criteria.length).toBeGreaterThan(0);
    expect(p.rules).toContain('No active backlogs');
    expect(p.rules.some((r) => /60%/.test(r))).toBe(true);
    expect(p.suggestedDeadline).toBe('2026-11-06');
    expect(p.scam).toEqual({ risk: 'none', flags: [] });
  });
  it('flags a fee-for-a-seat notice, with quotes, for staff', () => {
    const p = parseDriveNotice('Urgent hiring, pay a registration fee of Rs 2000 to confirm your seat. Contact on Telegram only.', null, NOW);
    expect(['medium', 'high']).toContain(p.scam.risk);
    expect(p.scam.flags.length).toBeGreaterThan(0);
    expect(p.scam.flags.every((f) => f.quote.length > 0 && f.quote.length <= 200)).toBe(true);
  });
});

describe('toReach: k >= 10 is respected downstream and never undone here', () => {
  it('is pending before the first snapshot counts the drive', () => {
    expect(toReach({ day: null, metrics: [] })).toEqual({ state: 'pending', day: null, qualify: null, couldntCheck: null, hidden: false });
  });
  it('carries the two released figures', () => {
    const r = toReach({ day: '2026-10-30', metrics: [{ metric: 'drive_eligible', value: 60, suppressed: false }, { metric: 'drive_unknown', value: 30, suppressed: false }, { metric: 'drive_ineligible', value: null, suppressed: true }] });
    expect(r).toEqual({ state: 'ready', day: '2026-10-30', qualify: 60, couldntCheck: 30, hidden: false });
  });
  it('a hidden figure stays null, is flagged, and is never turned into 0 or derived from the other', () => {
    const r = toReach({ day: '2026-10-30', metrics: [{ metric: 'drive_eligible', value: 60, suppressed: false }, { metric: 'drive_unknown', value: null, suppressed: true }] });
    expect(r).toMatchObject({ qualify: 60, couldntCheck: null, hidden: true });
    const none = toReach({ day: '2026-10-30', metrics: [{ metric: 'drive_eligible', value: null, suppressed: true }] });
    expect(none).toMatchObject({ qualify: null, couldntCheck: null, hidden: true });
  });
});

describe('PublishDriveInput', () => {
  const base = { cohortId: id, title: 'T', noticeText: 'Open to all.' };
  it('takes a deadline, rounds and documents as free text', () => {
    expect(parseInput(PublishDriveInput, { ...base, deadline: '2026-11-06', rounds: 'Aptitude, then HR', documents: 'Marksheets' })).toMatchObject({ deadline: '2026-11-06' });
    expect(parseInput(PublishDriveInput, { ...base, deadline: null }).deadline).toBeNull();
  });
  it('refuses a deadline that is not a calendar day, over-long notes, and unknown keys', () => {
    for (const bad of [{ deadline: '2026-02-30' }, { deadline: '06/11/2026' }, { deadline: 'tomorrow' }, { rounds: 'x'.repeat(2001) }, { documents: 'x'.repeat(2001) }, { slots: [] }]) {
      expect(() => parseInput(PublishDriveInput, { ...base, ...bad }), JSON.stringify(bad)).toThrow();
    }
  });
});
