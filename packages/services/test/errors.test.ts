import { describe, expect, it } from 'vitest';
import { notFound, ServiceError, isServiceError, toProblem } from '../src/index';

describe('ServiceError', () => {
  it('carries a stable code and an HTTP status', () => {
    const e = new ServiceError('conflict', 409);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('conflict');
    expect(e.status).toBe(409);
    expect(e.name).toBe('ServiceError');
  });
  it('notFound is a 404 with the same shape whether the row is missing or someone else is', () => {
    const e = notFound();
    expect(e.status).toBe(404);
    expect(e.code).toBe('not_found');
  });
  it('isServiceError narrows only real instances', () => {
    expect(isServiceError(notFound())).toBe(true);
    expect(isServiceError(new Error('x'))).toBe(false);
    expect(isServiceError({ code: 'not_found', status: 404 })).toBe(false);
    expect(isServiceError(null)).toBe(false);
  });
  it('toProblem builds a problem+json body without leaking a message that came from outside', () => {
    expect(toProblem(new ServiceError('invalid_input', 400, [{ path: 'email', code: 'invalid_format' }]), 'req-1')).toEqual({
      type: 'about:blank',
      title: 'invalid_input',
      status: 400,
      code: 'invalid_input',
      requestId: 'req-1',
      issues: [{ path: 'email', code: 'invalid_format' }],
    });
    // An unknown error is a bare 500: no message, no stack.
    expect(toProblem(new Error('db password is hunter2'), 'req-2')).toEqual({
      type: 'about:blank',
      title: 'internal_error',
      status: 500,
      code: 'internal_error',
      requestId: 'req-2',
    });
  });
});
