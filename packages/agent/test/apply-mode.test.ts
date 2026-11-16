import { describe, expect, it } from 'vitest';
import { applyMode, assertApplyDomain, authservIdFor } from '../src/apply-mode.js';

describe('HIRELANE_AUTO_APPLY', () => {
  it('is off in production unless set, and fixture elsewhere', () => {
    expect(applyMode({ NODE_ENV: 'production' })).toBe('off');
    expect(applyMode({})).toBe('fixture');
    expect(applyMode({ NODE_ENV: 'test' })).toBe('fixture');
    expect(applyMode({ NODE_ENV: 'development' })).toBe('fixture');
  });
  it('honours off | fixture | live, case and space insensitive, and any other value fails closed to off', () => {
    expect(applyMode({ HIRELANE_AUTO_APPLY: ' OFF ' })).toBe('off');
    expect(applyMode({ HIRELANE_AUTO_APPLY: 'fixture', NODE_ENV: 'production' })).toBe('fixture');
    expect(applyMode({ HIRELANE_AUTO_APPLY: 'live' })).toBe('live');
    for (const bad of ['on', 'true', '1', 'yes', 'lvie', '']) expect(applyMode({ HIRELANE_AUTO_APPLY: bad }), bad).toBe(bad === '' ? 'fixture' : 'off');
  });
});

describe('apply domain', () => {
  it('has a fixture default outside production', () => {
    expect(assertApplyDomain({})).toBe('apply.hirelane.localhost');
    expect(assertApplyDomain({ HIRELANE_APPLY_DOMAIN: 'Apply.Example.TEST' })).toBe('apply.example.test');
  });
  it('is required in production, and must not be a localhost name', () => {
    expect(() => assertApplyDomain({ NODE_ENV: 'production' })).toThrow(/HIRELANE_APPLY_DOMAIN/);
    expect(() => assertApplyDomain({ NODE_ENV: 'production', HIRELANE_APPLY_DOMAIN: 'apply.hirelane.localhost' })).toThrow(/localhost/);
    expect(() => assertApplyDomain({ NODE_ENV: 'production', HIRELANE_APPLY_DOMAIN: 'localhost' })).toThrow(/localhost/);
    expect(() => assertApplyDomain({ NODE_ENV: 'production', HIRELANE_APPLY_DOMAIN: 'bad domain' })).toThrow(/HIRELANE_APPLY_DOMAIN/);
    expect(assertApplyDomain({ NODE_ENV: 'production', HIRELANE_APPLY_DOMAIN: 'apply.hirelane.in' })).toBe('apply.hirelane.in');
  });
});

describe('inbound authserv-id', () => {
  it('has a fixture default outside production and must be set in production', () => {
    expect(authservIdFor({})).toBe('mx.hirelane.localhost');
    expect(authservIdFor({ HIRELANE_MAIL_AUTHSERV_ID: 'mx.hirelane.in' })).toBe('mx.hirelane.in');
    expect(() => authservIdFor({ NODE_ENV: 'production' })).toThrow(/HIRELANE_MAIL_AUTHSERV_ID/);
    expect(() => authservIdFor({ NODE_ENV: 'production', HIRELANE_MAIL_AUTHSERV_ID: 'mx.hirelane.localhost' })).toThrow(/localhost/);
  });
});
