import { randomInt } from 'node:crypto';
import { applyAddressOf, assertApplyDomain } from '@hirelane/agent';
import type { UserClient } from '../db';

/** Where employer replies arrive. The fixture default never resolves on the internet, so production must set HIRELANE_APPLY_DOMAIN (it throws otherwise). */
export const applyDomain = (): string => assertApplyDomain();

const SUFFIX = 'abcdefghjkmnpqrstuvwxyz23456789';
const RESERVED = /^(admin|support|postmaster|abuse|root|noreply|no-reply|hirelane|info|hello|mail)/;
const pick = (alphabet: string, n: number): string => Array.from({ length: n }, () => alphabet[randomInt(alphabet.length)]).join('');

/** `rahul.k3x`: the student's name (letters and digits only, at most two words) plus a three character tag. */
export function makeHandle(displayName: string | null, email: string): string {
  const words = (displayName ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 2);
  let base = words.join('.');
  if (base.length < 2) base = (email.split('@')[0] ?? '').split('+')[0]!.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 14);
  if (base.length < 2) base = 'student';
  base = base.slice(0, 24).replace(/\.+$/, '');
  if (RESERVED.test(base)) base = `u${base}`;
  return `${base}.${pick(SUFFIX, 3)}`;
}

export interface ApplyAddress {
  address: string;
  handle: string;
  domain: string;
  replyHandle: string;
  dailyCap: number;
}
const shape = (r: { handle: string; domain: string; reply_handle: string; daily_cap: number }): ApplyAddress => ({
  address: applyAddressOf({ handle: r.handle, replyHandle: r.reply_handle, domain: r.domain }),
  handle: r.handle,
  domain: r.domain,
  replyHandle: r.reply_handle,
  dailyCap: Number(r.daily_cap),
});

export async function readAddressIn(c: UserClient, userId: string): Promise<ApplyAddress | null> {
  const r = (await c.query('SELECT handle, domain, reply_handle, daily_cap FROM apply_addresses WHERE user_id = $1', [userId])).rows[0];
  return r ? shape(r) : null;
}

/** One address per student, created the first time it is needed and kept for good. Safe to call repeatedly. */
export async function ensureAddressIn(c: UserClient, userId: string): Promise<ApplyAddress> {
  const have = await readAddressIn(c, userId);
  if (have) return have;
  const u = (await c.query('SELECT display_name, email FROM users WHERE id = $1', [userId])).rows[0];
  for (let attempt = 0; attempt < 8; attempt++) {
    await c.query('SAVEPOINT apply_address');
    const handle = makeHandle(u?.display_name ?? null, String(u?.email ?? ''));
    try {
      await c.query('INSERT INTO apply_addresses (user_id, handle, domain, reply_handle) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id) DO NOTHING', [
        userId,
        handle,
        applyDomain(),
        pick('abcdefghijklmnopqrstuvwxyz0123456789', 12),
      ]);
      await c.query('RELEASE SAVEPOINT apply_address');
      break;
    } catch (e) {
      await c.query('ROLLBACK TO SAVEPOINT apply_address');
      if ((e as { code?: string }).code !== '23505') throw e;
    }
  }
  const made = await readAddressIn(c, userId);
  if (!made) throw new Error('apply address could not be created');
  return made;
}
