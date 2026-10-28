import { describe, expect, it } from 'vitest';
import { blobIdFromKey, blobKeyFor, BUILDER_REQUIRED, FILE_HMAC_PURPOSE, BUILDER_STEPS, parsedAad, ParsedResume, resumeBlobAad } from '../src/index';

const U = '3f2b8c1e-6a4d-4e0b-9c57-1d2e3f405162';
const R = '9a1c2d3e-4f50-4a6b-8c7d-0e1f20314253';

describe('aad and keys', () => {
  it('uses the agreed conventions', () => {
    expect(resumeBlobAad(U, R)).toBe(`resumes:${R}:${U}:file`); // equals the runner's fileAad
    expect(parsedAad(U, R)).toBe(`resumes:${R}:${U}`); // equals the runner's parsedAad
    expect(blobKeyFor(U, R)).toBe(`resumes/${U}/${R}`);
  });
  it('recovers the blob id from a key, and refuses foreign keys', () => {
    expect(blobIdFromKey(U, blobKeyFor(U, R))).toBe(R);
    expect(blobIdFromKey('11111111-1111-4111-8111-111111111111', blobKeyFor(U, R))).toBeNull();
    expect(blobIdFromKey(U, 'resumes/../x')).toBeNull();
  });
});

describe('ParsedResume', () => {
  it('accepts a minimal object and fills defaults', () => {
    const p = ParsedResume.parse({ v: 1 });
    expect(p.education).toEqual([]);
    expect(p.findings).toEqual([]);
  });
  it('rejects unknown keys, wrong version and a value on a finding', () => {
    expect(ParsedResume.safeParse({ v: 2 }).success).toBe(false);
    expect(ParsedResume.safeParse({ v: 1, extra: 1 }).success).toBe(false);
    expect(ParsedResume.safeParse({ v: 1, findings: [{ kind: 'pan', start: 0, end: 10, severity: 'high', value: 'ABCDE1234F' }] }).success).toBe(false);
  });
  it('accepts what the runner writes after render (no version key) and after extract (builder answers carried)', () => {
    expect(ParsedResume.safeParse({ fileName: 'Asha_Rao_Resume.pdf', answers: { name: 'Asha Rao' } }).success).toBe(true);
    const p = ParsedResume.parse({ v: 1, fileName: null, text: 't', sections: [{ kind: 'skills', heading: 'Skills', start: 0, end: 1 }], education: [], backlogs: { active: 0, history: 0 }, lateralEntry: false, builder: { name: 'x' } });
    expect(p.lateralEntry).toBe(false);
  });
  it('builder has 6 to 8 steps and the required ones are a subset', () => {
    expect(BUILDER_STEPS.length).toBeGreaterThanOrEqual(6);
    expect(BUILDER_STEPS.length).toBeLessThanOrEqual(8);
    for (const r of BUILDER_REQUIRED) expect(BUILDER_STEPS).toContain(r);
  });
});

describe('contract with workers/runner (read as text: services must not import workers)', () => {
  it('uses the runner\'s AAD strings and hmac purpose', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../../workers/runner/src/tasks/resume-common.ts', import.meta.url), 'utf8');
    const pick = (name: string) => new RegExp(`export const ${name} = \\(id: string, userId: string\\): string => \`([^\`]+)\``).exec(src)?.[1];
    expect(pick('parsedAad')).toBe('resumes:${id}:${userId}');
    expect(pick('fileAad')).toBe('resumes:${id}:${userId}:file');
    expect(/FILE_HMAC_PURPOSE = '([^']+)'/.exec(src)?.[1]).toBe(FILE_HMAC_PURPOSE);
    expect(/blobKeyFor = \(userId: string, id: string\): string => `([^`]+)`/.exec(src)?.[1]).toBe('resumes/${userId}/${id}');
  });
});
