import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { isLocalUrl } from './env.js';

/**
 * Row level security harness (pnpm db:verify-rls).
 *
 * Stance (migration 0007): RLS is ENABLEd, never FORCEd. `hirelane_app` is the only role bound by
 * policies and it owns nothing. Table owners bypass RLS, so withAdmin is kept to an allowlist.
 *
 * Table driven: each entry of RLS_TABLES names a real table, how it must behave for the app role
 * (`mode`) and how to seed one row for a user. M1/M2 add their tables to RLS_TABLES. A throwaway
 * fixture (one table per mode) proves the harness itself, created and dropped by a temporary
 * NON-superuser owner role so SET ROLE membership is exercised the way production will use it.
 */
/**
 * own      read and write own rows (select, insert, update, delete)
 * own-nd   read, insert and update own rows; the app role cannot delete (soft delete only; the owner purges)
 * own-r    read and update own rows; the app role can neither insert nor delete (owner creates and deletes)
 * ins-only read and insert own rows; no update, no delete
 * rev      revoked from the app role entirely
 * pub      readable by the app role, nothing else
 * ten      read-only, scoped to the caller's tenant (a campus, or the caller as subject): the caller sees every row of
 *          their own tenant and none of another's; every write is denied (writes go through definer functions)
 */
export type RlsMode = 'own' | 'own-r' | 'own-nd' | 'rev' | 'ins-only' | 'pub' | 'ten';

/** Tenant-keyed tables (modes `ten`, and `rev` when the table is keyed by a tenant instead of a user). */
export interface TenantSpec {
  /** Column that holds the tenant id (uuid). */
  column: string;
  /** Seeds (idempotently) and returns the tenant id the user belongs to. */
  of(admin: Client, userId: string): Promise<string>;
}

export interface RlsTableSpec {
  /** Short label used in messages. */
  name: string;
  /** Schema-qualified, trusted identifier, for example `public.profiles`. */
  table: string;
  mode: RlsMode;
  /** Column holding the owning user id (`id` for the users table). */
  userColumn: string;
  /** Inserts one row for the user, as the admin. Must be safe to run twice with different users. */
  seed(admin: Client, userId: string): Promise<void>;
  /** Removes whatever `seed` created. Real tables must provide it; the fixture is dropped wholesale. */
  cleanup?(admin: Client, userIds: string[]): Promise<void>;
  /** INSERT run as the app role; `$1` is the user id. Defaults to setting only the user column. */
  insertSql?: string;
  /** UPDATE run as the app role; `$1` is the user id. Defaults to `SET col = col`. Needed when only some columns are grantable. */
  updateSql?: string;
  /** Present for tables keyed by a tenant (campus, cohort) instead of a user: the checks run per tenant. */
  tenant?: TenantSpec;
}

/** Real tables under test. Later milestones append here (users, profiles, resumes, picks, ...). */
/** Creates a users row the only legal way (the age_18_plus consent in the same statement). Safe to repeat. */
async function ensureUser(admin: Client, userId: string): Promise<void> {
  await admin.query(
    `WITH u AS (
       INSERT INTO users (id, email, email_verified_at) VALUES ($1, $2, now()) ON CONFLICT (id) DO NOTHING RETURNING id
     )
     INSERT INTO consents (user_id, kind, granted, doc_version) SELECT id, 'age_18_plus', true, 'rls-fixture' FROM u`,
    [userId, `rls-${userId}@example.test`],
  );
}
const dropUsers = async (admin: Client, ids: string[]): Promise<void> => {
  // Campus fixtures hang off a membership, so remove them before the users go (a campus has no owner column to cascade from).
  await admin.query('DELETE FROM campuses WHERE id IN (SELECT campus_id FROM cohort_members WHERE user_id = ANY($1::uuid[]))', [ids]);
  await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
};
const authSpec = (
  name: string,
  mode: RlsMode,
  userColumn: string,
  seedSql: string | null,
  extra: Partial<RlsTableSpec> = {},
): RlsTableSpec => ({
  name,
  table: `public.${name}`,
  mode,
  userColumn,
  seed: async (admin, userId) => {
    await ensureUser(admin, userId);
    if (seedSql) await admin.query(seedSql, [userId]);
  },
  cleanup: dropUsers,
  ...extra,
});

/**
 * Seeds one campus world for a user, once: campus, domain, cohort, a verified membership, a roster row and import, a staff
 * seat, an access-log row, join attempts, an OTP binding, a published drive with a check, an outcome and a stats row. Every
 * campus table spec seeds through it, so each fixture user owns a tenant of their own.
 */
async function seedCampus(admin: Client, userId: string): Promise<{ campusId: string; cohortId: string; driveId: string }> {
  await ensureUser(admin, userId);
  const have = await admin.query<{ campus_id: string; cohort_id: string; drive: string }>(
    `SELECT m.campus_id, m.cohort_id, (SELECT d.id FROM drives d WHERE d.cohort_id = m.cohort_id LIMIT 1) AS drive FROM cohort_members m WHERE m.user_id = $1`,
    [userId],
  );
  if (have.rows[0]) return { campusId: have.rows[0].campus_id, cohortId: have.rows[0].cohort_id, driveId: have.rows[0].drive };
  const campusId = randomUUID();
  const cohortId = randomUUID();
  const driveId = randomUUID();
  const challengeId = randomUUID();
  const tag = campusId.slice(0, 8);
  const q = (sql: string, p: unknown[] = []) => admin.query(sql, p);
  await q('INSERT INTO campuses (id, name, code_hmac) VALUES ($1, $2, $3)', [campusId, `rls-fixture ${tag}`, `rls-code-${campusId}`]);
  await q('INSERT INTO campus_domains (campus_id, domain) VALUES ($1, $2)', [campusId, `rls-${tag}.example.test`]);
  await q("INSERT INTO cohorts (id, campus_id, passout_year, programme) VALUES ($1, $2, 2026, 'RLS Programme')", [cohortId, campusId]);
  await q(
    "INSERT INTO cohort_members (user_id, campus_id, cohort_id, verified_via, verified_at, email_hmac) VALUES ($1, $2, $3, 'email', now(), $4)",
    [userId, campusId, cohortId, `rls-mail-${userId}`],
  );
  await q('INSERT INTO cohort_roster (campus_id, cohort_id, email_hmac) VALUES ($1, $2, $3)', [campusId, cohortId, `rls-roster-${userId}`]);
  await q('INSERT INTO cohort_imports (campus_id, cohort_id, rows_total, rows_valid, rows_rejected) VALUES ($1, $2, 1, 1, 0)', [campusId, cohortId]);
  await q("INSERT INTO tpo_members (campus_id, user_id, email_hmac, role, claimed_at) VALUES ($1, $2, $3, 'owner', now())", [campusId, userId, `rls-staff-${userId}`]);
  await q("INSERT INTO tpo_access_log (campus_id, subject_user_id, action) VALUES ($1, $2, 'outcomes_list')", [campusId, userId]);
  await q("INSERT INTO join_attempts (user_id, kind, ok) VALUES ($1, 'code', true)", [userId]);
  await q(
    "INSERT INTO otp_challenges (id, channel, purpose, target_hmac, code_hash, expires_at, user_id) VALUES ($1, 'email', 'campus_email', 'rls', 'rls', now() + interval '1 day', $2)",
    [challengeId, userId],
  );
  await q('INSERT INTO campus_otp_bindings (challenge_id, user_id, campus_id) VALUES ($1, $2, $3)', [challengeId, userId, campusId]);
  await q("INSERT INTO drives (id, campus_id, cohort_id, title, notice_text) VALUES ($1, $2, $3, 'RLS drive', 'Open to all.')", [driveId, campusId, cohortId]);
  await q("INSERT INTO drive_checks (drive_id, user_id, verdict) VALUES ($1, $2, 'unknown')", [driveId, userId]);
  await q("INSERT INTO outcomes (user_id, campus_id, cohort_id, kind, employer) VALUES ($1, $2, $3, 'offer', 'RLS Employer')", [userId, campusId, cohortId]);
  await q("INSERT INTO cohort_stats_daily (cohort_id, day, metric, n, p) VALUES ($1, current_date, 'joined_verified', 1, 1)", [cohortId]);
  return { campusId, cohortId, driveId };
}
const dropCampuses = dropUsers;
const campusSpec = (name: string, mode: RlsMode, userColumn: string, extra: Partial<RlsTableSpec> = {}): RlsTableSpec => ({
  name,
  table: `public.${name}`,
  mode,
  userColumn,
  seed: async (admin, userId) => {
    await seedCampus(admin, userId);
  },
  cleanup: dropCampuses,
  ...extra,
});
const campusTenant = (column: string, pick: 'campusId' | 'cohortId'): TenantSpec => ({
  column,
  of: async (admin, userId) => (await seedCampus(admin, userId))[pick],
});
const userTenant = (column: string): TenantSpec => ({ column, of: async (admin, userId) => (await seedCampus(admin, userId), userId) });

/**
 * Seeds one apply world for a user, once (0012): a job to apply to and a spare job for the insert probe, an application, a
 * form answer, a receipt, an inbound message, a notification and an apply address. The jobs are named rls-apply-* and removed
 * again by dropApply, so a run against a real local database leaves nothing on the public board.
 */
async function seedApply(admin: Client, userId: string): Promise<void> {
  await ensureUser(admin, userId);
  const have = await admin.query('SELECT 1 FROM applications WHERE user_id = $1', [userId]);
  if (have.rows[0]) return;
  const tag = userId;
  const q = (sql: string, p: unknown[] = []) => admin.query(sql, p);
  const companyId = randomUUID();
  const boardId = randomUUID();
  await q('INSERT INTO companies (id, slug, name, domain) VALUES ($1, $2, $3, $4)', [companyId, `rls-apply-${tag}`, 'RLS Apply Co', `rls-apply-${tag}.example.test`]);
  await q("INSERT INTO company_boards (id, company_id, ats, token) VALUES ($1, $2, 'greenhouse', $3)", [boardId, companyId, `rls-apply-${tag}`]);
  const jobs: string[] = [];
  for (const kind of ['seed', 'probe']) {
    const postingId = randomUUID();
    const jobId = randomUUID();
    await q(
      `INSERT INTO postings (id, board_id, external_id, key, url, title, raw, content_hash, first_seen_at, last_seen_at, source)
       VALUES ($1, $2, $3, $4, $5, 'RLS job', '{}'::jsonb, 'h', now(), now(), 'fixture')`,
      [postingId, boardId, `rls-${kind}`, `rls-apply-${kind}-${tag}`, `https://greenhouse.fixture.invalid/rls/${kind}`],
    );
    await q(
      `INSERT INTO jobs (id, slug, company_id, title, title_norm, doc_hash, first_seen_at, last_seen_at, enrich_version, primary_posting_id, source)
       VALUES ($1, $2, $3, 'RLS job', 'rls job', 'd', now(), now(), 1, $4, 'fixture')`,
      [jobId, `rls-apply-${kind}-${tag}`, companyId, postingId],
    );
    jobs.push(jobId);
  }
  const appId = randomUUID();
  await q('INSERT INTO applications (id, user_id, job_id) VALUES ($1, $2, $3)', [appId, userId, jobs[0]]);
  await q("INSERT INTO application_answers (application_id, user_id, field_id, label, needs_you) VALUES ($1, $2, 'rls', 'RLS question', true)", [appId, userId]);
  await q("INSERT INTO receipts (application_id, user_id, answers_hash, platform, result_code, sent) VALUES ($1, $2, repeat('0', 64), 'greenhouse', 'rls_seed', false)", [appId, userId]);
  const inboundId = randomUUID();
  await q(
    "INSERT INTO inbound_messages (id, user_id, application_id, message_id, employer, from_domain, kind, matched_by, excerpt_enc, received_at) VALUES ($1, $2, $3, $4, 'RLS Apply Co', 'example.test', 'other', 'company', '\\x00', now())",
    [inboundId, userId, appId, `rls-${userId}`],
  );
  await q("INSERT INTO notifications (user_id, kind, title, application_id, inbound_id) VALUES ($1, 'employer_message', 'RLS note', $2, $3)", [userId, appId, inboundId]);
  await q('INSERT INTO apply_addresses (user_id, handle, domain, reply_handle) VALUES ($1, $2, $3, $4)', [
    userId,
    `rls${userId.replace(/-/g, '').slice(0, 12)}`,
    'apply.example.test',
    userId.replace(/-/g, '').slice(0, 16),
  ]);
}
const dropApply = async (admin: Client, ids: string[]): Promise<void> => {
  await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
  await admin.query("DELETE FROM jobs WHERE slug LIKE 'rls-apply-%'");
  await admin.query("DELETE FROM companies WHERE slug LIKE 'rls-apply-%'");
};
const applySpec = (name: string, mode: RlsMode, userColumn: string, extra: Partial<RlsTableSpec> = {}): RlsTableSpec => ({
  name,
  table: `public.${name}`,
  mode,
  userColumn,
  seed: seedApply,
  cleanup: dropApply,
  ...extra,
});
const applyTenant: TenantSpec = { column: 'user_id', of: async (admin, userId) => (await seedApply(admin, userId), userId) };

export const RLS_TABLES: RlsTableSpec[] = [
  // 0008 auth. users is created and deleted by the owner role, so the app role gets read + update only.
  authSpec('users', 'own-r', 'id', null, { updateSql: 'UPDATE users SET display_name = display_name WHERE id = $1' }),
  authSpec('consents', 'ins-only', 'user_id', null, {
    insertSql: "INSERT INTO consents (user_id, kind, granted, doc_version) VALUES ($1, 'analytics', true, 'rls')",
  }),
  authSpec('product_events', 'ins-only', 'user_id', "INSERT INTO product_events (user_id, event) VALUES ($1, 'rls_seed')", {
    insertSql: "INSERT INTO product_events (user_id, event) VALUES ($1, 'rls_probe')",
  }),
  authSpec('idempotency_keys', 'own', 'user_id', "INSERT INTO idempotency_keys (user_id, key) VALUES ($1, 'rls-seed')", {
    insertSql: "INSERT INTO idempotency_keys (user_id, key) VALUES ($1, 'rls-probe')",
  }),
  // Revoked from the app role: only the hirelane_auth role (withAuth in apps/web/lib/auth) reaches them.
  authSpec(
    'sessions',
    'rev',
    'user_id',
    "INSERT INTO sessions (id_hash, user_id, client, expires_at, absolute_expires_at) VALUES ('rls-' || gen_random_uuid(), $1, 'web', now() + interval '1 day', now() + interval '1 day')",
  ),
  authSpec(
    'otp_challenges',
    'rev',
    'user_id',
    "INSERT INTO otp_challenges (channel, purpose, target_hmac, code_hash, expires_at, user_id) VALUES ('email', 'login', 'rls', 'rls', now() + interval '1 day', $1)",
  ),
  authSpec('auth_identities', 'rev', 'user_id', "INSERT INTO auth_identities (user_id, provider, subject) VALUES ($1::uuid, 'google', 'rls-' || gen_random_uuid())"),
  // 0010 profiles, resumes, eligibility. Rows are seeded as the owner; probes run as the app role.
  authSpec('profiles', 'own', 'user_id', 'INSERT INTO profiles (user_id) VALUES ($1)', { insertSql: 'INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id' }),
  authSpec('work_authorizations', 'own', 'user_id', "INSERT INTO work_authorizations (user_id, country, status) VALUES ($1, 'IN', 'citizen')", {
    insertSql: "INSERT INTO work_authorizations (user_id, country, status) VALUES ($1, 'US', 'visa_held')",
  }),
  authSpec('answer_bank', 'own', 'user_id', "INSERT INTO answer_bank (user_id, question_key, answer_enc) VALUES ($1, 'rls_seed', '\\x00')", {
    insertSql: "INSERT INTO answer_bank (user_id, question_key, answer_enc) VALUES ($1, 'rls_probe', '\\x00')",
  }),
  authSpec(
    'resumes',
    'own-nd',
    'user_id',
    "INSERT INTO resumes (user_id, source, mime, size_bytes, file_hmac, blob_key) VALUES ($1, 'upload', 'application/pdf', 10, 'rls-seed-' || gen_random_uuid(), 'rls/seed-' || gen_random_uuid())",
    {
      insertSql:
        "INSERT INTO resumes (user_id, source, mime, size_bytes, file_hmac, blob_key) VALUES ($1, 'upload', 'application/pdf', 10, 'rls-probe-' || gen_random_uuid(), 'rls/probe-' || gen_random_uuid())",
      updateSql: 'UPDATE resumes SET label = label WHERE user_id = $1',
    },
  ),
  authSpec('file_access_log', 'ins-only', 'user_id', "INSERT INTO file_access_log (user_id, action) VALUES ($1, 'download')", {
    insertSql: "INSERT INTO file_access_log (user_id, action) VALUES ($1, 'preview')",
  }),
  authSpec('eligibility_profiles', 'own', 'user_id', 'INSERT INTO eligibility_profiles (user_id, confirmed_at) VALUES ($1, now())', {
    insertSql: 'INSERT INTO eligibility_profiles (user_id, confirmed_at) VALUES ($1, now()) ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id',
  }),
  // 0011 campus. Each fixture user owns a tenant (seedCampus). Students read their own campus rows (ten) and edit only
  // their share level (cohort_members, own-r); outcomes are reported by the student (own-nd); the rest is definer-only (rev).
  campusSpec('campuses', 'ten', 'id', { tenant: campusTenant('id', 'campusId') }),
  campusSpec('campus_domains', 'ten', 'campus_id', { tenant: campusTenant('campus_id', 'campusId') }),
  campusSpec('cohorts', 'ten', 'campus_id', { tenant: campusTenant('campus_id', 'campusId') }),
  campusSpec('drives', 'ten', 'campus_id', { tenant: campusTenant('campus_id', 'campusId') }),
  campusSpec('drive_checks', 'ten', 'user_id', { tenant: userTenant('user_id') }),
  campusSpec('tpo_access_log', 'ten', 'subject_user_id', { tenant: userTenant('subject_user_id') }),
  campusSpec('cohort_members', 'own-r', 'user_id', { updateSql: 'UPDATE cohort_members SET share_level = share_level WHERE user_id = $1' }),
  campusSpec('outcomes', 'own-nd', 'user_id', {
    insertSql:
      "INSERT INTO outcomes (user_id, campus_id, cohort_id, kind, employer) VALUES ($1, (SELECT campus_id FROM cohort_members WHERE user_id = current_setting('hirelane.user_id')::uuid), (SELECT cohort_id FROM cohort_members WHERE user_id = current_setting('hirelane.user_id')::uuid), 'interview', 'RLS Probe')",
    updateSql: 'UPDATE outcomes SET employer = employer WHERE user_id = $1',
  }),
  campusSpec('cohort_roster', 'rev', 'campus_id', { tenant: campusTenant('campus_id', 'campusId') }),
  campusSpec('cohort_imports', 'rev', 'campus_id', { tenant: campusTenant('campus_id', 'campusId') }),
  campusSpec('tpo_members', 'rev', 'campus_id', { tenant: campusTenant('campus_id', 'campusId') }),
  campusSpec('cohort_stats_daily', 'rev', 'cohort_id', { tenant: campusTenant('cohort_id', 'cohortId') }),
  campusSpec('join_attempts', 'rev', 'user_id', { tenant: userTenant('user_id') }),
  campusSpec('campus_otp_bindings', 'rev', 'user_id', { tenant: userTenant('user_id') }),
  // 0012 apply pipeline. The app role creates an application (ready only) and may undo it; the worker owns every outcome.
  // Addresses are insert-only (the cap is not the student's to raise); answers, receipts and inbound mail are read-only.
  applySpec('apply_addresses', 'ins-only', 'user_id', {
    insertSql:
      "INSERT INTO apply_addresses (user_id, handle, domain, reply_handle) VALUES ($1, 'rlsprobe' || substr(md5(current_setting('hirelane.user_id')), 1, 8), 'apply.example.test', substr(md5(current_setting('hirelane.user_id') || 'p'), 1, 16)) ON CONFLICT (user_id) DO NOTHING",
  }),
  applySpec('applications', 'own-nd', 'user_id', {
    insertSql:
      "INSERT INTO applications (user_id, job_id) VALUES ($1, (SELECT id FROM jobs WHERE slug = 'rls-apply-probe-' || current_setting('hirelane.user_id')))",
    updateSql: 'UPDATE applications SET status = status WHERE user_id = $1',
  }),
  applySpec('notifications', 'own-r', 'user_id', { updateSql: 'UPDATE notifications SET read_at = read_at WHERE user_id = $1' }),
  applySpec('application_answers', 'ten', 'user_id', { tenant: applyTenant }),
  applySpec('receipts', 'ten', 'user_id', { tenant: applyTenant }),
  applySpec('inbound_messages', 'ten', 'user_id', { tenant: applyTenant }),
];

/**
 * Every SECURITY DEFINER function in schema public, and whether the app role may execute it. The harness fails on a
 * definer function that is not listed, one without a pinned search_path, one PUBLIC can execute, and any mismatch between
 * the app role's EXECUTE right and `appCallable`.
 */
export const DEFINER_REGISTRY: Record<string, { appCallable: boolean }> = {
  campus_join_code: { appCallable: true },
  campus_email_issue: { appCallable: true },
  campus_email_spend: { appCallable: true },
  campus_email_join: { appCallable: true },
  campus_leave: { appCallable: true },
  tpo_claim_invites: { appCallable: true },
  tpo_memberships: { appCallable: true },
  tpo_create_cohort: { appCallable: true },
  tpo_list_cohorts: { appCallable: true },
  tpo_cohort_stats: { appCallable: true },
  tpo_publish_drive: { appCallable: true },
  tpo_list_drives: { appCallable: true },
  tpo_drive_counts: { appCallable: true },
  tpo_list_outcomes: { appCallable: true },
  tpo_verify_outcome: { appCallable: true },
  tpo_outcome_letter: { appCallable: true },
  tpo_naac_rows: { appCallable: true },
  tpo_import_roster: { appCallable: true },
  tpo_invite_staff: { appCallable: true },
  tpo_list_staff: { appCallable: true },
  // 0013: owner-only staff lifecycle (app-callable), and the roster applier run by the nightly snapshot job (owner only).
  tpo_remove_staff: { appCallable: true },
  tpo_transfer_ownership: { appCallable: true },
  campus_apply_roster: { appCallable: false },
  tpo_role: { appCallable: false },
  tpo_campus_of_cohort: { appCallable: false },
  // 0012: the insert trigger that snapshots the job. Fires as a trigger only; nobody calls it.
  applications_before_insert: { appCallable: false },
};

/** Tables with a user_id column that are intentionally not row-isolated. */
const USER_ID_EXEMPT = new Set(['feature_flags']);

export type FixtureFault = 'no-rls' | 'open-insert' | 'grant-revoked' | 'grant-update' | 'grant-delete' | 'open-tenant' | 'ten-writable';

export interface VerifyRlsOptions {
  /** Connection string of the database under test. Must be local: the harness creates a role. */
  url: string;
  tables?: RlsTableSpec[];
  /** Skip the throwaway fixture (only the role posture and registered tables run). */
  fixture?: boolean;
  /** Test hook: break the fixture on purpose to prove the harness fails. */
  fixtureFaults?: FixtureFault[];
}

export interface RlsReport {
  checks: number;
  failures: string[];
}

interface Probe {
  rowCount: number | null;
  rows: Record<string, unknown>[];
  code?: string;
}

const SAME_USER = `user_id = current_setting('hirelane.user_id')::uuid`;

function fixtureSpecs(schema: string): RlsTableSpec[] {
  const mk = (name: string, mode: RlsMode): RlsTableSpec => ({
    name,
    table: `${schema}.${name}`,
    mode,
    userColumn: 'user_id',
    seed: async (c, userId) => {
      await c.query(`INSERT INTO ${schema}.${name} (user_id, note) VALUES ($1, 'seed')`, [userId]);
    },
  });
  const ten: RlsTableSpec = {
    ...mk('fx_ten', 'ten'),
    tenant: { column: 'user_id', of: async (_c, userId) => userId },
  };
  return [mk('fx_own', 'own'), mk('fx_rev', 'rev'), mk('fx_ins', 'ins-only'), mk('fx_pub', 'pub'), mk('fx_nd', 'own-nd'), ten];
}

function fixtureDdl(schema: string, owner: string, faults: readonly FixtureFault[]): string[] {
  const cols = `id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, note text`;
  const ddl = [
    `CREATE SCHEMA ${schema} AUTHORIZATION ${owner}`,
    `GRANT USAGE ON SCHEMA ${schema} TO hirelane_app`,
    `SET LOCAL ROLE ${owner}`,
    `CREATE TABLE ${schema}.fx_own (${cols})`,
    ...(faults.includes('no-rls') ? [] : [`ALTER TABLE ${schema}.fx_own ENABLE ROW LEVEL SECURITY`]),
    ...(faults.includes('open-insert')
      ? [
          // A split policy whose INSERT side checks nothing: the classic way WITH CHECK goes missing.
          `CREATE POLICY fx_own_sel ON ${schema}.fx_own FOR SELECT TO hirelane_app USING (${SAME_USER})`,
          `CREATE POLICY fx_own_upd ON ${schema}.fx_own FOR UPDATE TO hirelane_app USING (${SAME_USER})`,
          `CREATE POLICY fx_own_del ON ${schema}.fx_own FOR DELETE TO hirelane_app USING (${SAME_USER})`,
          `CREATE POLICY fx_own_ins ON ${schema}.fx_own FOR INSERT TO hirelane_app WITH CHECK (true)`,
        ]
      : [`CREATE POLICY fx_own_all ON ${schema}.fx_own FOR ALL TO hirelane_app USING (${SAME_USER}) WITH CHECK (${SAME_USER})`]),
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ${schema}.fx_own TO hirelane_app`,
    `CREATE TABLE ${schema}.fx_rev (${cols})`,
    `REVOKE ALL ON ${schema}.fx_rev FROM PUBLIC, hirelane_app`,
    ...(faults.includes('grant-revoked') ? [`GRANT SELECT ON ${schema}.fx_rev TO hirelane_app`] : []),
    `CREATE TABLE ${schema}.fx_ins (${cols})`,
    `ALTER TABLE ${schema}.fx_ins ENABLE ROW LEVEL SECURITY`,
    `CREATE POLICY fx_ins_sel ON ${schema}.fx_ins FOR SELECT TO hirelane_app USING (${SAME_USER})`,
    `CREATE POLICY fx_ins_ins ON ${schema}.fx_ins FOR INSERT TO hirelane_app WITH CHECK (${SAME_USER})`,
    ...(faults.includes('grant-update')
      ? [
          `CREATE POLICY fx_ins_upd ON ${schema}.fx_ins FOR UPDATE TO hirelane_app USING (${SAME_USER})`,
          `GRANT SELECT, INSERT, UPDATE ON ${schema}.fx_ins TO hirelane_app`,
        ]
      : [`GRANT SELECT, INSERT ON ${schema}.fx_ins TO hirelane_app`]),
    `CREATE TABLE ${schema}.fx_nd (${cols})`,
    `ALTER TABLE ${schema}.fx_nd ENABLE ROW LEVEL SECURITY`,
    `CREATE POLICY fx_nd_all ON ${schema}.fx_nd FOR ALL TO hirelane_app USING (${SAME_USER}) WITH CHECK (${SAME_USER})`,
    `GRANT SELECT, INSERT, UPDATE${faults.includes('grant-delete') ? ', DELETE' : ''} ON ${schema}.fx_nd TO hirelane_app`,
    `CREATE TABLE ${schema}.fx_ten (${cols})`,
    `ALTER TABLE ${schema}.fx_ten ENABLE ROW LEVEL SECURITY`,
    // A leak is a SELECT policy that does not scope to the tenant.
    `CREATE POLICY fx_ten_sel ON ${schema}.fx_ten FOR SELECT TO hirelane_app USING (${faults.includes('open-tenant') ? 'true' : SAME_USER})`,
    `GRANT SELECT${faults.includes('ten-writable') ? ', INSERT' : ''} ON ${schema}.fx_ten TO hirelane_app`,
    ...(faults.includes('ten-writable') ? [`CREATE POLICY fx_ten_ins ON ${schema}.fx_ten FOR INSERT TO hirelane_app WITH CHECK (true)`] : []),
    `CREATE TABLE ${schema}.fx_pub (${cols})`,
    `GRANT SELECT ON ${schema}.fx_pub TO hirelane_app`,
    `RESET ROLE`,
  ];
  return ddl;
}

/** One statement in its own transaction as the app role, always rolled back. */
async function probe(owner: Client, userId: string | null, sql: string, params: unknown[] = []): Promise<Probe> {
  await owner.query('BEGIN');
  try {
    await owner.query('SET LOCAL ROLE hirelane_app');
    if (userId) await owner.query("SELECT set_config('hirelane.user_id', $1, true)", [userId]);
    await owner.query('SAVEPOINT p');
    try {
      const r = await owner.query(sql, params);
      return { rowCount: r.rowCount, rows: r.rows };
    } catch (e) {
      return { rowCount: null, rows: [], code: (e as { code?: string }).code ?? 'unknown' };
    }
  } finally {
    await owner.query('ROLLBACK');
  }
}

const DENIED = '42501';

async function checkTenantTable(spec: RlsTableSpec, owner: Client, admin: Client, a: string, b: string, ok: (cond: boolean, msg: string) => void): Promise<void> {
  const t = spec.table;
  const n = spec.name;
  const tc = spec.tenant!.column;
  const ta = await spec.tenant!.of(admin, a);
  const tb = await spec.tenant!.of(admin, b);
  ok(ta !== tb, `${n}: the two fixture users share a tenant`);
  const denied = async (as: string | null, sql: string, params: unknown[] = []) => (await probe(owner, as, sql, params)).code === DENIED;
  const ins = spec.insertSql ?? `INSERT INTO ${t} (${tc}) VALUES ($1)`;
  const upd = spec.updateSql ?? `UPDATE ${t} SET ${tc} = ${tc} WHERE ${tc} = $1`;
  const del = `DELETE FROM ${t} WHERE ${tc} = $1`;

  const seeded = await admin.query(`SELECT ${tc}::text AS v FROM ${t} WHERE ${tc} = ANY($1::uuid[])`, [[ta, tb]]);
  ok(seeded.rows.some((r) => r.v === ta) && seeded.rows.some((r) => r.v === tb), `${n}: seed rows missing for the fixture tenants`);

  if (spec.mode === 'ten') {
    const meta = (await admin.query<{ rls: boolean; force: boolean }>(`SELECT relrowsecurity AS rls, relforcerowsecurity AS force FROM pg_class WHERE oid = $1::regclass`, [t])).rows[0];
    ok(meta?.rls === true, `${n}: row level security is not enabled`);
    ok(meta?.force === false, `${n}: FORCE ROW LEVEL SECURITY is set (decision: ENABLE without FORCE)`);
    const mine = await probe(owner, a, `SELECT count(*)::int AS n FROM ${t} WHERE ${tc} = $1`, [ta]);
    ok(mine.code === undefined && (mine.rows[0]?.n as number) >= 1, `${n}: user A cannot read A's own tenant rows`);
    const theirs = await probe(owner, a, `SELECT count(*)::int AS n FROM ${t} WHERE ${tc} = $1`, [tb]);
    ok(theirs.code === undefined && theirs.rows[0]?.n === 0, `${n}: user A can read another tenant's rows`);
    const none = await probe(owner, null, `SELECT 1 FROM ${t}`);
    ok(none.code !== undefined || none.rows.length === 0, `${n}: rows are visible with no user context`);
    ok(await denied(a, ins, [ta]), `${n}: a tenant-scoped table accepts inserts from the app role`);
    ok(await denied(a, upd, [ta]), `${n}: a tenant-scoped table accepts updates from the app role`);
    ok(await denied(a, del, [ta]), `${n}: a tenant-scoped table accepts deletes from the app role`);
  } else if (spec.mode === 'rev') {
    ok(await denied(a, `SELECT 1 FROM ${t}`), `${n}: revoked table is readable by the app role`);
    ok(await denied(a, ins, [ta]), `${n}: revoked table accepts inserts from the app role`);
    ok(await denied(a, upd, [ta]), `${n}: revoked table accepts updates from the app role`);
    ok(await denied(a, del, [ta]), `${n}: revoked table accepts deletes from the app role`);
  } else {
    ok(false, `${n}: mode ${spec.mode} is not supported for tenant-keyed tables`);
  }
}

async function checkTable(spec: RlsTableSpec, owner: Client, admin: Client, a: string, b: string, ok: (cond: boolean, msg: string) => void): Promise<void> {
  if (spec.tenant) return checkTenantTable(spec, owner, admin, a, b, ok);
  const t = spec.table;
  const col = spec.userColumn;
  const n = spec.name;
  const count = async (as: string | null, who: string) =>
    probe(owner, as, `SELECT count(*)::int AS n FROM ${t} WHERE ${col} = $1`, [who]);
  const denied = async (as: string | null, sql: string, params: unknown[] = []) => (await probe(owner, as, sql, params)).code === DENIED;
  const ins = spec.insertSql ?? `INSERT INTO ${t} (${col}) VALUES ($1)`;
  const upd = spec.updateSql ?? `UPDATE ${t} SET ${col} = ${col} WHERE ${col} = $1`;
  const del = `DELETE FROM ${t} WHERE ${col} = $1`;

  // The seed is real, so a pass cannot be an artifact of empty tables.
  const seeded = await admin.query(`SELECT ${col}::text AS u FROM ${t} WHERE ${col} = ANY($1::uuid[])`, [[a, b]]);
  ok(seeded.rows.some((r) => r.u === a) && seeded.rows.some((r) => r.u === b), `${n}: seed rows missing for the fixture users`);

  const meta = await admin.query<{ rls: boolean; force: boolean }>(
    `SELECT relrowsecurity AS rls, relforcerowsecurity AS force FROM pg_class WHERE oid = $1::regclass`,
    [t],
  );
  const m = meta.rows[0];
  if (spec.mode !== 'rev' && spec.mode !== 'pub') {
    ok(m?.rls === true, `${n}: row level security is not enabled`);
    ok(m?.force === false, `${n}: FORCE ROW LEVEL SECURITY is set (decision: ENABLE without FORCE)`);
  }

  if (spec.mode === 'own' || spec.mode === 'ins-only' || spec.mode === 'own-r' || spec.mode === 'own-nd') {
    const own = await count(a, a);
    ok(own.code === undefined && own.rows[0]?.n === 1, `${n}: user A cannot read A's own row`);
    const other = await count(a, b);
    ok(other.code === undefined && other.rows[0]?.n === 0, `${n}: user A can read user B's rows`);
    const none = await probe(owner, null, `SELECT 1 FROM ${t}`);
    ok(none.code !== undefined || none.rows.length === 0, `${n}: rows are visible with no user context`);
  }
  if (spec.mode === 'own' || spec.mode === 'ins-only' || spec.mode === 'own-nd') {
    ok(await denied(a, ins, [b]), `${n}: user A can insert a row for user B`);
    const mine = await probe(owner, a, ins, [a]);
    ok(mine.code === undefined, `${n}: user A cannot insert their own row${mine.code ? ` (${mine.code})` : ''}`);
  }
  if (spec.mode === 'own-r') {
    ok(await denied(a, ins, [a]), `${n}: the app role can insert (rows are created by the owner role only)`);
    ok(await denied(a, del, [a]), `${n}: the app role can delete its own row (deletion is owner-only)`);
    const ub = await probe(owner, a, upd, [b]);
    ok(ub.code === undefined && ub.rowCount === 0, `${n}: user A can update user B's rows`);
    const ua = await probe(owner, a, upd, [a]);
    ok(ua.code === undefined && (ua.rowCount ?? 0) >= 1, `${n}: user A cannot update their own row${ua.code ? ` (${ua.code})` : ''}`);
  }
  if (spec.mode === 'own-nd') {
    const ub = await probe(owner, a, upd, [b]);
    ok(ub.code === undefined && ub.rowCount === 0, `${n}: user A can update user B's rows`);
    const ua = await probe(owner, a, upd, [a]);
    ok(ua.code === undefined && (ua.rowCount ?? 0) >= 1, `${n}: user A cannot update their own row${ua.code ? ` (${ua.code})` : ''}`);
    ok(await denied(a, del, [a]), `${n}: the app role can delete its own row (deletion is owner-only; soft delete instead)`);
  }
  if (spec.mode === 'own') {
    const ub = await probe(owner, a, upd, [b]);
    ok(ub.code === undefined && ub.rowCount === 0, `${n}: user A can update user B's rows`);
    const db = await probe(owner, a, del, [b]);
    ok(db.code === undefined && db.rowCount === 0, `${n}: user A can delete user B's rows`);
    const ua = await probe(owner, a, upd, [a]);
    ok(ua.code === undefined && (ua.rowCount ?? 0) >= 1, `${n}: user A cannot update their own row`);
    const da = await probe(owner, a, del, [a]);
    ok(da.code === undefined && (da.rowCount ?? 0) >= 1, `${n}: user A cannot delete their own row`);
  }
  if (spec.mode === 'ins-only') {
    ok(await denied(a, upd, [a]), `${n}: update is not denied on an insert-only table`);
    ok(await denied(a, del, [a]), `${n}: delete is not denied on an insert-only table`);
  }
  if (spec.mode === 'rev') {
    ok(await denied(a, `SELECT 1 FROM ${t}`), `${n}: revoked table is readable by the app role`);
    ok(await denied(a, ins, [a]), `${n}: revoked table accepts inserts from the app role`);
    ok(await denied(a, upd, [a]), `${n}: revoked table accepts updates from the app role`);
    ok(await denied(a, del, [a]), `${n}: revoked table accepts deletes from the app role`);
  }
  if (spec.mode === 'pub') {
    const r = await probe(owner, a, `SELECT 1 FROM ${t}`);
    ok(r.code === undefined && r.rows.length >= 1, `${n}: public table is not readable`);
    ok(await denied(a, ins, [a]), `${n}: public table accepts inserts from the app role`);
    ok(await denied(a, upd, [a]), `${n}: public table accepts updates from the app role`);
    ok(await denied(a, del, [a]), `${n}: public table accepts deletes from the app role`);
  }
}

/** SECURITY DEFINER functions: registered, search_path pinned, closed to PUBLIC, open to the app role only where intended. */
async function checkDefiners(admin: Client, ok: (cond: boolean, msg: string) => void): Promise<void> {
  const rows = (
    await admin.query<{ name: string; args: string; config: string[] | null; pub: boolean; app: boolean; owner: string }>(
      `SELECT p.proname AS name, p.oid::regprocedure::text AS args, p.proconfig AS config,
              has_function_privilege('public', p.oid, 'EXECUTE') AS pub,
              has_function_privilege('hirelane_app', p.oid, 'EXECUTE') AS app,
              pg_get_userbyid(p.proowner) AS owner
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef`,
    )
  ).rows;
  const seen = new Set<string>();
  for (const r of rows) {
    seen.add(r.name);
    const entry = DEFINER_REGISTRY[r.name];
    ok(!!entry, `${r.args}: SECURITY DEFINER function is not in DEFINER_REGISTRY (register it, pin search_path, revoke PUBLIC)`);
    ok((r.config ?? []).some((c) => /^search_path=/.test(c) && !/\$user/.test(c)), `${r.args}: SECURITY DEFINER function has no pinned search_path`);
    ok(!r.pub, `${r.args}: PUBLIC can execute this SECURITY DEFINER function`);
    if (entry) ok(r.app === entry.appCallable, `${r.args}: the app role's EXECUTE right (${r.app}) differs from the registry (${entry.appCallable})`);
    ok(r.owner !== 'hirelane_app', `${r.args}: owned by the app role`);
  }
  for (const name of Object.keys(DEFINER_REGISTRY)) ok(seen.has(name), `${name}: listed in DEFINER_REGISTRY but missing from the database`);
}

async function checkPosture(admin: Client, registry: RlsTableSpec[], ok: (cond: boolean, msg: string) => void): Promise<void> {
  const role = (await admin.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'hirelane_app'",
  )).rows[0];
  ok(!!role, 'hirelane_app role does not exist');
  ok(role?.rolsuper === false && role?.rolbypassrls === false, 'hirelane_app must not be SUPERUSER or BYPASSRLS');

  const owned = (await admin.query<{ n: number }>(
    `SELECT (SELECT count(*) FROM pg_class WHERE relowner = 'hirelane_app'::regrole)::int
          + (SELECT count(*) FROM pg_namespace WHERE nspowner = 'hirelane_app'::regrole)::int
          + (SELECT count(*) FROM pg_proc WHERE proowner = 'hirelane_app'::regrole)::int AS n`,
  )).rows[0]!.n;
  ok(owned === 0, `hirelane_app owns ${owned} object(s); it must own nothing`);

  const create = (await admin.query<{ c: boolean }>("SELECT has_schema_privilege('hirelane_app', 'public', 'CREATE') AS c")).rows[0]!.c;
  ok(!create, 'hirelane_app has CREATE on schema public');

  const member = (await admin.query<{ m: boolean }>("SELECT pg_has_role(current_user, 'hirelane_app', 'MEMBER') AS m")).rows[0]!.m;
  ok(member, 'the connecting role cannot SET ROLE hirelane_app (not a member)');

  await checkDefiners(admin, ok);

  // Registry completeness: new RLS tables must be added to RLS_TABLES, and no user table may skip RLS.
  const registered = new Set(registry.map((s) => s.table.replace(/^public\./, '')));
  const rls = await admin.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity`,
  );
  for (const r of rls.rows) ok(registered.has(r.relname), `${r.relname}: has row level security but is not in the RLS registry (add it to RLS_TABLES)`);

  const bare = await admin.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'user_id' AND NOT a.attisdropped
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
        AND has_table_privilege('hirelane_app', c.oid, 'SELECT, INSERT, UPDATE, DELETE')`,
  );
  for (const r of bare.rows) {
    if (!USER_ID_EXEMPT.has(r.relname) && !registered.has(r.relname)) {
      ok(false, `${r.relname}: has a user_id column and grants to hirelane_app without row level security`);
    }
  }
}

export async function verifyRls(admin: Client, opts: VerifyRlsOptions): Promise<RlsReport> {
  if (!isLocalUrl(opts.url)) throw new Error('verify-rls creates a temporary role, so it only runs against a local database');
  const registry = opts.tables ?? RLS_TABLES;
  const report: RlsReport = { checks: 0, failures: [] };
  const ok = (cond: boolean, msg: string): void => {
    report.checks++;
    if (!cond) report.failures.push(msg);
  };

  await checkPosture(admin, registry, ok);

  const suffix = randomBytes(5).toString('hex');
  const ownerRole = `hl_rls_${suffix}`;
  const schema = `hl_rls_${suffix}`;
  const password = randomBytes(16).toString('hex');
  const a = randomUUID();
  const b = randomUUID();
  const fixture = opts.fixture === false ? [] : fixtureSpecs(schema);
  const specs = [...fixture, ...registry];
  let owner: Client | undefined;
  let created = false;
  try {
    created = true;
    await admin.query(`CREATE ROLE ${ownerRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${password}'`);
    // The same membership migration 0007 grants to the real owner, which SET ROLE depends on.
    await admin.query(`GRANT hirelane_app TO ${ownerRole}`);
    if (fixture.length > 0) {
      await admin.query('BEGIN');
      try {
        for (const stmt of fixtureDdl(schema, ownerRole, opts.fixtureFaults ?? [])) await admin.query(stmt);
        await admin.query('COMMIT');
      } catch (e) {
        await admin.query('ROLLBACK');
        throw e;
      }
    }
    const u = new URL(opts.url);
    u.username = ownerRole;
    u.password = password;
    owner = new Client({ connectionString: u.toString() });
    await owner.connect();
    const who = (await owner.query<{ su: boolean }>('SELECT rolsuper AS su FROM pg_roles WHERE rolname = current_user')).rows[0]!;
    ok(!who.su, 'the harness owner connection must be a non-superuser');

    for (const s of specs) {
      try {
        await s.seed(admin, a);
        await s.seed(admin, b);
      } catch (e) {
        ok(false, `${s.name}: seeding failed: ${(e as Error).message}`);
        continue;
      }
      await checkTable(s, owner, admin, a, b, ok).catch((e: unknown) => ok(false, `${s.name}: check crashed: ${(e as Error).message}`));
    }
  } finally {
    if (owner) await owner.end().catch(() => undefined);
    for (const s of registry) await s.cleanup?.(admin, [a, b]).catch(() => undefined);
    if (created) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
      await admin.query(`DROP OWNED BY ${ownerRole}`).catch(() => undefined);
      await admin.query(`DROP ROLE IF EXISTS ${ownerRole}`).catch(() => undefined);
    }
  }
  return report;
}
