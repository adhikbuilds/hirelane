import { describe, expect, it } from 'vitest';
import { verhoeffCheckDigit } from '../src/resume/verhoeff';
import { detectSensitive, maskSensitive } from '../src/resume/sensitive';

const mk = (b: string) => b + verhoeffCheckDigit(b);
const A = mk('34567890123'); // synthetic
const bad = A.slice(0, 11) + String((Number(A[11]) + 1) % 10);
const k = (t: string) => detectSensitive(t).map((f) => f.kind);
const grp = (s: string, sep: string) => `${s.slice(0, 4)}${sep}${s.slice(4, 8)}${sep}${s.slice(8)}`;

describe('Aadhaar label cannot be suppressed by a nearby non-ID word', () => {
  for (const pre of ['Aadhaar linked mobile: ', 'Aadhaar (student ID proof) ', 'Aadhaar Number - Contact: ']) {
    it(pre, () => {
      expect(k(pre + grp(A, ' '))).toContain('aadhaar');
    });
  }
  it('unlabelled number after a phone label is still suppressed', () => {
    expect(k('Phone: ' + grp(A, ' '))).not.toContain('aadhaar');
  });
});

describe('separator variants', () => {
  for (const sep of ['.', '/', '  ', '\n']) {
    it(`separator ${JSON.stringify(sep)}`, () => {
      expect(k('Aadhaar: ' + grp(A, sep))).toContain('aadhaar');
    });
  }
  it('mixed separators', () => {
    expect(k('Aadhaar: ' + A.slice(0, 4) + ' ' + A.slice(4, 8) + '-' + A.slice(8))).toContain('aadhaar');
  });
  it('digits spaced individually', () => {
    expect(k('Aadhaar: ' + A.split('').join(' '))).toContain('aadhaar');
  });
});

describe('labelled but Verhoeff-invalid', () => {
  it('still flagged, not high', () => {
    const f = detectSensitive('Aadhaar: ' + grp(bad, ' '));
    expect(f.map((x) => x.kind)).toContain('aadhaar');
    expect(f.find((x) => x.kind === 'aadhaar')!.severity).not.toBe('high');
  });
  it('unlabelled invalid is not flagged', () => {
    expect(k('Roll ' + grp(bad, ' '))).not.toContain('aadhaar');
    expect(k(grp(bad, ' '))).not.toContain('aadhaar');
  });
});

describe('unlabelled 91x numbers', () => {
  it('Verhoeff-valid 12 digits starting 916 with no phone context is flagged', () => {
    expect(k(grp(mk('91650324779'), ' '))).toContain('aadhaar');
  });
  it('+91 prefixed is still a phone', () => {
    expect(k('+' + grp(mk('91650324779'), ' '))).not.toContain('aadhaar');
  });
});

describe('PAN variants', () => {
  it('separators inside PAN', () => {
    expect(k('PAN: ABCPE 1234 F')).toContain('pan');
    expect(k('PAN: ABCPE-1234-F')).toContain('pan');
  });
  it('K holder type', () => {
    expect(k('ABCKE1234F')).toContain('pan');
  });
  it('plain words are not PAN', () => {
    expect(k('Hello world 2024 results')).not.toContain('pan');
  });
});

describe('input length cap', () => {
  const t = 'x'.repeat(300_000) + ' Aadhaar: ' + grp(A, ' ');
  it('stays fast on huge input', () => {
    const t0 = Date.now();
    detectSensitive(t);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it('maskSensitive never leaks beyond the scan cap', () => {
    const masked = maskSensitive(t, detectSensitive(t));
    expect(masked).not.toContain(A.slice(0, 4));
  });
});
