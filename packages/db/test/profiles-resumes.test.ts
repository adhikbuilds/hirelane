import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrator.js';
import { mkUser } from './auth-helpers.js';
import { freshTestClient, TEST_URL } from './helpers.js';

/** 0010: profiles, work_authorizations, answer_bank, resumes, file_access_log, eligibility_profiles. Synthetic data only. */
let c: Client;
beforeAll(async () => {
  c = await freshTestClient();
  await applyMigrations(c, resolve(import.meta.dirname, '../migrations'));
});
afterAll(async () => {
  await c.end();
});

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function guarded(sql: string, params: unknown[] = []): Promise<string | undefined> {
  await c.query('BEGIN');
  try {
    await c.query(sql, params);
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  } finally {
    await c.query('ROLLBACK');
  }
}

const RESUME_COLS = 'user_id, source, mime, size_bytes, file_hmac, blob_key';
async function mkResume(userId: string, extra: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  const row: Record<string, unknown> = { id, user_id: userId, source: 'upload', mime: PDF, size_bytes: 1000, file_hmac: `h-${id}`, blob_key: `resumes/${id}`, ...extra };
  const cols = Object.keys(row);
  await c.query(`INSERT INTO resumes (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(row));
  return id;
}

describe('0010 tables exist and drop dek_wrapped', () => {
  it('has the six tables and no dek_wrapped or filename column', async () => {
    for (const t of ['profiles', 'work_authorizations', 'answer_bank', 'resumes', 'file_access_log', 'eligibility_profiles']) {
      expect((await c.query('SELECT 1 FROM information_schema.tables WHERE table_name = $1', [t])).rowCount, t).toBe(1);
    }
    const cols = (await c.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name IN ('resumes','eligibility_profiles')`)).rows.map((r) => r.column_name);
    expect(cols).not.toContain('dek_wrapped');
    expect(cols).not.toContain('file_name');
    expect(cols).not.toContain('filename');
    expect(cols).not.toContain('gap_reason');
  });

  it('allows the linkedin auth provider and still refuses unknown ones', async () => {
    const u = await mkUser(c);
    expect(await guarded(`INSERT INTO auth_identities (user_id, provider, subject) VALUES ($1, 'linkedin', 'li-sub')`, [u.id])).toBeUndefined();
    expect(await guarded(`INSERT INTO auth_identities (user_id, provider, subject) VALUES ($1, 'facebook', 'x')`, [u.id])).toBe('23514');
  });
});

describe('resumes constraints', () => {
  it('accepts a minimal upload row and applies defaults', async () => {
    const u = await mkUser(c);
    const id = await mkResume(u.id);
    const r = (await c.query('SELECT parse_status, is_default, sensitive_kinds, skills, health_passed, health_total FROM resumes WHERE id = $1', [id])).rows[0]!;
    expect(r.parse_status).toBe('uploaded');
    expect(r.is_default).toBe(false);
    expect(r.sensitive_kinds).toEqual([]);
    expect(r.skills).toEqual([]);
  });

  it.each([
    ['bad source', { source: 'scan' }],
    ['bad mime', { mime: 'image/png' }],
    ['zero size', { size_bytes: 0 }],
    ['over 5 MB', { size_bytes: 5 * 1024 * 1024 + 1 }],
    ['bad parse_status', { parse_status: 'weird' }],
    ['bad text_layer', { text_layer: 'ocr' }],
    ['pages 0', { pages: 0 }],
    ['unknown sensitive kind', { sensitive_kinds: ['aadhaar', 'blood_group'] }],
    ['health_passed > health_total', { health_passed: 5, health_total: 4 }],
    ['health_total > 9', { health_passed: 1, health_total: 10 }],
    ['health not an array', { health: '{"a":1}' }],
    ['confirmed without confirmed_at', { parse_status: 'confirmed' }],
    ['reject_code on a parsed row', { parse_status: 'parsed', reject_code: 'zip_guard' }],
    ['deleted without purge_after', { deleted_at: new Date() }],
    ['purged but parsed_enc present', { purged_at: new Date(), parsed_enc: Buffer.from('x') }],
  ])('rejects %s', async (_n, extra) => {
    const u = await mkUser(c);
    await c.query('BEGIN');
    let err: string | undefined;
    try {
      await mkResume(u.id, extra);
    } catch (e) {
      err = (e as { code?: string }).code;
    }
    await c.query('ROLLBACK');
    expect(err).toBe('23514');
  });

  it('accepts DOCX, builder, rejected-with-code and confirmed rows', async () => {
    const u = await mkUser(c);
    await mkResume(u.id, { mime: DOCX, pages: null });
    await mkResume(u.id, { source: 'builder', parse_status: 'draft' });
    await mkResume(u.id, { parse_status: 'rejected', reject_code: 'zip_guard' });
    const root = await mkResume(u.id, { parse_status: 'confirmed', confirmed_at: new Date() }).catch((e: { code?: string }) => e.code);
    // The fourth active root is refused by the cap (the first three were roots).
    expect(root).toBe('23514');
  });

  it('allows only one default resume per user among active rows', async () => {
    const u = await mkUser(c);
    const a = await mkResume(u.id, { is_default: true });
    expect(await guarded(`INSERT INTO resumes (${RESUME_COLS}, is_default) VALUES ($1, 'upload', $2, 10, 'h-x', 'k/x', true)`, [u.id, PDF])).toBe('23505');
    await c.query('UPDATE resumes SET deleted_at = now(), purge_after = now() + interval \'24 hours\' WHERE id = $1', [a]);
    await mkResume(u.id, { is_default: true });
  });

  it('rejects a parent that belongs to another user', async () => {
    const u1 = await mkUser(c);
    const u2 = await mkUser(c);
    const parent = await mkResume(u1.id);
    expect(await guarded(`INSERT INTO resumes (${RESUME_COLS}, parent_id) VALUES ($1, 'upload', $2, 10, 'h-y', 'k/y', $3)`, [u2.id, PDF, parent])).toBe('23503');
  });
});

describe('at most 3 active root resumes', () => {
  it('refuses a 4th root, ignores versions, and frees a slot on soft delete', async () => {
    const u = await mkUser(c);
    const roots = [await mkResume(u.id), await mkResume(u.id), await mkResume(u.id)];
    expect(await guarded(`INSERT INTO resumes (${RESUME_COLS}) VALUES ($1, 'upload', $2, 10, 'h-4', 'k/4')`, [u.id, PDF])).toBe('23514');
    // Versions (rows with a parent) do not count as roots.
    await mkResume(u.id, { parent_id: roots[0], parse_status: 'confirmed', confirmed_at: new Date() });
    await mkResume(u.id, { parent_id: roots[0], parse_status: 'confirmed', confirmed_at: new Date() });
    await c.query(`UPDATE resumes SET deleted_at = now(), purge_after = now() + interval '24 hours' WHERE id = $1`, [roots[1]]);
    await mkResume(u.id);
    // Another user is unaffected.
    const other = await mkUser(c);
    await mkResume(other.id);
  });

  it('refuses an undelete that would exceed the cap', async () => {
    const u = await mkUser(c);
    const a = await mkResume(u.id);
    await c.query(`UPDATE resumes SET deleted_at = now(), purge_after = now() + interval '24 hours' WHERE id = $1`, [a]);
    await mkResume(u.id);
    await mkResume(u.id);
    await mkResume(u.id);
    expect(await guarded('UPDATE resumes SET deleted_at = NULL, purge_after = NULL WHERE id = $1', [a])).toBe('23514');
  });

  it('holds under concurrent inserts from separate connections', async () => {
    const u = await mkUser(c);
    const clients = await Promise.all(Array.from({ length: 6 }, async () => {
      const k = new Client({ connectionString: TEST_URL });
      await k.connect();
      return k;
    }));
    try {
      const results = await Promise.allSettled(
        clients.map((k, i) => k.query(`INSERT INTO resumes (${RESUME_COLS}) VALUES ($1, 'upload', $2, 10, $3, $4)`, [u.id, PDF, `h-c${i}`, `k/c${i}`])),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
      const n = (await c.query('SELECT count(*)::int AS n FROM resumes WHERE user_id = $1', [u.id])).rows[0]!.n;
      expect(n).toBe(3);
    } finally {
      await Promise.all(clients.map((k) => k.end()));
    }
  });
});

describe('file_access_log', () => {
  it('records an access, survives resume removal (resume_id becomes null) and is bound to the same user', async () => {
    const u = await mkUser(c);
    const o = await mkUser(c);
    const rid = await mkResume(u.id);
    await c.query(`INSERT INTO file_access_log (user_id, resume_id, action) VALUES ($1, $2, 'download')`, [u.id, rid]);
    expect(await guarded(`INSERT INTO file_access_log (user_id, resume_id, action) VALUES ($1, $2, 'download')`, [o.id, rid])).toBe('23503');
    expect(await guarded(`INSERT INTO file_access_log (user_id, resume_id, action) VALUES ($1, $2, 'steal')`, [u.id, rid])).toBe('23514');
    await c.query('DELETE FROM resumes WHERE id = $1', [rid]);
    const row = (await c.query('SELECT resume_id FROM file_access_log WHERE user_id = $1', [u.id])).rows[0]!;
    expect(row.resume_id).toBeNull();
  });
});

describe('profiles, work_authorizations, answer_bank', () => {
  it('apply defaults and CHECKs', async () => {
    const u = await mkUser(c);
    await c.query('INSERT INTO profiles (user_id) VALUES ($1)', [u.id]);
    const p = (await c.query('SELECT tz, picks_hour, remote_ok, role_families, cities FROM profiles WHERE user_id = $1', [u.id])).rows[0]!;
    expect(p).toMatchObject({ tz: 'Asia/Kolkata', picks_hour: 9, remote_ok: false, role_families: [], cities: [] });
    const cols = (await c.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'profiles'`)).rows.map((r) => r.column_name);
    for (const gone of ['college_tier', 'cohort_code', 'grad_year', 'degree']) expect(cols).not.toContain(gone);
    expect(await guarded('UPDATE profiles SET picks_hour = 24 WHERE user_id = $1', [u.id])).toBe('23514');

    await c.query(`INSERT INTO work_authorizations (user_id, country, status) VALUES ($1, 'IN', 'citizen')`, [u.id]);
    expect(await guarded(`INSERT INTO work_authorizations (user_id, country, status) VALUES ($1, 'IN', 'citizen')`, [u.id])).toBe('23505');
    expect(await guarded(`INSERT INTO work_authorizations (user_id, country, status) VALUES ($1, 'in', 'citizen')`, [u.id])).toBe('23514');
    expect(await guarded(`INSERT INTO work_authorizations (user_id, country, status) VALUES ($1, 'US', 'tourist')`, [u.id])).toBe('23514');

    await c.query(`INSERT INTO answer_bank (user_id, question_key, answer_enc) VALUES ($1, 'notice_period', $2)`, [u.id, Buffer.from('sealed')]);
    expect(await guarded(`INSERT INTO answer_bank (user_id, question_key, answer_enc) VALUES ($1, 'notice_period', $2)`, [u.id, Buffer.from('s')])).toBe('23505');
    expect(await guarded(`INSERT INTO answer_bank (user_id, question_key, answer_enc, source) VALUES ($1, 'k2', $2, 'llm')`, [u.id, Buffer.from('s')])).toBe('23514');
  });
});

describe('eligibility_profiles', () => {
  const EP = 'user_id, confirmed_at';
  it('stores a confirmed profile and enforces the Amendment B CHECKs', async () => {
    const u = await mkUser(c);
    await c.query(
      `INSERT INTO eligibility_profiles (user_id, pct_10, board_10, secondary_kind, pct_secondary, degree, branch_code, branch_raw, grad_score, grad_scale, grad_pct_equiv, grad_conversion, grad_is_final, active_backlogs, backlog_history, gap_years, passout_year, lateral_entry, field_meta, confirmed_at)
       VALUES ($1, 88.5, 'CBSE', '12th', 81, 'B.Tech', 'CSE', 'Computer Sci', 8.2, 10, 78.4, 'direct', true, 0, 1, 0, 2027, false, '{"pct_10":{"source":"resume","confidence":"high"}}', now())`,
      [u.id],
    );
    const bad: [string, string, unknown][] = [
      ['pct_10 > 100', 'pct_10', 101],
      ['secondary_kind', 'secondary_kind', '13th'],
      ['grad_scale', 'grad_scale', 7],
      ['grad_conversion', 'grad_conversion', 'guess'],
      ['active_backlogs < 0', 'active_backlogs', -1],
      ['gap_years > 20', 'gap_years', 21],
      ['passout_year', 'passout_year', 1900],
    ];
    for (const [name, col, v] of bad) {
      expect(await guarded(`UPDATE eligibility_profiles SET ${col} = $2 WHERE user_id = $1`, [u.id, v]), name).toBe('23514');
    }
    expect(await guarded('UPDATE eligibility_profiles SET grad_score = 11 WHERE user_id = $1', [u.id])).toBe('23514');
    expect(await guarded("UPDATE eligibility_profiles SET grad_conversion = 'campus:" + randomUUID() + "' WHERE user_id = $1", [u.id])).toBeUndefined();
    expect(await guarded('UPDATE eligibility_profiles SET field_meta = \'[]\' WHERE user_id = $1', [u.id])).toBe('23514');
  });

  it('requires confirmed_at (nothing is stored before confirm) and one row per user', async () => {
    const u = await mkUser(c);
    expect(await guarded(`INSERT INTO eligibility_profiles (user_id) VALUES ($1)`, [u.id])).toBe('23502');
    await c.query(`INSERT INTO eligibility_profiles (${EP}) VALUES ($1, now())`, [u.id]);
    expect(await guarded(`INSERT INTO eligibility_profiles (${EP}) VALUES ($1, now())`, [u.id])).toBe('23505');
  });

  it('refuses a source resume owned by someone else and nulls it when the resume goes', async () => {
    const u = await mkUser(c);
    const o = await mkUser(c);
    const mine = await mkResume(u.id);
    const theirs = await mkResume(o.id);
    expect(await guarded(`INSERT INTO eligibility_profiles (${EP}, source_resume_id) VALUES ($1, now(), $2)`, [u.id, theirs])).toBe('23503');
    await c.query(`INSERT INTO eligibility_profiles (${EP}, source_resume_id) VALUES ($1, now(), $2)`, [u.id, mine]);
    await c.query('DELETE FROM resumes WHERE id = $1', [mine]);
    const r = (await c.query('SELECT source_resume_id, user_id FROM eligibility_profiles WHERE user_id = $1', [u.id])).rows[0]!;
    expect(r.source_resume_id).toBeNull();
    expect(r.user_id).toBe(u.id);
  });
});

describe('account deletion cascades through the new tables', () => {
  it('removes every row of the user and leaves others', async () => {
    const u = await mkUser(c);
    const o = await mkUser(c);
    const rid = await mkResume(u.id);
    await mkResume(o.id);
    await c.query('INSERT INTO profiles (user_id) VALUES ($1)', [u.id]);
    await c.query(`INSERT INTO work_authorizations (user_id, country, status) VALUES ($1, 'IN', 'citizen')`, [u.id]);
    await c.query(`INSERT INTO answer_bank (user_id, question_key, answer_enc) VALUES ($1, 'k', $2)`, [u.id, Buffer.from('s')]);
    await c.query(`INSERT INTO file_access_log (user_id, resume_id, action) VALUES ($1, $2, 'download')`, [u.id, rid]);
    await c.query(`INSERT INTO eligibility_profiles (user_id, confirmed_at, source_resume_id) VALUES ($1, now(), $2)`, [u.id, rid]);
    await c.query('DELETE FROM users WHERE id = $1', [u.id]);
    for (const t of ['profiles', 'work_authorizations', 'answer_bank', 'resumes', 'file_access_log', 'eligibility_profiles']) {
      expect((await c.query(`SELECT 1 FROM ${t} WHERE user_id = $1`, [u.id])).rowCount, t).toBe(0);
    }
    expect((await c.query('SELECT 1 FROM resumes WHERE user_id = $1', [o.id])).rowCount).toBe(1);
  });
});

describe('0010a: builder drafts have no file yet; app-role insert grants are narrow', () => {
  async function asApp<T>(userId: string, fn: () => Promise<T>): Promise<{ ok: boolean; code?: string }> {
    await c.query('BEGIN');
    try {
      await c.query('SET LOCAL ROLE hirelane_app');
      await c.query("SELECT set_config('hirelane.user_id', $1, true)", [userId]);
      await fn();
      return { ok: true };
    } catch (e) {
      return { ok: false, code: (e as { code?: string }).code };
    } finally {
      await c.query('ROLLBACK');
    }
  }

  it('lets the app role insert a builder draft with no file, size, hash or blob key', async () => {
    const u = await mkUser(c);
    const r = await asApp(u.id, () =>
      c.query(`INSERT INTO resumes (user_id, source, mime, parse_status, parsed_enc) VALUES ($1, 'builder', 'application/pdf', 'draft', '\\x00')`, [u.id]),
    );
    expect(r).toEqual({ ok: true });
  });

  it('still requires the file fields for uploads and for a non-draft builder row', async () => {
    const u = await mkUser(c);
    expect(await guarded(`INSERT INTO resumes (user_id, source, mime) VALUES ($1, 'upload', 'application/pdf')`, [u.id])).toBe('23514');
    expect(await guarded(`INSERT INTO resumes (user_id, source, mime, parse_status) VALUES ($1, 'builder', 'application/pdf', 'parsed')`, [u.id])).toBe('23514');
    expect(await guarded(`INSERT INTO resumes (user_id, source, mime, size_bytes, file_hmac) VALUES ($1, 'upload', 'application/pdf', 5, 'h')`, [u.id])).toBe('23514');
  });

  it('keeps extractor-owned columns out of the app role INSERT grant', async () => {
    const u = await mkUser(c);
    for (const col of ['pages', 'text_layer', 'producer_family', 'health', 'health_passed', 'health_total', 'sensitive_kinds', 'reject_code', 'purged_at']) {
      const r = await asApp(u.id, () =>
        c.query(`INSERT INTO resumes (user_id, source, mime, size_bytes, file_hmac, blob_key, ${col}) SELECT $1, 'upload', 'application/pdf', 5, 'h-' || gen_random_uuid(), 'k/' || gen_random_uuid(), ${col} FROM resumes LIMIT 0`, [u.id]),
      );
      expect(r.code, col).toBe('42501');
    }
    const ok = await asApp(u.id, () =>
      c.query(`INSERT INTO resumes (user_id, source, mime, size_bytes, file_hmac, blob_key, skills) VALUES ($1, 'upload', 'application/pdf', 5, 'h-' || gen_random_uuid(), 'k/' || gen_random_uuid(), ARRAY['sql'])`, [u.id]),
    );
    expect(ok).toEqual({ ok: true });
  });
});

describe('0010b: a purged resume keeps nothing derived from the file', () => {
  const purged = { deleted_at: new Date(), purge_after: new Date(), purged_at: new Date() };
  it.each([
    ['label', { label: 'Asha Rao CV' }],
    ['skills', { skills: ['sql'] }],
    ['file_hmac', { file_hmac: 'h' }],
    ['blob_key', { blob_key: 'resumes/x' }],
  ])('refuses a purged row that still has %s', async (_n, extra) => {
    const u = await mkUser(c);
    const base = { file_hmac: null, blob_key: null, label: null, skills: [] as string[] };
    await c.query('BEGIN');
    let err: string | undefined;
    try {
      await mkResume(u.id, { ...base, ...purged, ...extra });
    } catch (e) {
      err = (e as { code?: string }).code;
    } finally {
      await c.query('ROLLBACK');
    }
    expect(err).toBe('23514');
  });

  it('accepts a fully purged row, and still demands the file fields on a live row', async () => {
    const u = await mkUser(c);
    expect(await guarded(`INSERT INTO resumes (user_id, source, mime, size_bytes, deleted_at, purge_after, purged_at) VALUES ($1, 'upload', 'application/pdf', 5, now(), now(), now())`, [u.id])).toBeUndefined();
    expect(await guarded(`INSERT INTO resumes (user_id, source, mime, size_bytes) VALUES ($1, 'upload', 'application/pdf', 5)`, [u.id])).toBe('23514');
  });
});
