import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { taskList } from '../src/tasks/index.js';
import { REDACTED, REDACT_KEYS, redact, redactText } from '../src/logger.js';
import { WORKER_TZ } from '../src/tz.js';

describe('task list (SEC-6)', () => {
  it('registers company:logo as a function alongside the other tasks', () => {
    expect(Object.keys(taskList)).toEqual(expect.arrayContaining(['heartbeat', 'company:logo']));
    expect(typeof taskList['company:logo']).toBe('function');
  });
});

describe('timezone', () => {
  it('pins TZ to UTC on import', () => {
    expect(WORKER_TZ).toBe('UTC');
    expect(process.env['TZ']).toBe('UTC');
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(0);
  });

  it('is the first import of the worker entrypoint', () => {
    const src = readFileSync(resolve(import.meta.dirname, '../src/index.ts'), 'utf8');
    const imports = [...src.matchAll(/^import .*$/gm)].map((m) => m[0]);
    expect(imports[0]).toContain("'./tz.js'");
  });
});

describe('log redaction', () => {
  it('covers the sensitive keys', () => {
    expect(REDACT_KEYS).toEqual(expect.arrayContaining(['email', 'phone', 'resume', 'answers', 'authorization', 'cookie']));
  });

  it('redacts sensitive keys at any depth, case-insensitively, and keeps the rest', () => {
    const out = redact({
      jobId: 7,
      email: 'a@b.co',
      candidate: { Phone: '+91 99999 99999', resume: 'long text', answers: [{ q: 'x' }], name_len: 4 },
      req: { headers: { Authorization: 'Bearer abc', cookie: 'sid=1', accept: 'text/html' } },
    }) as any;
    expect(out.jobId).toBe(7);
    expect(out.email).toBe(REDACTED);
    expect(out.candidate.Phone).toBe(REDACTED);
    expect(out.candidate.resume).toBe(REDACTED);
    expect(out.candidate.answers).toBe(REDACTED);
    expect(out.candidate.name_len).toBe(4);
    expect(out.req.headers.Authorization).toBe(REDACTED);
    expect(out.req.headers.cookie).toBe(REDACTED);
    expect(out.req.headers.accept).toBe('text/html');
  });

  it('scrubs email addresses from message text and error messages', () => {
    expect(redactText('failed for asha@example.com today')).toBe(`failed for ${REDACTED} today`);
    expect((redact(new Error('insert asha@example.com failed')) as any).message).not.toContain('asha@example.com');
  });

  it('survives cycles-depth and null input', () => {
    const a: any = {};
    a.self = a;
    expect(() => redact(a)).not.toThrow();
    expect(redact(null)).toBeNull();
  });
});
