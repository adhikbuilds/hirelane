import { describe, expect, it } from 'vitest';
import { normalizeDate, normalizeDateRange, normalizeMarks, parseScoreText, validateScore } from '../src/resume/normalize';

describe('normalizeDate', () => {
  it.each([
    ["Jun'22", 2022, 6],
    ['Jun’22', 2022, 6], // U+2019
    ['June 2022', 2022, 6],
    ['Sept. 2021', 2021, 9],
    ['06/2022', 2022, 6],
    ['2022', 2022, null],
    ["'22", 2022, null],
  ])('%s', (raw, year, month) => {
    expect(normalizeDate(raw)).toEqual({ year, month });
  });
  it('rejects non-dates', () => {
    for (const raw of ['', 'hello', '412/500', '12/05', "Foo'22", '1850', null, undefined, 42 as unknown as string]) expect(normalizeDate(raw as string)).toBeNull();
  });
});

describe('normalizeDateRange', () => {
  it('reads 2022–26 with an en dash and a two-digit end year', () => {
    expect(normalizeDateRange('2022–26')).toEqual({ start: { year: 2022, month: null }, end: { year: 2026, month: null }, ongoing: false });
  });
  it('reads hyphen, em dash and "to"', () => {
    for (const s of ['2022-2026', '2022 — 2026', '2022 to 2026']) expect(normalizeDateRange(s)?.end?.year).toBe(2026);
  });
  it('reads months', () => {
    expect(normalizeDateRange("Jun'22 – May'26")).toEqual({ start: { year: 2022, month: 6 }, end: { year: 2026, month: 5 }, ongoing: false });
  });
  it('Pursuing, Present, Ongoing and Till date mean not final', () => {
    for (const s of ["Jun'22 – Pursuing", '2022 - Present', '2022–Ongoing', 'Aug 2022 - till date', '2022-Current']) {
      const r = normalizeDateRange(s);
      expect(r?.ongoing, s).toBe(true);
      expect(r?.end).toBeNull();
    }
  });
  it('a bare "Pursuing" is ongoing with no start', () => {
    expect(normalizeDateRange('Pursuing')).toEqual({ start: null, end: null, ongoing: true });
  });
  it('rejects an end before the start and non-ranges', () => {
    expect(normalizeDateRange('2026–22')).toBeNull();
    expect(normalizeDateRange('2026-2022')).toBeNull();
    expect(normalizeDateRange('hello')).toBeNull();
    expect(normalizeDateRange('')).toBeNull();
  });
});

describe('normalizeMarks', () => {
  it('412/500 is 82.4%', () => {
    expect(normalizeMarks('412/500')).toEqual({ obtained: 412, total: 500, pct: 82.4 });
  });
  it('reads spaced, "out of" and Marks: forms', () => {
    expect(normalizeMarks('Marks: 1020 / 1200')?.pct).toBe(85);
    expect(normalizeMarks('412 out of 500')?.pct).toBe(82.4);
    expect(normalizeMarks('85/100')?.pct).toBe(85);
  });
  it('does not read dates, CGPAs or impossible marks', () => {
    for (const s of ['12/05', '10/12/2022', '06/2022', '8.1/10', '9/10', '600/500', '0/500', 'no marks here', '']) expect(normalizeMarks(s), s).toBeNull();
  });
});

describe('parseScoreText', () => {
  it('percent, CGPA with scale, CGPA without scale, SGPA, marks', () => {
    expect(parseScoreText('82.4%')).toMatchObject({ kind: 'percent', value: 82.4, scale: 100 });
    expect(parseScoreText('CGPA: 8.1/10')).toMatchObject({ kind: 'cgpa', value: 8.1, scale: 10, assumedScale: false });
    expect(parseScoreText('8.1 CGPA')).toMatchObject({ kind: 'cgpa', value: 8.1, scale: 10, assumedScale: false });
    expect(parseScoreText('CGPA 3.4')).toMatchObject({ kind: 'cgpa', value: 3.4, scale: 4, assumedScale: true });
    expect(parseScoreText('SGPA: 7.9')).toMatchObject({ kind: 'sgpa', value: 7.9 });
    expect(parseScoreText('412/500')).toMatchObject({ kind: 'percent', value: 82.4, scale: 100 });
    expect(parseScoreText('SPI 8.2')).toMatchObject({ kind: 'sgpa' });
    expect(parseScoreText('CPI 8.2')).toMatchObject({ kind: 'cgpa' });
  });
  it('returns null for nothing', () => {
    expect(parseScoreText('')).toBeNull();
    expect(parseScoreText('first class')).toBeNull();
  });
});

describe('validateScore', () => {
  it('a CGPA inside its scale has no flags', () => {
    expect(validateScore({ kind: 'cgpa', value: 8.1, scale: 10 })).toEqual({ ok: true, flags: [] });
  });
  it('flags a CGPA above its scale', () => {
    const r = validateScore({ kind: 'cgpa', value: 10.4, scale: 10 });
    expect(r.ok).toBe(false);
    expect(r.flags.map((f) => f.code)).toContain('out_of_scale');
  });
  it('flags odd scales, negatives, zero, and percent over 100', () => {
    expect(validateScore({ kind: 'cgpa', value: 7, scale: 7 }).flags.map((f) => f.code)).toContain('bad_scale');
    expect(validateScore({ kind: 'cgpa', value: -1, scale: 10 }).ok).toBe(false);
    expect(validateScore({ kind: 'percent', value: 101, scale: 100 }).ok).toBe(false);
    expect(validateScore({ kind: 'percent', value: Number.NaN, scale: 100 }).ok).toBe(false);
  });
  it('tells an SGPA from a CGPA', () => {
    const r = validateScore({ kind: 'sgpa', value: 7.9, scale: 10 });
    expect(r.ok).toBe(false);
    expect(r.flags.map((f) => f.code)).toContain('sgpa_not_cgpa');
  });
  it('flags an assumed scale', () => {
    expect(validateScore({ kind: 'cgpa', value: 3.4, scale: 4, assumedScale: true }).flags.map((f) => f.code)).toContain('scale_assumed');
  });
  it('flags a CGPA that disagrees with the stated percentage, only when a rule exists', () => {
    const rule = { a: 9.5, b: 0 };
    const bad = validateScore({ kind: 'cgpa', value: 8, scale: 10 }, { statedPct: 60, rule });
    expect(bad.flags.map((f) => f.code)).toContain('pct_mismatch');
    expect(bad.flags.find((f) => f.code === 'pct_mismatch')!.message).toMatch(/76/);
    expect(validateScore({ kind: 'cgpa', value: 8, scale: 10 }, { statedPct: 75, rule }).flags).toEqual([]);
    expect(validateScore({ kind: 'cgpa', value: 8, scale: 10 }, { statedPct: 60, rule: null }).flags).toEqual([]);
    expect(validateScore({ kind: 'cgpa', value: 8, scale: 10 }, { statedPct: 60 }).flags).toEqual([]);
  });
  it('tolerance is 3 points: 3 passes, 3.5 flags', () => {
    const rule = { a: 10, b: 0 };
    expect(validateScore({ kind: 'cgpa', value: 7, scale: 10 }, { statedPct: 73, rule }).flags).toEqual([]);
    expect(validateScore({ kind: 'cgpa', value: 7, scale: 10 }, { statedPct: 73.5, rule }).flags.length).toBe(1);
  });
});
