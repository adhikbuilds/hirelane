import { createHash, randomBytes } from 'node:crypto';

/** Anything with pg's query shape: a Client, a PoolClient, or a test double. */
export type Queryable = {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
};

export type SessionClient = 'web' | 'android';

const DAY = 24 * 60 * 60 * 1000;
/** Sliding window: each use pushes expiry out this far, never past the absolute deadline. */
export const IDLE_TTL_MS = 30 * DAY;
export const ABSOLUTE_TTL_MS = 90 * DAY;

export const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

const PREFIX: Record<SessionClient, string> = { web: 'hl_s_', android: 'hl_at_' };

/** The database stores only this. The raw token is shown once, to the client that asked for it. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function newSessionToken(client: SessionClient): string {
  return PREFIX[client] + randomBytes(32).toString('base64url');
}

export interface CreatedSession {
  token: string;
  idHash: string;
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

export async function createSession(
  q: Queryable,
  input: { userId: string; client: SessionClient; uaHash?: string | null; now?: Date },
): Promise<CreatedSession> {
  const now = input.now ?? new Date();
  const token = newSessionToken(input.client);
  const idHash = hashSessionToken(token);
  const absoluteExpiresAt = new Date(now.getTime() + ABSOLUTE_TTL_MS);
  const expiresAt = new Date(Math.min(now.getTime() + IDLE_TTL_MS, absoluteExpiresAt.getTime()));
  await q.query(
    `INSERT INTO sessions (id_hash, user_id, client, created_at, last_seen_at, expires_at, absolute_expires_at, ua_hash)
     VALUES ($1, $2, $3, $4, $4, $5, $6, $7)`,
    [idHash, input.userId, input.client, now, expiresAt, absoluteExpiresAt, input.uaHash ?? null],
  );
  return { token, idHash, expiresAt, absoluteExpiresAt };
}

export interface LiveSession {
  userId: string;
  client: SessionClient;
  idHash: string;
}

/** Valid, unrevoked, unexpired sessions only. One statement, so a use also slides the idle expiry. */
export async function lookupSession(q: Queryable, token: string, now: Date = new Date()): Promise<LiveSession | null> {
  if (!token || token.length > 200) return null;
  // The stored client must match the token's own prefix, so a token of one kind cannot pass as the other.
  const client = (Object.keys(PREFIX) as SessionClient[]).find((k) => token.startsWith(PREFIX[k]));
  if (!client) return null;
  const idHash = hashSessionToken(token);
  // last_seen_at and the sliding expiry move at most once per LAST_SEEN_THROTTLE_MS, so reads are not writes.
  const r = await q.query(
    `UPDATE sessions
        SET last_seen_at = CASE WHEN last_seen_at <= $2::timestamptz - $5::int * interval '1 millisecond' THEN $2 ELSE last_seen_at END,
            expires_at = CASE WHEN last_seen_at <= $2::timestamptz - $5::int * interval '1 millisecond'
                              THEN LEAST($3::timestamptz, absolute_expires_at) ELSE expires_at END
      WHERE id_hash = $1 AND client = $4 AND revoked_at IS NULL AND expires_at > $2 AND absolute_expires_at > $2
      RETURNING user_id, client`,
    [idHash, now, new Date(now.getTime() + IDLE_TTL_MS), client, LAST_SEEN_THROTTLE_MS],
  );
  const row = r.rows[0];
  return row ? { userId: row.user_id as string, client: row.client as SessionClient, idHash } : null;
}

export async function revokeSession(q: Queryable, token: string, now: Date = new Date()): Promise<boolean> {
  if (!token) return false;
  const r = await q.query(`UPDATE sessions SET revoked_at = $2 WHERE id_hash = $1 AND revoked_at IS NULL`, [hashSessionToken(token), now]);
  return (r.rowCount ?? 0) > 0;
}

export async function revokeAllSessions(q: Queryable, userId: string, now: Date = new Date()): Promise<number> {
  const r = await q.query(`UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL`, [userId, now]);
  return r.rowCount ?? 0;
}

/** Login always mints a fresh token and kills the one presented, so a planted cookie cannot be fixed. */
export async function rotateSession(
  q: Queryable,
  previousToken: string | null | undefined,
  input: { userId: string; client: SessionClient; uaHash?: string | null; now?: Date },
): Promise<CreatedSession> {
  if (previousToken) await revokeSession(q, previousToken, input.now);
  return createSession(q, input);
}

/** Global (user_id IS NULL) feature flag read. Absent means off. */
export async function isFeatureEnabled(q: Queryable, key: string): Promise<boolean> {
  const r = await q.query(`SELECT enabled FROM feature_flags WHERE key = $1 AND user_id IS NULL`, [key]);
  return r.rows[0]?.enabled === true;
}

/** Used by the dev seed and e2e setup to turn `accounts` on. */
export async function setFeatureFlag(q: Queryable, key: string, enabled: boolean): Promise<void> {
  await q.query(
    `INSERT INTO feature_flags (key, enabled, user_id) VALUES ($1, $2, NULL)
     ON CONFLICT (key, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [key, enabled],
  );
}
