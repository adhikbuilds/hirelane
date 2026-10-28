import { revokeAllSessions, type Queryable } from './sessions.js';

export interface DeleteAccountResult {
  deleted: boolean;
  sessionsRevoked: number;
}

/**
 * Account deletion (DPDP erasure). Order matters: sessions are revoked first, so no cookie can act on the
 * account while the delete is in flight, then the users row goes and the foreign keys cascade through
 * identities, sessions, consents, events and idempotency keys. Run it on a single connection (withAdmin).
 * Later slices register their purge hooks (resume blobs, parsed_enc) next to this call.
 */
export async function deleteAccount(q: Queryable, userId: string, now: Date = new Date()): Promise<DeleteAccountResult> {
  await q.query('BEGIN');
  try {
    const sessionsRevoked = await revokeAllSessions(q, userId, now);
    const r = await q.query('DELETE FROM users WHERE id = $1', [userId]);
    await q.query('COMMIT');
    return { deleted: (r.rowCount ?? 0) > 0, sessionsRevoked };
  } catch (e) {
    await q.query('ROLLBACK');
    throw e;
  }
}
