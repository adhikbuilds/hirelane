import { randomInt } from 'node:crypto';
import type { KeyProvider } from '@hirelane/vault';
import { hmac } from '@hirelane/vault';
import { z } from 'zod';

/**
 * Campus join codes are 8 characters of Crockford base32 (no I, L, O, U), so 40 bits. They are looked up by keyed hash
 * (purpose campus/code) and never stored. Typing is forgiving: case, spaces, hyphens, and the look-alikes I/L (1) and O (0).
 */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_HMAC_PURPOSE = 'campus/code';
/** One keyed hash for a mailbox, shared by the OTP join, the account-email match and roster import. */
export const MAILBOX_HMAC_PURPOSE = 'campus/email';

export function normalizeCampusCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 40) return null;
  const s = raw
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(s) ? s : null;
}

/** For ops tooling and tests. */
export function generateCampusCode(pick: (n: number) => number = (n) => randomInt(0, n)): string {
  let out = '';
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[pick(CODE_ALPHABET.length)];
  return out;
}

export const campusCodeHmac = (keys: KeyProvider, code: string): Promise<string> => hmac(keys, CODE_HMAC_PURPOSE, code);

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

/**
 * Trimmed, lower-cased address with any +suffix removed, or null. The same normalisation is used for the OTP, the account
 * match and the roster, so one student cannot mint many verified seats (a+1@, a+2@ ...) to inflate a k-anonymity cell.
 */
export function normalizeMailbox(raw: unknown): string | null {
  const r = emailSchema.safeParse(raw);
  if (!r.success) return null;
  const at = r.data.lastIndexOf('@');
  const local = r.data.slice(0, at);
  const plus = local.indexOf('+');
  const base = plus === -1 ? local : local.slice(0, plus);
  return base === '' ? null : `${base}${r.data.slice(at)}`;
}
export const mailboxHmac = (keys: KeyProvider, normalized: string): Promise<string> => hmac(keys, MAILBOX_HMAC_PURPOSE, normalized);
export const domainOf = (normalizedEmail: string): string => normalizedEmail.slice(normalizedEmail.lastIndexOf('@') + 1);
