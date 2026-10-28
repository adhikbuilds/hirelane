/**
 * Integration: the real SQL of the resume tasks against Postgres (CHECKs, grants, partial indexes), a real LocalBlobStore
 * and the real child-process extractor. Uses a throwaway database so it never touches the shared hirelane_test schema.
 * Needs the local Postgres (docker compose, :5433): it FAILS loudly if the server is down and is skipped only for a non-local TEST_DATABASE_URL. Synthetic data only.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from '@hirelane/db';
import { verhoeffCheckDigit } from '@hirelane/engine';
import { EnvKeyProvider, LocalBlobStore, generateMasterKey, MASTER_KEY_ENV } from '../../../packages/vault/src/index';
import { TEST_URL } from '../../../packages/db/test/helpers';
import { mkUser } from '../../../packages/db/test/auth-helpers';
import { blobKeyFor, createPgRepo, createResumeVault, fileAad, parsedAad, type ResumeVault } from '../src/tasks/resume-common';
import { createResumeExtractTasks } from '../src/tasks/resume-extract';
import { createResumeRenderTasks } from '../src/tasks/resume-render';
import { createResumePurgeTasks, sweepResumes } from '../src/tasks/resume-purge';
import { createResumeStuckTasks, sweepStuck } from '../src/tasks/resume-stuck';
import { builderFileName, type BuilderAnswers } from '../src/resume/render/index';
import * as fx from './fixtures/generate-resume-fixtures';

const DBNAME = `hl_runner_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const url = new URL(TEST_URL);
const isLocal = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
let c: Client;
let admin: Client | undefined;
let storage: string;
let vault: ResumeVault;
let available = false;

beforeAll(async () => {
  if (!isLocal) return;
  try {
    admin = new Client({ connectionString: TEST_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${DBNAME}`);
    url.pathname = `/${DBNAME}`;
    c = new Client({ connectionString: url.toString() });
    await c.connect();
    await applyMigrations(c, resolve(import.meta.dirname, '../../../packages/db/migrations'));
    storage = mkdtempSync(join(tmpdir(), 'hl-resume-'));
    vault = createResumeVault(new LocalBlobStore(storage), new EnvKeyProvider({ [MASTER_KEY_ENV]: generateMasterKey() }));
    available = true;
  } catch {
    available = false;
  }
}, 60_000);

afterAll(async () => {
  await c?.end().catch(() => undefined);
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS ${DBNAME} WITH (FORCE)`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
  if (storage) rmSync(storage, { recursive: true, force: true });
});

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const helpers = () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  job: { attempts: 1, max_attempts: 25 },
  added: [] as { id: string; payload: unknown; spec: unknown }[],
  async addJob(id: string, payload?: unknown, spec?: unknown) {
    this.added.push({ id, payload, spec });
  },
});
const NOW = () => new Date();
const repo = () => createPgRepo((fn) => fn(c as never));
const extractTask = () => createResumeExtractTasks({ repo: repo(), vault, now: NOW })['resume:extract']!;
const renderTask = () => createResumeRenderTasks({ repo: repo(), vault, now: NOW })['resume:render']!;
const purgeTasks = () => createResumePurgeTasks({ repo: repo(), vault, now: NOW });

async function row(id: string): Promise<Record<string, unknown>> {
  return (await c.query('SELECT * FROM resumes WHERE id = $1', [id])).rows[0];
}

async function uploaded(userId: string, bytes: Uint8Array, over: { fileName?: string; createdAt?: Date; mime?: string; parentId?: string } = {}): Promise<string> {
  const id = randomUUID();
  const blobKey = blobKeyFor(userId, id);
  await vault.putBlob(blobKey, Buffer.from(bytes), fileAad(id, userId));
  const parsedEnc = over.fileName ? await vault.sealJson({ fileName: over.fileName }, parsedAad(id, userId)) : null;
  await c.query(
    `INSERT INTO resumes (id, user_id, parent_id, source, mime, size_bytes, file_hmac, blob_key, parsed_enc, created_at)
     VALUES ($1, $2, $3, 'upload', $4, $5, $6, $7, $8, $9)`,
    [id, userId, over.parentId ?? null, over.mime ?? PDF, bytes.length, `h-${id}`, blobKey, parsedEnc, over.createdAt ?? new Date()],
  );
  return id;
}

const answers: BuilderAnswers = {
  name: 'Asha Example',
  email: 'asha.example@example.test',
  phone: '90000 00001',
  education: [{ qualification: 'B.Tech Computer Science', institution: 'Example Institute of Technology', year: '2026', score: 'CGPA 8.2/10' }],
  skills: ['Python', 'SQL', 'Git'],
  projects: [{ title: 'Library tracker', link: 'https://github.com/asha-example/library', bullets: ['Built a REST API serving 1200 books with 98% test coverage', 'Cut latency by 40% with an index'] }],
};

const base = '23456789012';
const SPACED = (() => {
  const n = `${base}${verhoeffCheckDigit(base)}`;
  return `${n.slice(0, 4)} ${n.slice(4, 8)} ${n.slice(8)}`;
})();
const aadhaarDocx = () => fx.docxFromDocumentXml(fx.docXml(['Asha Example', 'asha.example@example.test 90000 00001', `Aadhaar: ${SPACED}`, 'Skills', 'Python, SQL, Git']));

describe.skipIf(!isLocal)('resume tasks against Postgres', () => {
  const need = () => {
    if (!available) throw new Error('Postgres test database is not available (start docker compose: db on :5433)');
  };

  it('builder: draft -> render -> extract ends parsed, readable, 1 page, 9 of 9, extractor columns set by the owner role', async () => {
    need();
    const u = await mkUser(c);
    const id = randomUUID();
    // The app role inserts the draft: no file fields, answers sealed into parsed_enc.
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE hirelane_app');
    await c.query("SELECT set_config('hirelane.user_id', $1, true)", [u.id]);
    await c.query(`INSERT INTO resumes (id, user_id, source, mime, parse_status, parsed_enc) VALUES ($1, $2, 'builder', $3, 'draft', $4)`, [id, u.id, PDF, await vault.sealJson({ v: 1, answers }, parsedAad(id, u.id))]);
    await c.query('COMMIT');

    const h = helpers();
    await renderTask()({ resumeId: id }, h as never);
    let r = await row(id);
    expect(r['parse_status']).toBe('uploaded');
    expect(r['blob_key']).toBe(blobKeyFor(u.id, id));
    expect(r['size_bytes']).toBeGreaterThan(1000);
    expect(String(r['file_hmac'])).toMatch(/^[0-9a-f]{64}$/);
    expect(h.added).toEqual([{ id: 'resume:extract', payload: { resumeId: id }, spec: { jobKey: `resume:extract:${id}` } }]);

    await extractTask()({ resumeId: id }, helpers() as never);
    r = await row(id);
    expect(r).toMatchObject({ parse_status: 'parsed', text_layer: 'readable', pages: 1, health_passed: 9, health_total: 9, reject_code: null, parsed_version: 1 });
    expect(r['producer_family']).toMatch(/^[a-z_]{1,24}$/);
    expect(r['sensitive_kinds']).toEqual([]);
    expect(r['parsed_enc']).not.toBeNull();
    expect(builderFileName(answers)).toBe('Asha_Example_Resume.pdf');

    // Idempotent: a second extract (retry or duplicate job) does nothing.
    const before = r['updated_at'];
    await extractTask()({ resumeId: id }, helpers() as never);
    expect((await row(id))['updated_at']).toEqual(before);
  }, 60_000);

  it('Aadhaar DOCX: masked parse, kind flagged, no value anywhere in the row, original blob untouched', async () => {
    need();
    const u = await mkUser(c);
    const id = await uploaded(u.id, aadhaarDocx(), { mime: DOCX, fileName: 'Asha_Example_Resume.docx' });
    await extractTask()({ resumeId: id }, helpers() as never);
    const r = await row(id);
    expect(r['parse_status']).toBe('parsed');
    expect(r['sensitive_kinds']).toContain('aadhaar');
    expect(r['pages']).toBeNull();
    expect(JSON.stringify(r['health'])).not.toContain(SPACED.replace(/ /g, ''));
    const doc = (await vault.openJson(r['parsed_enc'] as Buffer, parsedAad(id, u.id))) as { text: string; fileName: string };
    expect(doc.text).not.toContain(SPACED);
    expect(doc.text).toContain('XXXX XXXX XXXX');
    expect(doc.fileName).toBe('Asha_Example_Resume.docx');
    expect(await vault.getBlob(blobKeyFor(u.id, id), fileAad(id, u.id))).toBeInstanceOf(Buffer);
  }, 60_000);

  it('image-only PDF stops at needs_text; a 4-page PDF is rejected with pages NULL', async () => {
    need();
    const u = await mkUser(c);
    const img = await uploaded(u.id, fx.imageOnlyPdf());
    const big = await uploaded(u.id, fx.fourPagePdf());
    await extractTask()({ resumeId: img }, helpers() as never);
    await extractTask()({ resumeId: big }, helpers() as never);
    expect(await row(img)).toMatchObject({ parse_status: 'needs_text', reject_code: null, health_passed: 0, health_total: 9 });
    expect(await row(big)).toMatchObject({ parse_status: 'rejected', reject_code: 'too_many_pages', pages: null, health_total: 0 });
  }, 60_000);

  it('a missing blob fails the row (not stuck in extracting)', async () => {
    need();
    const u = await mkUser(c);
    const id = await uploaded(u.id, fx.textPdf());
    await vault.deleteBlob(blobKeyFor(u.id, id));
    await extractTask()({ resumeId: id }, helpers() as never);
    expect(await row(id)).toMatchObject({ parse_status: 'failed', reject_code: 'blob_unreadable' });
  });

  it('purge: needs a soft delete first; then blobs of root and versions go, parsed_enc is nulled, audit row written', async () => {
    need();
    const u = await mkUser(c);
    const root = await uploaded(u.id, fx.textPdf(), { fileName: 'A_B_Resume.pdf' });
    const ver = await uploaded(u.id, fx.textPdf(), { parentId: root });
    await extractTask()({ resumeId: root }, helpers() as never);

    // A stray job for a LIVE resume must not touch it.
    await purgeTasks()['resume:purge']!({ resumeId: root }, helpers() as never);
    expect((await row(root))['purged_at']).toBeNull();
    expect(await vault.getBlob(blobKeyFor(u.id, root), fileAad(root, u.id))).toBeInstanceOf(Buffer);

    // The app role soft-deletes (it cannot hard-delete).
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE hirelane_app');
    await c.query("SELECT set_config('hirelane.user_id', $1, true)", [u.id]);
    await c.query(`UPDATE resumes SET deleted_at = now(), purge_after = now(), updated_at = now() WHERE id = $1`, [root]);
    await c.query('COMMIT');

    await purgeTasks()['resume:purge']!({ resumeId: root }, helpers() as never);
    for (const id of [root, ver]) {
      const r = await row(id);
      expect(r['parsed_enc']).toBeNull();
      expect(r['purged_at']).not.toBeNull();
      expect(r['deleted_at']).not.toBeNull();
      expect(r['purge_after']).not.toBeNull();
      expect(existsSync(join(storage, blobKeyFor(u.id, id)))).toBe(false);
    }
    const log = await c.query(`SELECT resume_id FROM file_access_log WHERE user_id = $1 AND action = 'purge'`, [u.id]);
    expect(log.rows.map((x) => x.resume_id).sort()).toEqual([root, ver].sort());

    // Running it again changes nothing.
    await purgeTasks()['resume:purge']!({ resumeId: root }, helpers() as never);
    expect((await c.query(`SELECT 1 FROM file_access_log WHERE user_id = $1 AND action = 'purge'`, [u.id])).rowCount).toBe(2);
  }, 60_000);

  it('sweep: 24 h bound holds with a far-future purge_after; a fresh delete is left to its own job', async () => {
    need();
    const u = await mkUser(c);
    const mk = async (deletedAgoH: number, purgeAfterH: number): Promise<string> => {
      const id = await uploaded(u.id, fx.textPdf());
      const now = Date.now();
      await c.query(`UPDATE resumes SET deleted_at = $2, purge_after = $3 WHERE id = $1`, [id, new Date(now - deletedAgoH * 3600_000), new Date(now + purgeAfterH * 3600_000)]);
      return id;
    };
    const overdue = await mk(2, -1); // purge_after passed
    const later = await mk(23.5, 24 * 30); // service set a 30-day grace; 23.5 h old
    const fresh = await mk(1, 24 * 30); // not due yet
    // An undelete that left purge_after behind must not be picked up (and must not clog the batch).
    const undeleted = await uploaded(u.id, fx.textPdf());
    await c.query(`UPDATE resumes SET purge_after = now() - interval '1 hour' WHERE id = $1`, [undeleted]);
    const r = await sweepResumes({ repo: repo(), vault, now: NOW }, helpers());
    expect(r.failed).toBe(0);
    expect((await row(overdue))['purged_at']).not.toBeNull();
    expect((await row(later))['purged_at']).not.toBeNull();
    expect((await row(fresh))['purged_at']).toBeNull();
    expect((await row(undeleted))['purged_at']).toBeNull();
    expect(existsSync(join(storage, blobKeyFor(u.id, later)))).toBe(false);
    expect(existsSync(join(storage, blobKeyFor(u.id, fresh)))).toBe(true);
  }, 60_000);

  describe('replacing a resume that held an Aadhaar or PAN', () => {
    it('the old original is soft-deleted and purged once a newer clean resume is parsed', async () => {
      need();
      const u = await mkUser(c);
      const old = await uploaded(u.id, aadhaarDocx(), { mime: DOCX, createdAt: new Date(Date.now() - 3600_000) });
      await extractTask()({ resumeId: old }, helpers() as never);
      expect((await row(old))['sensitive_kinds']).toContain('aadhaar');

      const fresh = await uploaded(u.id, fx.textPdf());
      const h = helpers();
      await extractTask()({ resumeId: fresh }, h as never);
      expect((await row(fresh))['parse_status']).toBe('parsed');
      expect((await row(old))['deleted_at']).not.toBeNull();
      expect(h.added).toEqual([{ id: 'resume:purge', payload: { resumeId: old }, spec: { jobKey: `resume:purge:${old}` } }]);

      await purgeTasks()['resume:purge']!({ resumeId: old }, helpers() as never);
      const r = await row(old);
      expect(r['purged_at']).not.toBeNull();
      expect(r['parsed_enc']).toBeNull();
      expect(existsSync(join(storage, blobKeyFor(u.id, old)))).toBe(false);
      expect((await row(fresh))['purged_at']).toBeNull();
    }, 60_000);

    it('never counts the root\'s own confirmed child version as its replacement (the version is not destroyed)', async () => {
      need();
      const u = await mkUser(c);
      const root = await uploaded(u.id, aadhaarDocx(), { mime: DOCX, createdAt: new Date(Date.now() - 3600_000) });
      await extractTask()({ resumeId: root }, helpers() as never);
      const child = randomUUID();
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE hirelane_app');
      await c.query("SELECT set_config('hirelane.user_id', $1, true)", [u.id]);
      await c.query(
        `INSERT INTO resumes (id, user_id, parent_id, source, mime, size_bytes, file_hmac, blob_key, parse_status, confirmed_at)
         VALUES ($1, $2, $3, 'upload', $4, 10, $5, $6, 'confirmed', now())`,
        [child, u.id, root, DOCX, `h-${child}`, blobKeyFor(u.id, child)],
      );
      await c.query('COMMIT');
      expect(await repo().supersedeSensitive(null, new Date())).toEqual([]);
      expect((await row(root))['deleted_at']).toBeNull();
      expect((await row(child))['deleted_at']).toBeNull();
    }, 60_000);

    it('is not triggered by another student, by an unparsed replacement, or by a replacement that also holds an Aadhaar', async () => {
      need();
      const u = await mkUser(c);
      const other = await mkUser(c);
      const old = await uploaded(u.id, aadhaarDocx(), { mime: DOCX, createdAt: new Date(Date.now() - 3600_000) });
      await extractTask()({ resumeId: old }, helpers() as never);
      // another student's clean resume
      const o = await uploaded(other.id, fx.textPdf());
      await extractTask()({ resumeId: o }, helpers() as never);
      // same student, but only 'uploaded' (not parsed yet)
      await uploaded(u.id, fx.textPdf());
      expect(await repo().supersedeSensitive(null, new Date())).toEqual([]);
      // same student, parsed but ALSO sensitive
      const again = await uploaded(u.id, aadhaarDocx(), { mime: DOCX });
      await extractTask()({ resumeId: again }, helpers() as never);
      expect(await repo().supersedeSensitive(null, new Date())).toEqual([]);
      expect((await row(old))['deleted_at']).toBeNull();
    }, 60_000);
  });
});

describe.skipIf(!isLocal)('retention and recovery against Postgres', () => {
  const need = () => {
    if (!available) throw new Error('Postgres test database is not available (start docker compose: db on :5433)');
  };
  const softDelete = (id: string, ageH = 30) =>
    c.query(`UPDATE resumes SET deleted_at = now() - ($2 || ' hours')::interval, purge_after = now() - ($2 || ' hours')::interval WHERE id = $1`, [id, String(ageH)]);

  it('purge nulls label, skills, file_hmac and blob_key as well as parsed_enc', async () => {
    need();
    const u = await mkUser(c);
    const id = await uploaded(u.id, fx.textPdf(), { fileName: 'a.pdf' });
    await c.query(`UPDATE resumes SET label = 'Asha Rao CV', skills = ARRAY['sql'] WHERE id = $1`, [id]);
    await softDelete(id);
    await purgeTasks()['resume:purge']!({ resumeId: id }, helpers() as never);
    const r = await row(id);
    expect(r['purged_at']).not.toBeNull();
    for (const col of ['parsed_enc', 'label', 'file_hmac', 'blob_key']) expect(r[col], col).toBeNull();
    expect(r['skills']).toEqual([]);
    expect(existsSync(join(storage, blobKeyFor(u.id, id)))).toBe(false);
  }, 60_000);

  it('a version confirmed under a root deleted after the purge tree was loaded is still purged by the sweep', async () => {
    need();
    const u = await mkUser(c);
    const root = await uploaded(u.id, fx.textPdf());
    await softDelete(root);
    await c.query(`UPDATE resumes SET purged_at = now(), parsed_enc = NULL, label = NULL, file_hmac = NULL, blob_key = NULL WHERE id = $1`, [root]);
    const late = await uploaded(u.id, fx.textPdf(), { parentId: root });
    const r = await sweepResumes({ repo: repo(), vault, now: NOW }, helpers());
    expect(r.failed).toBe(0);
    expect((await row(late))['purged_at']).not.toBeNull();
    expect(existsSync(join(storage, blobKeyFor(u.id, late)))).toBe(false);
  }, 60_000);

  it('replacing an Aadhaar original soft-deletes its versions too', async () => {
    need();
    const u = await mkUser(c);
    const old = await uploaded(u.id, aadhaarDocx(), { mime: DOCX, createdAt: new Date(Date.now() - 7200_000) });
    await extractTask()({ resumeId: old }, helpers() as never);
    const ver = await uploaded(u.id, aadhaarDocx(), { mime: DOCX, parentId: old });
    const fresh = await uploaded(u.id, fx.textPdf());
    await extractTask()({ resumeId: fresh }, helpers() as never);
    await repo().supersedeSensitive(u.id, new Date());
    expect((await row(ver))['deleted_at']).not.toBeNull();
  }, 60_000);

  it('stuck sweep: an extracting row whose worker died, and an uploaded row with no job, are re-queued; fresh ones are left alone', async () => {
    need();
    const u = await mkUser(c);
    const dead = await uploaded(u.id, fx.textPdf());
    const noJob = await uploaded(u.id, fx.textPdf());
    const fresh = await uploaded(u.id, fx.textPdf());
    const u2 = await mkUser(c);
    const freshExtracting = await uploaded(u2.id, fx.textPdf());
    const old = (m: number) => new Date(Date.now() - m * 60_000);
    await c.query(`UPDATE resumes SET parse_status = 'extracting', updated_at = $2 WHERE id = $1`, [dead, old(30)]);
    await c.query(`UPDATE resumes SET updated_at = $2 WHERE id = $1`, [noJob, old(30)]);
    await c.query(`UPDATE resumes SET parse_status = 'extracting', updated_at = now() WHERE id = $1`, [freshExtracting]);
    const h = helpers();
    const res = await sweepStuck({ repo: repo(), now: NOW }, h);
    expect(res.failed).toBe(0);
    const queued = h.added.map((a) => (a.payload as { resumeId: string }).resumeId);
    expect(queued).toContain(dead);
    expect(queued).toContain(noJob);
    expect(queued).not.toContain(fresh);
    expect(queued).not.toContain(freshExtracting);
    expect((await row(freshExtracting))['parse_status']).toBe('extracting');
    // The re-queued job now succeeds: the dead row can be claimed again.
    await extractTask()({ resumeId: dead }, helpers() as never);
    expect((await row(dead))['parse_status']).toBe('parsed');
  }, 60_000);

  it('idempotency:sweep deletes keys older than 24 h and keeps newer ones', async () => {
    need();
    const u = await mkUser(c);
    await c.query(`INSERT INTO idempotency_keys (user_id, key, response, created_at) VALUES ($1, 'old', '{"label":"x"}', now() - interval '25 hours'), ($1, 'new', '{}', now() - interval '1 hour')`, [u.id]);
    await createResumeStuckTasks({ repo: repo(), now: NOW })['idempotency:sweep']!({}, helpers() as never);
    const keys = (await c.query(`SELECT key FROM idempotency_keys WHERE user_id = $1`, [u.id])).rows.map((r) => r.key);
    expect(keys).toEqual(['new']);
  });
});
