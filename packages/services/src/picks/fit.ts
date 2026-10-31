import type { CgpaRule, EligibilityProfileInput } from '@hirelane/engine';
import type { UserClient } from '../db';
import { asCgpaRule, profileFromRow } from '../campus/drives';
import { membershipIn } from '../campus/membership';
import type { StudentFit } from './rank';

export interface StudentContext {
  /** The confirmed eligibility profile, or null when the student has not confirmed one. */
  profile: EligibilityProfileInput | null;
  /** The campus CGPA rule when the student is on a campus that set one. */
  cgpaRule: CgpaRule;
  placed: boolean;
  fit: StudentFit;
}

/**
 * Everything about the signed-in student that picks and paste-a-job need, read in the caller's transaction with their own
 * session (row level security applies, so it can only be their own rows).
 */
export async function loadStudentContext(c: UserClient, userId: string): Promise<StudentContext> {
  // One client, one query at a time (a transaction's client does not take concurrent queries).
  const member = await membershipIn(c, userId);
  const prof = await c.query('SELECT * FROM eligibility_profiles WHERE user_id = $1', [userId]);
  const resume = await c.query(
    `SELECT skills FROM resumes WHERE user_id = $1 AND deleted_at IS NULL AND purged_at IS NULL AND confirmed_at IS NOT NULL
      ORDER BY is_default DESC, confirmed_at DESC LIMIT 1`,
    [userId],
  );
  const prefs = await c.query('SELECT cities, remote_ok FROM profiles WHERE user_id = $1', [userId]);
  const p = prefs.rows[0];
  return {
    profile: profileFromRow(prof.rows[0]),
    cgpaRule: asCgpaRule(member?.campus.cgpaRule),
    placed: member?.placed === true,
    fit: {
      skillIds: ((resume.rows[0]?.skills as string[] | undefined) ?? []).map((s) => s.toLowerCase()),
      cities: ((p?.cities as string[] | undefined) ?? []),
      remote: p?.remote_ok === true,
      yearsExperience: 0,
    },
  };
}
