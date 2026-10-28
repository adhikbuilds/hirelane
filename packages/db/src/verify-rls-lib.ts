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
 */
export type RlsMode = 'own' | 'own-r' | 'own-nd' | 'rev' | 'ins-only' | 'pub';

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
];

/** Tables with a user_id column that are intentionally not row-isolated. */
const USER_ID_EXEMPT = new Set(['feature_flags']);

export type FixtureFault = 'no-rls' | 'open-insert' | 'grant-revoked' | 'grant-update' | 'grant-delete';

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
  return [mk('fx_own', 'own'), mk('fx_rev', 'rev'), mk('fx_ins', 'ins-only'), mk('fx_pub', 'pub'), mk('fx_nd', 'own-nd')];
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

async function checkTable(spec: RlsTableSpec, owner: Client, admin: Client, a: string, b: string, ok: (cond: boolean, msg: string) => void): Promise<void> {
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
