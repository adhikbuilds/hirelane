import { randomUUID } from 'node:crypto';
import type { Queryable } from '../src/auth/sessions.js';

/** Creates a user the only legal way: the age_18_plus consent lands in the same statement. Synthetic data only. */
export async function mkUser(c: Queryable, email = `user-${randomUUID()}@example.test`): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  await c.query(
    `WITH u AS (INSERT INTO users (id, email, email_verified_at) VALUES ($1, $2, now()) RETURNING id)
     INSERT INTO consents (user_id, kind, granted, doc_version) SELECT id, 'age_18_plus', true, 'test' FROM u`,
    [id, email],
  );
  return { id, email };
}
