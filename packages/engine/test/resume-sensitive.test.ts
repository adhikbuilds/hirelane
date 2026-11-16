import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { verhoeffCheckDigit, verhoeffValid } from '../src/resume/verhoeff';
import { detectSensitive, maskSensitive, normalizeResumeText } from '../src/resume/sensitive';
import type { ExtractMeta, SensitiveKind } from '../src/resume/types';

// All numbers below are synthetic. Valid Aadhaar-like values are built with verhoeffCheckDigit.
const mkAadhaar = (body11: string) => body11 + verhoeffCheckDigit(body11);
const A1 = mkAadhaar('20000000001');
const A2 = mkAadhaar('34567890123');
const g = (s: string) => `${s.slice(0, 4)} ${s.slice(4, 8)} ${s.slice(8)}`;
const kinds = (t: string, meta?: Pick<ExtractMeta, 'imageCount'>): SensitiveKind[] => detectSensitive(t, meta).map((f) => f.kind);

describe('verhoeff', () => {
  it('matches published vectors', () => {
    expect(verhoeffCheckDigit('236')).toBe('3');
    expect(verhoeffCheckDigit('12345')).toBe('1');
    expect(verhoeffValid('2363')).toBe(true);
    expect(verhoeffValid('123451')).toBe(true);
  });
  it('detects every single-digit substitution and adjacent transposition', () => {
    const good = '123451';
    for (let i = 0; i < good.length; i++) {
      for (let c = 0; c < 10; c++) {
        if (String(c) === good[i]) continue;
        expect(verhoeffValid(good.slice(0, i) + c + good.slice(i + 1))).toBe(false);
      }
    }
    expect(verhoeffValid('123541')).toBe(false);
  });
  it('rejects empty and non-digit input', () => {
    expect(verhoeffValid('')).toBe(false);
    expect(verhoeffValid('12a45')).toBe(false);
    expect(() => verhoeffCheckDigit('12x')).toThrow();
  });
  it('round-trips generated check digits', () => {
    for (let n = 0; n < 200; n++) {
      const body = String(100000000 + n * 7919);
      expect(verhoeffValid(body + verhoeffCheckDigit(body))).toBe(true);
    }
  });
});

describe('normalizeResumeText', () => {
  it('applies NFKC, strips zero-width chars, maps Devanagari digits', () => {
    expect(normalizeResumeText('ＡＢＣ')).toBe('ABC');
    expect(normalizeResumeText('a​b‌‍⁠﻿c')).toBe('abc');
    expect(normalizeResumeText('०१२३४५६७८९')).toBe('0123456789');
  });
  it('handles empty input', () => {
    expect(normalizeResumeText('')).toBe('');
  });
});

describe('Aadhaar', () => {
  it('detects grouped and contiguous with a label, and points at the number only', () => {
    const t = `Aadhaar No: ${g(A1)}`;
    const [f] = detectSensitive(t);
    expect(f).toMatchObject({ kind: 'aadhaar', severity: 'high' });
    expect(t.slice(f!.start, f!.end)).toBe(g(A1));
    expect(kinds(`UID ${A2}`)).toEqual(['aadhaar']);
    expect(kinds(`आधार: ${g(A2)}`)).toEqual(['aadhaar']);
  });
  it('maps Devanagari digits and strips zero-width chars before matching', () => {
    const dev = [...A1].map((c) => String.fromCharCode(0x966 + Number(c))).join('');
    expect(kinds(`Aadhaar ${dev}`)).toEqual(['aadhaar']);
    expect(kinds(`Aadhaar ${A1.slice(0, 6)}​${A1.slice(6)}`)).toEqual(['aadhaar']);
  });
  it('flags a labelled bad checksum at low severity; rejects a leading 0 or 1, and wrong length', () => {
    const bad = A1.slice(0, 11) + ((Number(A1[11]) + 1) % 10);
    // A labelled number is still flagged (low severity) so a typo or OCR error does not leak digits.
    expect(kinds(`Aadhaar ${g(bad)}`)).toEqual(['aadhaar']);
    expect(kinds(`Roll ${g(bad)}`)).toEqual([]);
    const lead1 = mkAadhaar('10000000001');
    expect(kinds(`Aadhaar ${lead1}`)).toEqual([]);
    expect(kinds(`Aadhaar ${A1.slice(0, 11)}`)).toEqual([]);
    expect(kinds(`Aadhaar ${A1}1`)).toEqual([]);
  });
  it('suppresses +91, mobile and phone contexts and the 91 + 10-digit mobile shape', () => {
    const mob = mkAadhaar('91987654321'.slice(0, 11));
    expect(mob.startsWith('91')).toBe(true);
    expect(kinds(`Mobile: ${mob}`)).toEqual([]);
    expect(kinds(`+${mob}`)).toEqual([]);
    expect(kinds(`${mob}`)).toEqual([]);
    expect(kinds(`Phone ${g(A1)}`)).toEqual([]);
    expect(kinds(`Roll No: ${A1}`)).toEqual([]);
  });
  it('lets the nearer label win', () => {
    expect(kinds(`Mobile 9876543210, Aadhaar ${A1}`)).toEqual(['aadhaar']);
    expect(kinds(`Aadhaar 1234, Mobile ${A1}`)).toEqual([]);
  });
  it('flags masked forms', () => {
    const t = 'Aadhaar: XXXX XXXX 1234';
    const [f] = detectSensitive(t);
    expect(f!.kind).toBe('aadhaar_masked');
    expect(t.slice(f!.start, f!.end)).toBe('XXXX XXXX 1234');
    expect(kinds('UID **** **** 4321')).toEqual(['aadhaar_masked']);
    expect(kinds('xxxx-xxxx-9876')).toEqual(['aadhaar_masked']);
    expect(kinds('MAXXXX XXXX 1234')).toEqual([]);
  });
  it('flags a 16-digit VID and does not mistake it for an Aadhaar', () => {
    const v = mkAadhaar('234567890123456'.slice(0, 15));
    expect(v).toHaveLength(16);
    expect(kinds(`VID: ${v}`)).toEqual(['vid']);
    expect(kinds(`VID ${v.replace(/(\d{4})(?=\d)/g, '$1 ')}`)).toEqual(['vid']);
  });
});

describe('PAN', () => {
  it('detects the format with a valid 4th character', () => {
    for (const c of 'PCHFATBLJG') {
      const pan = `ABC${c}E1234F`;
      const t = `PAN ${pan}`;
      const f = detectSensitive(t);
      expect(f.map((x) => x.kind)).toEqual(['pan']);
      expect(t.slice(f[0]!.start, f[0]!.end)).toBe(pan);
    }
  });
  it('rejects a bad 4th character, wrong shape and embedded matches', () => {
    expect(kinds('ABCZE1234F')).toEqual([]);
    expect(kinds('ABCPE12345F')).toEqual([]);
    expect(kinds('ABCPE123F')).toEqual([]);
    expect(kinds('XABCPE1234F')).toEqual([]);
    expect(kinds('ABCPE1234FX')).toEqual([]);
  });
  it('accepts lowercase only next to a PAN label', () => {
    expect(kinds('pan: abcpe1234f')).toEqual(['pan']);
    expect(kinds('project abcpe1234f')).toEqual([]);
  });
});

describe('DOB, age, parents', () => {
  it('detects label-anchored DOB values and ages', () => {
    expect(kinds('Date of Birth: 12/05/2002')).toEqual(['dob']);
    expect(kinds('DOB - 12 May 2002')).toEqual(['dob']);
    expect(kinds('D.O.B. 2002-05-12')).toEqual(['dob']);
    expect(kinds('जन्म तिथि: 12-05-2002')).toEqual(['dob']);
    expect(kinds('Age: 21')).toEqual(['dob']);
    expect(kinds('22 years old')).toEqual(['dob']);
  });
  it('does not flag bare dates or unrelated words', () => {
    expect(kinds('Joined 12/05/2022')).toEqual([]);
    expect(kinds('Manager: 20 reports, average 4')).toEqual([]);
    expect(kinds('Born to run, a project')).toEqual([]);
  });
  it('detects parent names and S/o D/o', () => {
    expect(kinds("Father's Name: Sample Testfather")).toEqual(['parent_name']);
    expect(kinds('Mother Name - Sample Testmother')).toEqual(['parent_name']);
    expect(kinds('S/o Mr Sample Testfather')).toEqual(['parent_name']);
    expect(kinds('D/O Sample Testfather')).toEqual(['parent_name']);
    expect(kinds('Son of Sample Testfather')).toEqual(['parent_name']);
  });
  it('does not flag the words father or mother without a label', () => {
    expect(kinds('Mother Teresa Memorial School')).toEqual([]);
    expect(kinds('Father of modern physics, thesis')).toEqual([]);
  });
});

describe('religion, caste, marital status are label-anchored only', () => {
  it('detects with labels', () => {
    expect(kinds('Religion: Sampleist')).toEqual(['religion']);
    expect(kinds('धर्म: टेस्ट')).toEqual(['religion']);
    expect(kinds('Caste: Samplecaste')).toEqual(['caste']);
    expect(kinds('Category: OBC')).toEqual(['caste']);
    expect(kinds('Category - General')).toEqual(['caste']);
    expect(kinds('Marital Status: Single')).toEqual(['marital_status']);
  });
  it('does not match names that merely contain religious words', () => {
    for (const t of ['Christ University', 'Hindu College', "St. Xavier's College", 'Muslim Education Society', 'Category: Backend tools', 'Marital arts club']) {
      expect(kinds(t)).toEqual([]);
    }
  });
});

describe('image presence', () => {
  it('reports from ExtractMeta.imageCount', () => {
    const f = detectSensitive('plain', { imageCount: 2 });
    expect(f).toEqual([{ kind: 'image', start: 0, end: 0, severity: 'low' }]);
    expect(kinds('plain', { imageCount: 0 })).toEqual([]);
  });
});

describe('findings and masking', () => {
  const text = `Name Sample\nAadhaar: ${g(A1)}\nPAN ABCPE1234F\nDOB: 01/01/2000\nVID ${mkAadhaar('234567890123456'.slice(0, 15))}`;
  it('never contain the matched value (serialised scan)', () => {
    const json = JSON.stringify(detectSensitive(text, { imageCount: 1 }));
    expect(json).not.toContain(A1);
    expect(json).not.toContain(A1.slice(0, 4));
    expect(json).not.toContain('ABCPE');
    expect(json).not.toContain('2000');
    for (const f of detectSensitive(text)) expect(Object.keys(f).sort()).toEqual(['end', 'kind', 'severity', 'start']);
  });
  it('are sorted by start and non-overlapping', () => {
    const f = detectSensitive(text);
    for (let i = 1; i < f.length; i++) expect(f[i]!.start).toBeGreaterThanOrEqual(f[i - 1]!.end);
    expect(f.map((x) => x.start)).toEqual([...f.map((x) => x.start)].sort((a, b) => a - b));
  });
  it('maskSensitive is length-preserving, hides Aadhaar/PAN/VID and keeps separators', () => {
    const out = maskSensitive(text, detectSensitive(text));
    expect(out).toHaveLength(text.length);
    expect(out).toContain('Aadhaar: XXXX XXXX XXXX');
    expect(out).toContain('PAN XXXXXXXXXX');
    expect(out).not.toContain(A1);
    expect(out).not.toContain('ABCPE1234F');
    expect(out).toContain('DOB: 01/01/2000'); // DOB is flagged, not masked
    expect(out).toContain('Name Sample');
  });
  it('masking is idempotent and leaves clean text alone', () => {
    const once = maskSensitive(text, detectSensitive(text));
    expect(detectSensitive(once).filter((f) => f.kind === 'aadhaar' || f.kind === 'pan' || f.kind === 'vid')).toEqual([]);
    expect(maskSensitive('hello', [])).toBe('hello');
  });
  it('ignores out-of-range findings safely', () => {
    expect(maskSensitive('abc', [{ kind: 'pan', start: 2, end: 99, severity: 'high' }])).toBe('abX');
    expect(maskSensitive('abc', [{ kind: 'pan', start: -5, end: 1, severity: 'high' }])).toBe('Xbc');
  });
});

describe('edge cases', () => {
  it('handles empty and whitespace input', () => {
    expect(detectSensitive('')).toEqual([]);
    expect(detectSensitive('  \n ')).toEqual([]);
  });
  it('handles emoji and mixed scripts without throwing', () => {
    expect(() => detectSensitive('😀 Aadhaar: ' + g(A1) + ' 🎓 日本語')).not.toThrow();
    expect(kinds('😀 Aadhaar: ' + g(A1))).toEqual(['aadhaar']);
  });
  it('scales to 10k findings quickly enough', () => {
    const big = Array.from({ length: 10000 }, () => `Aadhaar ${A1}`).join('\n');
    const t0 = performance.now();
    expect(detectSensitive(big)).toHaveLength(10000);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});

describe('no catastrophic backtracking', () => {
  const N = 200_000;
  const adversarial: Record<string, string> = {
    digits: '1'.repeat(N),
    spacedDigits: '2 '.repeat(N / 2),
    dashedDigits: '3-'.repeat(N / 2),
    spaces: ' '.repeat(N),
    dobSpaces: 'dob' + ' '.repeat(N),
    repeatedLabels: 'dob '.repeat(N / 4),
    fatherLabels: "father's name ".repeat(N / 14),
    letters: 'A'.repeat(N),
    panish: 'ABCPE1234'.repeat(N / 9),
    maskish: 'XXXX '.repeat(N / 5),
    nameChars: 'S/o ' + 'a '.repeat(N / 2),
    religion: 'religion:'.repeat(N / 9),
    mixed: ('Aadhaar 2345 6789 012 ' + 'age: ' + 'x'.repeat(30) + ' ').repeat(N / 60),
  };
  for (const [name, s] of Object.entries(adversarial)) {
    it(`finishes a ~200 KB '${name}' string in under 200 ms`, () => {
      expect(s.length).toBeGreaterThanOrEqual(N * 0.9);
      const t0 = performance.now();
      detectSensitive(s);
      expect(performance.now() - t0).toBeLessThan(200);
    });
  }
});

describe('labelled corpus (synthetic)', () => {
  type Row = { id: string; text: string; kinds: SensitiveKind[]; tag: string };
  const lines = readFileSync(new URL('./corpus/sensitive.labelled.jsonl', import.meta.url), 'utf8').trim().split('\n');
  const rows = lines.slice(1).map((l) => JSON.parse(l) as Row);
  const ID_KINDS = new Set<SensitiveKind>(['aadhaar', 'aadhaar_masked', 'vid', 'pan']);
  const got = (r: Row) => new Set(detectSensitive(r.text).map((f) => f.kind));

  it('has a header and the required size (>= 40 negatives)', () => {
    expect(JSON.parse(lines[0]!)._header.corpus).toBe('sensitive.labelled');
    expect(rows.filter((r) => r.kinds.length === 0).length).toBeGreaterThanOrEqual(40);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });
  it('Aadhaar and PAN recall is 1.0', () => {
    const pos = rows.filter((r) => r.kinds.some((k) => k === 'aadhaar' || k === 'pan'));
    expect(pos.length).toBeGreaterThanOrEqual(15);
    const misses = pos.filter((r) => !r.kinds.filter((k) => k === 'aadhaar' || k === 'pan').every((k) => got(r).has(k)));
    expect(misses.map((r) => r.id)).toEqual([]);
  });
  it('masked and VID forms are found', () => {
    const pos = rows.filter((r) => r.kinds.includes('aadhaar_masked') || r.kinds.includes('vid'));
    expect(pos.length).toBeGreaterThanOrEqual(4);
    expect(pos.filter((r) => !r.kinds.every((k) => got(r).has(k))).map((r) => r.id)).toEqual([]);
  });
  it('0 false positives: negatives and no extra id kinds on positives', () => {
    const neg = rows.filter((r) => r.kinds.length === 0);
    expect(neg.filter((r) => got(r).size > 0).map((r) => r.id)).toEqual([]);
    const extra = rows.filter((r) => [...got(r)].some((k) => ID_KINDS.has(k) && !r.kinds.includes(k)));
    expect(extra.map((r) => r.id)).toEqual([]);
  });
  it('masking removes every Aadhaar/PAN/VID from the positives', () => {
    for (const r of rows.filter((x) => x.kinds.length)) {
      const n = normalizeResumeText(r.text);
      const masked = maskSensitive(n, detectSensitive(n));
      const left = detectSensitive(masked).filter((f) => f.kind === 'aadhaar' || f.kind === 'pan' || f.kind === 'vid');
      expect(left, r.id).toEqual([]);
    }
  });
});
