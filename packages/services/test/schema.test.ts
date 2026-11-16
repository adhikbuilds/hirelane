import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { idPayload, idSchema, parseInput, ServiceError } from '../src/index';

const UUID = '3f2b8c1e-6a4d-4e0b-9c57-1d2e3f405162';

describe('parseInput', () => {
  const schema = z.strictObject({ email: z.email(), age: z.number().int().min(18) });

  it('returns typed data for valid input', () => {
    expect(parseInput(schema, { email: 'a@example.test', age: 20 })).toEqual({ email: 'a@example.test', age: 20 });
  });

  it('throws a 400 ServiceError listing paths and codes only, never the offending values', () => {
    try {
      parseInput(schema, { email: 'not-an-email-90000 000001', age: 3, extra: 'x' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ServiceError);
      const se = e as ServiceError;
      expect(se.status).toBe(400);
      expect(se.code).toBe('invalid_input');
      const dump = JSON.stringify(se.issues);
      expect(dump).not.toContain('90000');
      expect(dump).not.toContain('not-an-email');
      expect(se.issues?.map((i) => i.path).sort()).toEqual(['', 'age', 'email']);
    }
  });

  it('rejects undefined and null input as invalid, not as a crash', () => {
    expect(() => parseInput(schema, undefined)).toThrow(ServiceError);
    expect(() => parseInput(schema, null)).toThrow(ServiceError);
  });
});

describe('idSchema and idPayload', () => {
  it('accepts a uuid and refuses everything else', () => {
    expect(idSchema.parse(UUID)).toBe(UUID);
    for (const bad of ['', 'abc', 123, null, `${UUID}x`, "' OR 1=1 --"]) expect(idSchema.safeParse(bad).success).toBe(false);
  });
  it('idPayload allows only id-shaped string values (Graphile payloads carry IDs only)', () => {
    expect(idPayload.parse({ resumeId: UUID })).toEqual({ resumeId: UUID });
    expect(idPayload.safeParse({ resumeId: 'name=Asha' }).success).toBe(false);
    expect(idPayload.safeParse({ resume: { id: UUID } }).success).toBe(false);
    expect(idPayload.safeParse({ resumeId: UUID, n: 1 }).success).toBe(false);
  });
});
