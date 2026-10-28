import { timingSafeEqual } from 'node:crypto';
import type { Queryable } from './sessions.js';

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

export type OtpChannel = 'email' | 'sms';
export type OtpPurpose = 'login' | 'campus_email';

/**
 * Stores a challenge and retires any earlier open one for the same target and purpose, so only
 * the newest code works. `codeHash` is a keyed HMAC computed by the caller (this package holds no keys);
 * the plain code and the plain target are never stored.
 */
export async function issueChallenge(
  q: Queryable,
  input: {
    id: string;
    channel: OtpChannel;
    purpose: OtpPurpose;
    targetHmac: string;
    codeHash: string;
    ipHash?: string | null;
    userId?: string | null;
    now?: Date;
  },
): Promise<{ id: string; expiresAt: Date }> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + OTP_TTL_MS);
  await q.query(
    `UPDATE otp_challenges SET consumed_at = $3 WHERE target_hmac = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [input.targetHmac, input.purpose, now],
  );
  await q.query(
    `INSERT INTO otp_challenges (id, channel, purpose, target_hmac, code_hash, expires_at, ip_hash, user_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [input.id, input.channel, input.purpose, input.targetHmac, input.codeHash, expiresAt, input.ipHash ?? null, input.userId ?? null, now],
  );
  return { id: input.id, expiresAt };
}

/** Deliberately one failure shape: wrong, expired, consumed, locked out and unknown are indistinguishable. */
export type VerifyResult = { ok: true; challengeId: string; userId: string | null } | { ok: false };

const DUMMY_ID = '00000000-0000-4000-8000-000000000000';

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Spends one attempt atomically, then compares. The attempt counter moves in the same UPDATE that finds the
 * row (attempts < 5, unconsumed, unexpired), so the 6th try is refused even with the right code, and two
 * parallel guesses cannot both slip under the limit. Success marks the row consumed with a guarded UPDATE,
 * so a code works once even when submitted twice at the same time.
 */
export async function verifyChallenge(
  q: Queryable,
  input: {
    targetHmac: string;
    purpose: OtpPurpose;
    /** Returns the keyed hash this challenge would store for the submitted code. */
    hashFor: (challengeId: string) => string | Promise<string>;
    now?: Date;
  },
): Promise<VerifyResult> {
  const now = input.now ?? new Date();
  const spent = await q.query(
    `UPDATE otp_challenges SET attempts = attempts + 1
      WHERE id = (SELECT id FROM otp_challenges
                   WHERE target_hmac = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > $3 AND attempts < $4
                   ORDER BY created_at DESC LIMIT 1)
        AND consumed_at IS NULL AND attempts < $4
      RETURNING id, code_hash, user_id`,
    [input.targetHmac, input.purpose, now, OTP_MAX_ATTEMPTS],
  );
  const row = spent.rows[0];
  // Hash even when nothing matched, so an unknown target costs the same as a wrong code.
  const candidate = await input.hashFor(row ? (row.id as string) : DUMMY_ID);
  if (!row || !sameHash(candidate, row.code_hash as string)) return { ok: false };
  const used = await q.query(`UPDATE otp_challenges SET consumed_at = $2 WHERE id = $1 AND consumed_at IS NULL`, [row.id, now]);
  if ((used.rowCount ?? 0) !== 1) return { ok: false };
  return { ok: true, challengeId: row.id as string, userId: (row.user_id as string | null) ?? null };
}

/** Housekeeping: drop challenges that can no longer be used. */
export async function purgeExpiredChallenges(q: Queryable, now: Date = new Date()): Promise<number> {
  const r = await q.query(`DELETE FROM otp_challenges WHERE expires_at < $1 OR consumed_at IS NOT NULL AND consumed_at < $1`, [new Date(now.getTime() - 24 * 3600_000)]);
  return r.rowCount ?? 0;
}
