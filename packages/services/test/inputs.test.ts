import { describe, expect, it } from 'vitest';
import { ConfirmInput, EligibilityValues, fingerprint, IDEMPOTENCY_KEY_RE, magicMatches, parseInput, PDF_MIME, DOCX_MIME, StepInput } from '../src/index';

const U = '3f2b8c1e-6a4d-4e0b-9c57-1d2e3f405162';

describe('magicMatches', () => {
  it('checks the declared type against the leading bytes', () => {
    expect(magicMatches(PDF_MIME, Buffer.from('%PDF-1.7'))).toBe(true);
    expect(magicMatches(PDF_MIME, Buffer.from('PK\x03\x04'))).toBe(false);
    expect(magicMatches(DOCX_MIME, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]))).toBe(true);
    expect(magicMatches(DOCX_MIME, Buffer.from('%PDF-'))).toBe(false);
    expect(magicMatches('image/png', Buffer.from('%PDF-'))).toBe(false);
    expect(magicMatches(PDF_MIME, Buffer.alloc(0))).toBe(false);
  });
});

describe('EligibilityValues', () => {
  it('accepts a full valid profile and an empty one', () => {
    expect(EligibilityValues.safeParse({}).success).toBe(true);
    expect(EligibilityValues.safeParse({ pct_10: 0, grad_score: 10, grad_scale: 10, grad_conversion: `campus:${U}`, passout_year: 2025 }).success).toBe(true);
  });
  it.each([
    [{ pct_10: -1 }],
    [{ pct_secondary: 100.5 }],
    [{ grad_score: 4.5, grad_scale: 4 }],
    [{ grad_scale: 3 }],
    [{ grad_conversion: 'campus:xyz' }],
    [{ secondary_kind: '11th' }],
    [{ active_backlogs: 1.5 }],
    [{ gap_years: 21 }],
    [{ passout_year: 2101 }],
    [{ branch_code: 'C S' }],
    [{ nope: 1 }],
  ])('rejects %j', (v) => {
    expect(EligibilityValues.safeParse(v).success).toBe(false);
  });
});

describe('inputs are strict and leak no values', () => {
  it('ConfirmInput rejects extra keys and reports path and code only', () => {
    try {
      parseInput(ConfirmInput, { id: U, parsedVersion: 1, eligibility: { pct_10: 999 }, admin: true });
      throw new Error('should fail');
    } catch (e) {
      const s = JSON.stringify(e);
      expect(s).not.toContain('999');
      expect((e as { issues: { path: string }[] }).issues.map((i) => i.path).sort()).toEqual(['', 'eligibility.pct_10']);
    }
  });
  it('StepInput validates each answer against the renderer\'s limits, trims, and rejects extra keys', () => {
    const contact = { name: '  Asha Rao ', email: 'asha.rao@example.test', phone: '90000 00001' };
    expect(parseInput(StepInput, { step: 'contact', data: contact }).data).toMatchObject({ name: 'Asha Rao' });
    expect(() => parseInput(StepInput, { step: 'contact', data: { ...contact, email: 'nope' } })).toThrow();
    expect(() => parseInput(StepInput, { step: 'contact', data: { ...contact, phone: '12345' } })).toThrow();
    expect(() => parseInput(StepInput, { step: 'contact', data: { ...contact, extra: 1 } })).toThrow();
    expect(() => parseInput(StepInput, { step: 'skills', data: { skills: ['a', 'b'] } })).toThrow(); // needs 3
    expect(() => parseInput(StepInput, { step: 'skills', data: { skills: ['Java', 'SQL', 'Git'] } })).not.toThrow();
    expect(() => parseInput(StepInput, { step: 'projects', data: { projects: [{ title: 'Library app', bullets: [] }] } })).toThrow();
    expect(() => parseInput(StepInput, { step: 'nope', data: {} })).toThrow();
  });
});

describe('idempotency helpers', () => {
  it('fingerprints method, path and body', () => {
    const a = fingerprint('POST', '/x', 'b');
    expect(a).toBe(fingerprint('post', '/x', 'b'));
    expect(a).not.toBe(fingerprint('POST', '/y', 'b'));
    expect(a).not.toBe(fingerprint('POST', '/x', 'c'));
    expect(a).not.toBe(fingerprint('PUT', '/x', 'b'));
  });
  it('accepts sane keys only', () => {
    expect(IDEMPOTENCY_KEY_RE.test('abc12345')).toBe(true);
    expect(IDEMPOTENCY_KEY_RE.test('short')).toBe(false);
    expect(IDEMPOTENCY_KEY_RE.test('has space 123')).toBe(false);
    expect(IDEMPOTENCY_KEY_RE.test('x'.repeat(201))).toBe(false);
  });
});
