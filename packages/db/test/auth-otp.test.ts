import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OTP_MAX_ATTEMPTS, OTP_TTL_MS, issueChallenge, verifyChallenge } from '../src/auth/otp.js';
import { applyMigrations } from '../src/migrator.js';
import { freshTestClient } from './helpers.js';

let c: Client;
beforeAll(async () => {
  c = await freshTestClient();
  await applyMigrations(c, resolve(import.meta.dirname, '../migrations'));
});
afterAll(async () => {
  await c.end();
});
const T0 = new Date('2026-10-29T10:00:00Z');
const plus = (ms: number) => new Date(T0.getTime() + ms);
// Stand-in for the keyed HMAC web computes; deterministic, includes the challenge id like the real one.
const hashFor = (code: string) => (id: string) => `h(${id}:${code})`;

async function issue(target: string, code: string, extra: Record<string, unknown> = {}) {
  const id = randomUUID();
  await issueChallenge(c, { id, channel: 'email', purpose: 'login', targetHmac: target, codeHash: hashFor(code)(id), now: T0, ...extra });
  return id;
}
const verify = (target: string, code: string, now = T0, purpose: 'login' | 'campus_email' = 'login') =>
  verifyChallenge(c, { targetHmac: target, purpose, hashFor: hashFor(code), now });

describe('otp challenges', () => {
  it('accepts the right code once and consumes it', async () => {
    await issue('t-ok', '123456');
    expect((await verify('t-ok', '123456')).ok).toBe(true);
    expect((await verify('t-ok', '123456')).ok).toBe(false);
  });

  it('expires after 10 minutes', async () => {
    await issue('t-exp', '111111');
    expect(OTP_TTL_MS).toBe(10 * 60 * 1000);
    expect((await verify('t-exp', '111111', plus(OTP_TTL_MS + 1))).ok).toBe(false);
  });

  it('is still valid just inside the window', async () => {
    await issue('t-edge', '222222');
    expect((await verify('t-edge', '222222', plus(OTP_TTL_MS - 1000))).ok).toBe(true);
  });

  it('refuses the 6th attempt even when it is the correct code', async () => {
    await issue('t-brute', '333333');
    expect(OTP_MAX_ATTEMPTS).toBe(5);
    for (let i = 0; i < 5; i++) expect((await verify('t-brute', '000000')).ok).toBe(false);
    expect((await verify('t-brute', '333333')).ok).toBe(false);
    const row = await c.query(`SELECT attempts, consumed_at FROM otp_challenges WHERE target_hmac = 't-brute'`);
    expect(row.rows[0].attempts).toBe(5);
    expect(row.rows[0].consumed_at).toBeNull();
  });

  it('the 5th attempt can still succeed', async () => {
    await issue('t-fifth', '444444');
    for (let i = 0; i < 4; i++) await verify('t-fifth', '000000');
    expect((await verify('t-fifth', '444444')).ok).toBe(true);
  });

  it('returns one identical failure shape for wrong, expired, consumed and unknown', async () => {
    await issue('t-shape', '555555');
    const wrong = await verify('t-shape', '000000');
    const unknown = await verify('t-nobody', '555555');
    const expired = await verify('t-shape', '555555', plus(OTP_TTL_MS + 1));
    expect(JSON.stringify(wrong)).toBe(JSON.stringify(unknown));
    expect(JSON.stringify(wrong)).toBe(JSON.stringify(expired));
  });

  it('a newer code replaces the older one', async () => {
    await issue('t-new', '666666');
    await issue('t-new', '777777');
    expect((await verify('t-new', '666666')).ok).toBe(false);
    expect((await verify('t-new', '777777')).ok).toBe(true);
  });

  it('is scoped by purpose', async () => {
    await issue('t-purpose', '888888');
    expect((await verify('t-purpose', '888888', T0, 'campus_email')).ok).toBe(false);
    expect((await verify('t-purpose', '888888')).ok).toBe(true);
  });

  it('only one of two concurrent correct submissions wins', async () => {
    await issue('t-race', '999999');
    const [a, b] = await Promise.all([verify('t-race', '999999'), verify('t-race', '999999')]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });
});
