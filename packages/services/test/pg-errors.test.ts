import { describe, expect, it } from 'vitest';
import { isServiceError, mapPgError, ServiceError } from '../src/index';

const pg = (code: string, extra: Record<string, unknown> = {}) => Object.assign(new Error('secret detail asha@example.test'), { code, ...extra });

describe('mapPgError', () => {
  it('passes a ServiceError through untouched', () => {
    const e = new ServiceError('x', 418);
    expect(mapPgError(e)).toBe(e);
  });
  it('23514 without a constraint name is the 3-root cap trigger', () => {
    const m = mapPgError(pg('23514')) as ServiceError;
    expect(isServiceError(m)).toBe(true);
    expect([m.code, m.status]).toEqual(['too_many_resumes', 409]);
  });
  it('23514 with a constraint name is a failed CHECK: 400, no value leaked', () => {
    const m = mapPgError(pg('23514', { constraint: 'eligibility_pct_10' })) as ServiceError;
    expect([m.code, m.status]).toEqual(['invalid_input', 400]);
    expect(JSON.stringify(m)).not.toContain('asha@example.test');
  });
  it('23505 is keyed on the constraint name', () => {
    expect((mapPgError(pg('23505', { constraint: 'resumes_root_file_uq' })) as ServiceError).code).toBe('duplicate_resume');
    expect((mapPgError(pg('23505', { constraint: 'resumes_one_default_uq' })) as ServiceError).code).toBe('default_conflict');
    expect((mapPgError(pg('23505', { constraint: 'answer_bank_user_key_uq' })) as ServiceError).code).toBe('duplicate_answer');
    expect((mapPgError(pg('23505', { constraint: 'whatever' })) as ServiceError).status).toBe(409);
  });
  it('23503 (cross-user parent) is a 404', () => {
    expect((mapPgError(pg('23503')) as ServiceError).status).toBe(404);
  });
  it('42501 from RLS is a 404; a forbidden column stays an unknown error', () => {
    expect((mapPgError(pg('42501', { message: 'new row violates row-level security policy' })) as ServiceError).status).toBe(404);
    const col = pg('42501');
    col.message = 'permission denied for table resumes';
    expect(mapPgError(col)).toBe(col);
  });
  it('anything else is returned as is', () => {
    const e = pg('08006');
    expect(mapPgError(e)).toBe(e);
    expect(mapPgError('boom')).toBe('boom');
    expect(mapPgError(null)).toBe(null);
  });
});
