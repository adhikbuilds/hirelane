/**
 * F1 acceptance (Slice 3): the hand-off between the web services and the runner, with nothing faked in between.
 * Real services (uploadResume, getResume, confirmResume, builder), the real runner tasks (extract with the real
 * sandboxed child process, render with pdfkit), a real LocalBlobStore and a real migrated database.
 * Also pins the sealing conventions the two sides share (AAD strings, blob key, file HMAC purpose).
 * Needs the local Postgres (docker compose, :5433). Synthetic data only.
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from '@hirelane/db';
import { verhoeffCheckDigit } from '@hirelane/engine';
import { EnvKeyProvider, LocalBlobStore, generateMasterKey, MASTER_KEY_ENV } from '../../../packages/vault/src/index';
import * as svcAad from '../../../packages/services/src/aad';
import { TEST_URL } from '../../../packages/db/test/helpers';
import { mkUser } from '../../../packages/db/test/auth-helpers';
import { blobKeyFor, createPgRepo, createResumeVault, fileAad, FILE_HMAC_PURPOSE, parsedAad } from '../src/tasks/resume-common';
import { createResumeExtractTasks } from '../src/tasks/resume-extract';
import { createResumeRenderTasks } from '../src/tasks/resume-render';
import * as fx from './fixtures/generate-resume-fixtures';

const DBNAME = `hl_f1_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const url = new URL(TEST_URL);
const isLocal = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

let c: Client;
let admin: Client | undefined;
let storage: string;
let available = false;
let svc: typeof import('../../../packages/services/src/index');
let closePool: (() => Promise<void>) | undefined;
let blobs: LocalBlobStore;
let keys: EnvKeyProvider;

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
    storage = mkdtempSync(join(tmpdir(), 'hl-f1-'));
    const master = generateMasterKey();
    process.env['DATABASE_URL'] = url.toString();
    process.env[MASTER_KEY_ENV] = master;
    blobs = new LocalBlobStore(storage);
    keys = new EnvKeyProvider({ [MASTER_KEY_ENV]: master });
    svc = await import('../../../packages/services/src/index');
    closePool = (await import('@hirelane/db')).close;
    available = true;
  } catch {
    available = false;
  }
}, 60_000);

afterAll(async () => {
  await closePool?.().catch(() => undefined);
  await c?.end().catch(() => undefined);
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS ${DBNAME} WITH (FORCE)`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
  if (storage) rmSync(storage, { recursive: true, force: true });
});

const need = () => {
  if (!available) throw new Error('Postgres test database is not available (start docker compose: db on :5433)');
};
const logger = { info: () => {}, warn: () => {}, error: () => {} };
const helpers = () => ({ logger, job: { attempts: 1, max_attempts: 25 }, added: [] as unknown[], async addJob() {} });
const repo = () => createPgRepo((fn) => fn(c as never));
const runnerVault = () => createResumeVault(blobs, keys);
const extractTask = () => createResumeExtractTasks({ repo: repo(), vault: runnerVault(), now: () => new Date() })['resume:extract']!;
const renderTask = () => createResumeRenderTasks({ repo: repo(), vault: runnerVault(), now: () => new Date() })['resume:render']!;
const ctxFor = (userId: string) => svc.createServiceCtx({ userId, blobs, keys, enqueue: async () => undefined });

const base = '23456789012';
const AADHAAR = `${base}${verhoeffCheckDigit(base)}`;
const SPACED = `${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)} ${AADHAAR.slice(8)}`;
const aadhaarDocx = () =>
  fx.docxFromDocumentXml(
    fx.docXml(['Asha Example', 'asha.example@example.test 90000 00001', `Aadhaar: ${SPACED}`, 'Education', 'B.Tech Computer Science, Example Institute of Technology, 8.2 CGPA, 2026', 'Skills', 'Python, SQL, Git']),
  );

describe('sealing conventions shared by services and the runner', () => {
  it('produce identical AAD strings, blob keys and HMAC purpose', () => {
    const u = randomUUID();
    const id = randomUUID();
    expect(svcAad.parsedAad(u, id)).toBe(parsedAad(id, u));
    expect(svcAad.resumeBlobAad(u, id)).toBe(fileAad(id, u));
    expect(svcAad.blobKeyFor(u, id)).toBe(blobKeyFor(u, id));
    expect(svcAad.FILE_HMAC_PURPOSE).toBe(FILE_HMAC_PURPOSE);
    expect(svcAad.blobIdFromKey(u, blobKeyFor(u, id))).toBe(id);
  });
});

describe.skipIf(!isLocal)('F1: upload -> extract -> read -> confirm', () => {
  it('a real Aadhaar DOCX: masked text, kind flagged, confirm writes the version and the eligibility profile', async () => {
    need();
    const u = await mkUser(c);
    const ctx = ctxFor(u.id);
    const { id } = await svc.uploadResume(ctx, { mime: DOCX, fileName: 'Asha_Example_Resume.docx', label: 'Main' }, Buffer.from(aadhaarDocx()));

    await extractTask()({ resumeId: id }, helpers() as never);

    const view = await svc.getResume(ctx, { id });
    expect(view.parseStatus).toBe('parsed');
    expect(view.sensitiveKinds).toContain('aadhaar');
    expect(view.parsed).not.toBeNull();
    expect(view.parsed!.text).toContain('XXXX XXXX XXXX');
    expect(view.parsed!.text).not.toContain(SPACED);
    expect(view.parsed!.text).not.toContain(AADHAAR);
    expect(JSON.stringify(view)).not.toContain(AADHAAR);

    const conf = await svc.confirmResume(ctx, {
      id,
      parsedVersion: view.parsedVersion,
      skills: ['python', 'sql'],
      eligibility: { pct_10: 88, grad_score: 8.2, grad_scale: 10, passout_year: 2026, degree: 'B.Tech' },
      // A lying client: it claims the typed value came from the resume. The server decides provenance.
      fieldMeta: { pct_10: { source: 'resume', confidence: 'high' } },
    });
    expect(conf.parseStatus).toBe('confirmed');
    expect(conf.isDefault).toBe(true);

    const elig = (await c.query('SELECT pct_10, grad_score, passout_year, field_meta, source_resume_id FROM eligibility_profiles WHERE user_id = $1', [u.id])).rows[0];
    expect(Number(elig.pct_10)).toBe(88);
    expect(Number(elig.grad_score)).toBe(8.2);
    expect(elig.source_resume_id).toBe(conf.id);
    // The parser found no 10th percentage, so 88 is the student's own number whatever the client said.
    expect(elig.field_meta.pct_10).toEqual({ source: 'user', confidence: 'high' });
    expect(elig.field_meta.grad_score.source).toBe('resume');
  }, 90_000);

  it('an image-only PDF stops at needs_text and cannot be confirmed', async () => {
    need();
    const u = await mkUser(c);
    const ctx = ctxFor(u.id);
    const { id } = await svc.uploadResume(ctx, { mime: 'application/pdf', fileName: 'scan.pdf' }, Buffer.from(fx.imageOnlyPdf()));
    await extractTask()({ resumeId: id }, helpers() as never);
    const view = await svc.getResume(ctx, { id });
    expect(view.parseStatus).toBe('needs_text');
    await expect(svc.confirmResume(ctx, { id, parsedVersion: view.parsedVersion, eligibility: {} })).rejects.toMatchObject({ code: 'not_confirmable' });
  }, 90_000);

  it('the guided builder: steps -> finish -> render -> extract -> parsed and readable by the service', async () => {
    need();
    const u = await mkUser(c);
    const ctx = ctxFor(u.id);
    let st = await svc.saveBuilderStep(ctx, { step: 'contact', data: { name: 'Asha Example', email: 'asha.example@example.test', phone: '90000 00001' } });
    const draftId = st.draftId;
    st = await svc.saveBuilderStep(ctx, { draftId, step: 'education', data: { education: [{ qualification: 'B.Tech Computer Science', institution: 'Example Institute of Technology', year: '2026', score: 'CGPA 8.2/10' }] } });
    st = await svc.saveBuilderStep(ctx, { draftId, step: 'skills', data: { skills: ['Python', 'SQL', 'Git'] } });
    st = await svc.saveBuilderStep(ctx, { draftId, step: 'projects', data: { projects: [{ title: 'Library tracker', link: 'https://github.com/asha-example/library', bullets: ['Built a REST API serving 1200 books', 'Cut latency by 40% with an index'] }] } });
    expect(st.missing).toEqual([]);
    await svc.finishBuilder(ctx, { draftId });

    await renderTask()({ resumeId: draftId }, helpers() as never);
    await extractTask()({ resumeId: draftId }, helpers() as never);

    const view = await svc.getResume(ctx, { id: draftId });
    expect(view.parseStatus).toBe('parsed');
    expect(view.source).toBe('builder');
    expect(view.parsed?.text).toContain('Asha Example');
  }, 90_000);
});
