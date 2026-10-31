/**
 * apply:submit against real Postgres (a throwaway database), the real executor, the real engine answers and the fixture
 * employer. Right swipe = applied, fixture only: no network is touched (fetch is spied on). Synthetic data only. 0 LLM calls.
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseCrontab } from 'graphile-worker';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations } from '@hirelane/db';
import { mkJob } from '../../../packages/db/test/apply-helpers';
import { mkUser } from '../../../packages/db/test/auth-helpers';
import { TEST_URL } from '../../../packages/db/test/helpers';
import { EnvKeyProvider, LocalBlobStore, generateMasterKey, MASTER_KEY_ENV } from '../../../packages/vault/src/index';
import { applyAnswerAad, applyEvidenceAad, applySuggestionAad, bankAad, bankKeyForLabel, createApplyRepo, inboundAad, parseApplyPayload, submitJobKey, type ApplyRepo } from '../src/tasks/apply-common';
import { answerPortFor, createApplyTasks, defaultTransport, submitApplication, toFinish, sweepApplications, type Helpers } from '../src/tasks/apply-submit';
import { addressOf as scanAddressOf } from '../src/tasks/inbound-scan';
import { createResumeVault, fileAad, type ResumeVault, type Run } from '../src/tasks/resume-common';
import { taskList } from '../src/tasks/index';
import { readFileSync } from 'node:fs';

const DBNAME = `hl_runner_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const url = new URL(TEST_URL);
let c: Client;
let admin: Client;
let storage: string;
let vault: ResumeVault;
let repo: ApplyRepo;
const NOW = new Date('2026-10-29T10:00:00Z');

beforeAll(async () => {
  admin = new Client({ connectionString: TEST_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${DBNAME}`);
  url.pathname = `/${DBNAME}`;
  c = new Client({ connectionString: url.toString() });
  await c.connect();
  await applyMigrations(c, resolve(import.meta.dirname, '../../../packages/db/migrations'));
  storage = mkdtempSync(join(tmpdir(), 'hl-apply-'));
  vault = createResumeVault(new LocalBlobStore(storage), new EnvKeyProvider({ [MASTER_KEY_ENV]: generateMasterKey() }));
  const run: Run = (fn) => fn(c as never);
  repo = createApplyRepo(run, vault);
}, 60_000);
afterAll(async () => {
  await c?.end().catch(() => undefined);
  await admin?.query(`DROP DATABASE IF EXISTS ${DBNAME} WITH (FORCE)`).catch(() => undefined);
  await admin?.end().catch(() => undefined);
  if (storage) rmSync(storage, { recursive: true, force: true });
});
beforeEach(() => vi.restoreAllMocks());

const jobs: { name: string; payload: unknown; opts?: unknown }[] = [];
const logs: string[] = [];
const helpers: Helpers = {
  logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
  addJob: async (name, payload, opts) => void jobs.push({ name, payload, opts }),
};
const deps = (over: Partial<Parameters<typeof submitApplication>[1]> = {}) => ({ repo, transport: defaultTransport(), now: () => NOW, ...over });

interface Student {
  id: string;
  email: string;
}
/** A student who is ready to apply: consent, a confirmed default resume, an eligibility profile, work status and a bank. */
async function mkStudent(o: { consent?: boolean; bank?: Record<string, string>; cap?: number; noAddress?: boolean } = {}): Promise<Student> {
  const u = await mkUser(c);
  await c.query('UPDATE users SET display_name = $2 WHERE id = $1', [u.id, 'Asha Kulkarni']);
  if (o.consent !== false) await c.query("INSERT INTO consents (user_id, kind, granted, doc_version) VALUES ($1, 'auto_apply', true, 'test')", [u.id]);
  const tag = u.id.slice(0, 8);
  if (!o.noAddress) await c.query('INSERT INTO apply_addresses (user_id, handle, domain, reply_handle, daily_cap) VALUES ($1, $2, $3, $4, $5)', [u.id, `asha.${tag}`, 'apply.example.test', tag + 'abcd1234', o.cap ?? 20]);
  await c.query("INSERT INTO eligibility_profiles (user_id, confirmed_at, degree, passout_year) VALUES ($1, now(), 'B.Tech', 2026)", [u.id]);
  const rid = randomUUID();
  const key = `resumes/${u.id}/${rid}`;
  await vault.putBlob(key, Buffer.from('%PDF-1.4 synthetic resume'), fileAad(rid, u.id));
  await c.query(
    `INSERT INTO resumes (id, user_id, source, mime, size_bytes, file_hmac, blob_key, parse_status, confirmed_at, is_default, skills, parsed_version)
     VALUES ($1, $2, 'upload', 'application/pdf', 25, $3, $4, 'confirmed', now(), true, ARRAY['python','sql'], 2)`,
    [rid, u.id, `hmac-${rid}`, key],
  );
  await c.query("INSERT INTO work_authorizations (user_id, country, status) VALUES ($1, 'IN', 'citizen')", [u.id]);
  const bank = {
    phone: '+91 90000 00000',
    linkedin: 'https://www.linkedin.com/in/asha-example',
    notice_period: '30 days',
    relocation: 'Yes',
    [bankKeyForLabel('Additional information')]: 'Available to start in July 2026.',
    ...(o.bank ?? {}),
  };
  for (const [k, v] of Object.entries(bank)) {
    const id = randomUUID();
    await c.query('INSERT INTO answer_bank (id, user_id, question_key, answer_enc) VALUES ($1, $2, $3, $4)', [id, u.id, k, await vault.sealJson(v, bankAad(u.id, id))]);
  }
  return { id: u.id, email: u.email };
}
/** The apply address of a student made by mkStudent. */
const addressOf = async (s: Student): Promise<string> => {
  // The address employers receive carries the reply tag: it is the envelope-To that inbound:scan accepts.
  const r = (await c.query('SELECT handle, domain, reply_handle FROM apply_addresses WHERE user_id = $1', [s.id])).rows[0];
  return `${r.handle}+${r.reply_handle}@${r.domain}`;
};

/** A ready application whose undo window has closed. `scenario` picks the fixture employer's behaviour. */
async function mkApp(s: Student, o: { ats?: 'greenhouse' | 'lever' | 'ashby'; scenario?: string; open?: boolean; url?: string } = {}): Promise<string> {
  const ats = o.ats ?? 'greenhouse';
  const j = await mkJob(c, { ats, applyUrl: o.url ?? `https://${ats}.fixture.invalid/${o.scenario ?? 'ok'}/job-${randomUUID().slice(0, 6)}` });
  await c.query("UPDATE jobs SET countries = '{IN}' WHERE id = $1", [j.jobId]);
  const id = randomUUID();
  await c.query('INSERT INTO applications (id, user_id, job_id) VALUES ($1, $2, $3)', [id, s.id, j.jobId]);
  if (!o.open) await c.query("UPDATE applications SET undo_until = now() - interval '1 second' WHERE id = $1", [id]);
  return id;
}
const app = async (id: string) => (await c.query('SELECT * FROM applications WHERE id = $1', [id])).rows[0];
const answersOf = async (id: string) => (await c.query('SELECT * FROM application_answers WHERE application_id = $1 ORDER BY field_id', [id])).rows;
const receiptOf = async (id: string) => (await c.query('SELECT * FROM receipts WHERE application_id = $1', [id])).rows[0];

describe('a clean fixture submit', () => {
  it('claims, answers from evidence, submits to the fixture employer, stores sealed answers and a receipt', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const s = await mkStudent();
    const id = await mkApp(s);
    expect(await submitApplication(id, deps(), helpers)).toBe('submitted');
    expect(fetchSpy).not.toHaveBeenCalled();
    const a = await app(id);
    expect(a.status).toBe('submitted');
    expect(a.submitted_at).not.toBeNull();
    expect(a.claimed_at).not.toBeNull();
    const rc = await receiptOf(id);
    expect(rc).toMatchObject({ platform: 'greenhouse', result_code: 'accepted', sent: true, http_status: 200, resume_version: 2 });
    expect(rc.answers_hash).toMatch(/^[0-9a-f]{64}$/);
    const rows = await answersOf(id);
    expect(rows.length).toBeGreaterThanOrEqual(7);
    expect(rows.every((r) => !r.needs_you && r.answer_enc && r.evidence_enc && r.evidence_sources.length > 0)).toBe(true);
    // Sealed: the plaintext is nowhere in the row, and the AAD binds the answer to its owner and row.
    const first = rows.find((r) => r.field_id === 'first_name')!;
    expect(Buffer.from(first.answer_enc).toString('utf8')).not.toContain('Asha');
    expect(await vault.openJson(first.answer_enc, applyAnswerAad(s.id, first.id))).toBe('Asha');
    expect(await vault.openJson(first.evidence_enc, applyEvidenceAad(s.id, first.id))).toEqual([{ source: 'profile', field: 'fullName' }]);
    await expect(vault.openJson(first.answer_enc, applyAnswerAad(randomUUID(), first.id))).rejects.toThrow();
    await expect(vault.openJson(first.answer_enc, applyAnswerAad(s.id, randomUUID()))).rejects.toThrow();
    const notice = rows.find((r) => r.field_id === 'question_1002')!;
    expect(await vault.openJson(notice.answer_enc, applyAnswerAad(s.id, notice.id))).toBe('30 days');
    expect(notice.evidence_sources).toEqual(['answer_bank:notice_period']);
    // The receipt hash is reproducible from what was sent, not from anything else.
    expect(logs.join('\n')).not.toMatch(/Asha|example\.test|30 days/);
  });

  it('the same application cannot be claimed or sent twice', async () => {
    const s = await mkStudent();
    const id = await mkApp(s);
    expect(await submitApplication(id, deps(), helpers)).toBe('submitted');
    expect(await submitApplication(id, deps(), helpers)).toBe('noop');
    expect((await c.query('SELECT count(*)::int AS n FROM receipts WHERE application_id = $1', [id])).rows[0].n).toBe(1);
  });

  it.each(['lever', 'ashby'] as const)('submits on %s with the real engine answers (graduation year from the confirmed profile, relocation from the bank)', async (ats) => {
    const s = await mkStudent();
    const id = await mkApp(s, { ats });
    expect(await submitApplication(id, deps(), helpers)).toBe('submitted');
    const rows = await answersOf(id);
    expect(rows.every((r) => !r.needs_you && r.evidence_sources.length > 0)).toBe(true);
    const grad = rows.find((r) => /Graduation year/i.test(r.label))!;
    expect(await vault.openJson(grad.answer_enc, applyAnswerAad(s.id, grad.id))).toBe('2026');
    expect(grad.evidence_sources).toEqual(['profile:passoutYear']);
  });

  it('a question no rule recognises is answered once under a derived bank key, and the same key serves any form that asks it', async () => {
    const key = bankKeyForLabel('Additional information');
    expect(key).toMatch(/^q:[0-9a-f]{16}$/);
    expect(bankKeyForLabel('  ADDITIONAL information: ✱ ')).toBe(key);
    expect(bankKeyForLabel('Additional information (optional)')).toBe(key);
    expect(bankKeyForLabel('Anything else?')).not.toBe(key);
    // Without the bank entry the Lever form stops on exactly that question and tells the student which key to answer.
    const s = await mkStudent({ bank: { [key]: '' } });
    await c.query('DELETE FROM answer_bank WHERE user_id = $1 AND question_key = $2', [s.id, key]);
    const id = await mkApp(s, { ats: 'lever' });
    expect(await submitApplication(id, deps(), helpers)).toBe('blocked_fallback');
    const need = (await answersOf(id)).filter((r) => r.needs_you);
    expect(need.map((r) => [r.field_id, r.question_key])).toEqual([['comments', key]]);
    // Answer it once; the next application on any platform that asks it passes.
    const bid = randomUUID();
    await c.query('INSERT INTO answer_bank (id, user_id, question_key, answer_enc) VALUES ($1, $2, $3, $4)', [bid, s.id, key, await vault.sealJson('Happy to relocate.', bankAad(s.id, bid))]);
    expect(await submitApplication(await mkApp(s, { ats: 'lever' }), deps(), helpers)).toBe('submitted');
  });

  it('the form gets the Hirelane apply address, never the student\'s own email', async () => {
    const sent: string[] = [];
    const inner = defaultTransport();
    const spy = { send: async (r: Parameters<typeof inner.send>[0]) => (r.method === 'POST' && sent.push(Buffer.from(r.body as Uint8Array).toString('utf8')), inner.send(r)) };
    for (const ats of ['greenhouse', 'lever', 'ashby'] as const) {
      const s = await mkStudent();
      const id = await mkApp(s, { ats });
      expect(await submitApplication(id, deps({ transport: spy }), helpers)).toBe('submitted');
      const body = sent.at(-1)!;
      const address = await addressOf(s);
      const esc = address.replace(/[.+]/g, '\\$&');
      expect(body, ats).toMatch(new RegExp(`name="(email|_systemfield_email)"\\r\\n\\r\\n${esc}\\r\\n`));
      const [seen] = scanAddressOf([address]);
      expect(seen, ats).toMatchObject({ tag: (await c.query('SELECT reply_handle FROM apply_addresses WHERE user_id = $1', [s.id])).rows[0].reply_handle.toLowerCase() });
      expect(body, ats).not.toContain(s.email);
      const email = (await answersOf(id)).find((r) => /email/i.test(r.label))!;
      expect(await vault.openJson(email.answer_enc, applyAnswerAad(s.id, email.id))).toBe(address);
    }
  });

  it('without an apply address nothing is sent: the email question is a Needs-you', async () => {
    const s = await mkStudent({ noAddress: true });
    const id = await mkApp(s);
    expect(await submitApplication(id, deps(), helpers)).toBe('blocked_fallback');
    expect(await app(id)).toMatchObject({ blocked_reason: 'needs_you' });
    expect((await answersOf(id)).filter((r) => r.needs_you).map((r) => r.field_id)).toContain('email');
    expect((await receiptOf(id)).sent).toBe(false);
  });
});

describe('every block is "finish on their site"', () => {
  const blockedWith = async (id: string, code: string) => {
    const a = await app(id);
    expect(a).toMatchObject({ status: 'blocked_fallback', blocked_reason: code, fallback_note: 'finish on their site' });
    expect(await receiptOf(id)).toMatchObject({ result_code: code });
  };

  it('no auto_apply consent', async () => {
    const s = await mkStudent({ consent: false });
    const id = await mkApp(s);
    expect(await submitApplication(id, deps(), helpers)).toBe('blocked_fallback');
    await blockedWith(id, 'no_consent');
    expect((await receiptOf(id)).sent).toBe(false);
  });

  it('consent withdrawn after being given: the newest row wins', async () => {
    const s = await mkStudent();
    await c.query("INSERT INTO consents (user_id, kind, granted, doc_version, at) VALUES ($1, 'auto_apply', false, 'test', now() + interval '1 second')", [s.id]);
    const id = await mkApp(s);
    expect(await submitApplication(id, deps(), helpers)).toBe('blocked_fallback');
    await blockedWith(id, 'no_consent');
  });

  it('the platform kill switch', async () => {
    const s = await mkStudent();
    const id = await mkApp(s, { ats: 'greenhouse' });
    await c.query("UPDATE platform_switches SET enabled = false, reason = 'test' WHERE platform = 'greenhouse'");
    try {
      expect(await submitApplication(id, deps(), helpers)).toBe('blocked_fallback');
      await blockedWith(id, 'platform_paused');
    } finally {
      await c.query("UPDATE platform_switches SET enabled = true, reason = NULL WHERE platform = 'greenhouse'");
    }
  });

  it('a missing switch row fails closed', async () => {
    const s = await mkStudent();
    const id = await mkApp(s, { ats: 'greenhouse' });
    await c.query("DELETE FROM platform_switches WHERE platform = 'greenhouse'");
    try {
      expect(await submitApplication(id, deps(), helpers)).toBe('blocked_fallback');
      await blockedWith(id, 'platform_paused');
    } finally {
      await c.query("INSERT INTO platform_switches (platform) VALUES ('greenhouse')");
    }
  });

  it('the daily cap counts attempts per student; the swipe over the cap waits for the next local day instead of being lost', async () => {
    const s = await mkStudent({ cap: 2 });
    const [a1, a2, a3] = [await mkApp(s), await mkApp(s), await mkApp(s)];
    expect(await submitApplication(a1, deps(), helpers)).toBe('submitted');
    expect(await submitApplication(a2, deps(), helpers)).toBe('submitted');
    jobs.length = 0;
    expect(await submitApplication(a3, deps(), helpers)).toBe('rescheduled');
    // Still a ready application: nothing sent, no receipt, no answers, undoable, and queued for tomorrow (Kolkata midnight).
    expect(await app(a3)).toMatchObject({ status: 'ready', blocked_reason: null, claimed_at: null });
    expect(await receiptOf(a3)).toBeUndefined();
    const queued = jobs.find((j) => (j.payload as { applicationId: string }).applicationId === a3)!;
    const runAt = (queued.opts as { runAt: Date }).runAt;
    expect(runAt.getTime()).toBeGreaterThan(Date.now());
    expect(runAt.getTime()).toBeLessThanOrEqual(Date.now() + 25 * 3600_000);
    expect((await app(a3)).undo_until.getTime()).toBe(runAt.getTime());
    // The sweep does not pick it up early, and the next day it goes through.
    expect((await repo.sweepable(NOW)).lostReady).not.toContain(a3);
    await c.query("UPDATE applications SET undo_until = now() - interval '1 second' WHERE id = $1", [a3]);
    await c.query("UPDATE applications SET claimed_at = claimed_at - interval '2 days' WHERE user_id = $1", [s.id]);
    expect(await submitApplication(a3, deps(), helpers)).toBe('submitted');
    // Another student is not affected.
    const other = await mkStudent({ cap: 2 });
    expect(await submitApplication(await mkApp(other), deps(), helpers)).toBe('submitted');
  });

  // Owner decision 2026-10-31 (docs/apply.md "Open before pilot" 2) replaces the earlier rule "a blocked attempt does not use up the cap".
  // A CAPTCHA, a login wall or a Needs-you answer is still an attempt on the employer's site, so it counts.
  it('a blocked attempt uses up the cap (decision 2026-10-31)', async () => {
    const s = await mkStudent({ cap: 1 });
    const blocked = await mkApp(s, { scenario: 'captcha' });
    expect(await submitApplication(blocked, deps(), helpers)).toBe('blocked_fallback');
    jobs.length = 0;
    const next = await mkApp(s);
    expect(await submitApplication(next, deps(), helpers)).toBe('rescheduled');
    expect(await app(next)).toMatchObject({ status: 'ready', claimed_at: null });
    expect(await receiptOf(next)).toBeUndefined();
  });

  it.each([
    ['a CAPTCHA on the form', { scenario: 'captcha' }],
    ['a login wall', { ats: 'lever', scenario: 'login' }],
    ['a CAPTCHA that only appears on submit', { scenario: 'captcha-submit' }],
  ] as const)('%s counts toward the cap; so does a Needs-you block', async (_n, over) => {
    const s = await mkStudent({ cap: 1 });
    expect(await submitApplication(await mkApp(s, over), deps(), helpers)).toBe('blocked_fallback');
    expect(await submitApplication(await mkApp(s), deps(), helpers)).toBe('rescheduled');
  });

  it('a Needs-you block counts toward the cap', async () => {
    const s = await mkStudent({ cap: 1 });
    await c.query("DELETE FROM answer_bank WHERE user_id = $1 AND question_key = 'notice_period'", [s.id]);
    expect(await submitApplication(await mkApp(s), deps(), helpers)).toBe('blocked_fallback');
    expect(await submitApplication(await mkApp(s), deps(), helpers)).toBe('rescheduled');
  });

  it('a re-armed application is counted when it is claimed again, not twice', async () => {
    const s = await mkStudent({ cap: 2 });
    await c.query("DELETE FROM answer_bank WHERE user_id = $1 AND question_key = 'notice_period'", [s.id]);
    const first = await mkApp(s);
    expect(await submitApplication(first, deps(), helpers)).toBe('blocked_fallback');
    const counted = async () => (await c.query("SELECT count(*)::int AS n FROM applications WHERE user_id = $1 AND status IN ('submitting','submitted','failed','blocked_fallback') AND claimed_at IS NOT NULL", [s.id])).rows[0].n;
    expect(await counted()).toBe(1);
    await c.query("UPDATE applications SET status = 'ready' WHERE id = $1", [first]); // the student's re-arm
    expect(await counted()).toBe(0);
  });

  it('a CAPTCHA on the form', async () => {
    const s = await mkStudent();
    const id = await mkApp(s, { scenario: 'captcha' });
    expect(await submitApplication(id, deps(), helpers)).toBe('blocked_fallback');
    await blockedWith(id, 'captcha');
  });

  it('a login wall and a CAPTCHA that only appears on submit', async () => {
    const s = await mkStudent();
    const login = await mkApp(s, { ats: 'lever', scenario: 'login' });
    expect(await submitApplication(login, deps(), helpers)).toBe('blocked_fallback');
    await blockedWith(login, 'login');
    const late = await mkApp(s, { scenario: 'captcha-submit' });
    expect(await submitApplication(late, deps(), helpers)).toBe('blocked_fallback');
    await blockedWith(late, 'captcha');
    expect(await receiptOf(late)).toMatchObject({ sent: true, http_status: 403 });
  });

  it('a Needs-you answer: the unanswered questions are stored for the student, no answer, no evidence', async () => {
    const s = await mkStudent({ bank: { notice_period: '' } });
    await c.query("DELETE FROM answer_bank WHERE user_id = $1 AND question_key = 'notice_period'", [s.id]);
    const id = await mkApp(s);
    expect(await submitApplication(id, deps(), helpers)).toBe('blocked_fallback');
    await blockedWith(id, 'needs_you');
    const need = (await answersOf(id)).filter((r) => r.needs_you);
    expect(need.map((r) => r.field_id)).toEqual(['question_1002']);
    expect(need[0]).toMatchObject({ answer_enc: null, evidence_enc: null, required: true, reason: expect.any(String) });
    expect((await receiptOf(id)).sent).toBe(false);
  });

  // Since 2026-10-31 the executor's apply-host allowlist is the first door, so a real host ends as host_not_allowed (it used to reach the
  // transport guard and end as live_disabled; that second door is still tested in packages/agent execute.test.ts).
  it('a real employer URL: refused by the apply-host allowlist before any transport, no request, "finish on their site"', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const s = await mkStudent();
    const id = await mkApp(s, { url: 'https://boards.greenhouse.example.com/acme/jobs/1' });
    expect(await submitApplication(id, deps(), helpers)).toBe('blocked_fallback');
    await blockedWith(id, 'host_not_allowed');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a rejected application is failed, with the status on the receipt', async () => {
    const s = await mkStudent();
    const id = await mkApp(s, { scenario: 'reject' });
    expect(await submitApplication(id, deps(), helpers)).toBe('failed');
    expect(await app(id)).toMatchObject({ status: 'failed', blocked_reason: 'http_422', fallback_note: null });
    expect(await receiptOf(id)).toMatchObject({ sent: true, http_status: 422 });
  });
});

describe('the receipt never denies a real send', () => {
  const failingOnce = (): typeof repo => {
    let first = true;
    return { ...repo, finish: async (a, w) => { if (first) { first = false; throw new Error('vault sealing failed'); } return repo.finish(a, w); } };
  };

  it('finish() throwing after a 200 records a submitted application and a receipt with sent:true, not "Could not be sent"', async () => {
    const s = await mkStudent();
    const id = await mkApp(s);
    logs.length = 0;
    expect(await submitApplication(id, deps({ repo: failingOnce() }), helpers)).toBe('submitted');
    expect(await app(id)).toMatchObject({ status: 'submitted', blocked_reason: null });
    expect(await receiptOf(id)).toMatchObject({ sent: true, http_status: 200, result_code: 'accepted_unrecorded', platform: 'greenhouse' });
    expect((await receiptOf(id)).answers_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await answersOf(id)).toHaveLength(0);
    expect(logs.join('\n')).toContain('finished after send failed');
  });

  it('finish() throwing before anything left the process still records a failure with sent:false', async () => {
    const s = await mkStudent({ consent: false });
    const id = await mkApp(s);
    expect(await submitApplication(id, deps({ repo: failingOnce() }), helpers)).toBe('blocked_fallback');
    expect(await app(id)).toMatchObject({ status: 'blocked_fallback', blocked_reason: 'no_consent' });
    expect(await receiptOf(id)).toMatchObject({ sent: false, result_code: 'no_consent' });
  });

  it('a sent attempt that ended in a block keeps its true state when finish() throws', async () => {
    const s = await mkStudent();
    const id = await mkApp(s, { scenario: 'captcha-submit' });
    expect(await submitApplication(id, deps({ repo: failingOnce() }), helpers)).toBe('blocked_fallback');
    expect(await app(id)).toMatchObject({ status: 'blocked_fallback', blocked_reason: 'captcha' });
    expect(await receiptOf(id)).toMatchObject({ sent: true, http_status: 403, result_code: 'captcha' });
  });

  // Decision 2026-10-31 (docs/apply.md "Open before pilot" 1): composed prose is never auto-submitted.
  it('a "Why this role?" box is NOT filled from the template and sent: needs_you, nothing is POSTed, the draft waits for the student', async () => {
    const s = await mkStudent();
    const id = await mkApp(s);
    const form = JSON.stringify({
      id: 1,
      title: 'Graduate Engineer',
      questions: [
        { label: 'First Name', required: true, fields: [{ name: 'first_name', type: 'input_text', values: [] }] },
        { label: 'Email', required: true, fields: [{ name: 'email', type: 'input_text', values: [] }] },
        { label: 'Why do you want this role?', required: true, fields: [{ name: 'q_why', type: 'textarea', values: [] }] },
      ],
    });
    const sent: string[] = [];
    const transport = { send: async (r: { method: string }) => (sent.push(r.method), { status: 200, headers: { 'content-type': 'application/json' }, body: form }) };
    expect(await submitApplication(id, deps({ transport }), helpers)).toBe('blocked_fallback');
    expect(sent).toEqual(['GET']);
    expect(await app(id)).toMatchObject({ status: 'blocked_fallback', blocked_reason: 'needs_you' });
    expect(await receiptOf(id)).toMatchObject({ sent: false, result_code: 'needs_you' });
    const why = (await answersOf(id)).find((a) => a.field_id === 'q_why')!;
    expect(why).toMatchObject({ needs_you: true, reason: 'confirm_draft', question_key: 'why_role', answer_enc: null });
    const draft = (await vault.openJson(why.suggestion_enc, applySuggestionAad(s.id, why.id))) as string;
    expect(draft).toMatch(/Graduate Engineer/);
    // structured facts still auto-filled
    expect((await answersOf(id)).filter((a) => !a.needs_you).map((a) => a.field_id).sort()).toEqual(['email', 'first_name']);
  });

  // Decision 2026-10-31 (docs/apply.md "Open before pilot" 1): a template draft is stored sealed, on a needs_you row, for the student to confirm.
  it('a composed free-text draft is stored sealed as a suggestion on a needs_you row, never as the answer', async () => {
    const s = await mkStudent();
    const id = await mkApp(s);
    const claim = await repo.claim(id);
    if (claim.kind !== 'claimed') throw new Error('not claimed');
    const draft = 'I am applying for the Engineer role at Acme. It fits my Intern experience at Beta, and I want to build on it.';
    const outcome = {
      state: 'blocked_fallback' as const,
      code: 'needs_you',
      message: 'finish on their site' as const,
      steps: [],
      answers: [{ fieldId: 'why', label: 'Why this role?', required: true, key: 'why_role', needsYou: true, reason: 'confirm_draft', value: null, evidence: [], suggestion: draft }],
      receipt: { answersHash: 'a'.repeat(64), resumeId: null, resumeVersion: null, platform: 'greenhouse' as const, resultCode: 'needs_you', sent: false, httpStatus: null, at: new Date() },
    };
    const write = toFinish(outcome);
    expect(write.answers[0]).toMatchObject({ needsYou: true, answer: null, suggestion: draft });
    await repo.finish(claim.app, write);
    const row = (await answersOf(id))[0]!;
    expect(row).toMatchObject({ needs_you: true, reason: 'confirm_draft', answer_enc: null, evidence_enc: null });
    expect(row.suggestion_enc.includes(Buffer.from('Engineer role'))).toBe(false);
    expect(await vault.openJson(row.suggestion_enc, applySuggestionAad(s.id, row.id))).toBe(draft);
    await expect(vault.openJson(row.suggestion_enc, applySuggestionAad(randomUUID(), row.id))).rejects.toThrow();
    expect(await app(id)).toMatchObject({ status: 'blocked_fallback', blocked_reason: 'needs_you' });
  });

  it('two answers with one field id (a form that repeats a field) do not break finish()', async () => {
    const s = await mkStudent();
    const id = await mkApp(s);
    const claim = await repo.claim(id);
    if (claim.kind !== 'claimed') throw new Error('not claimed');
    const row = { fieldId: 'dup', label: 'Phone', questionKey: 'phone', required: true, needsYou: false, reason: null, answer: '+91 90000 00000', evidence: [{ source: 'answer_bank', field: 'phone' }] };
    await repo.finish(claim.app, {
      state: 'submitted',
      reason: null,
      fallbackNote: null,
      answers: [row, { ...row, label: 'Phone (again)' }],
      receipt: { answersHash: 'a'.repeat(64), resumeId: null, resumeVersion: null, platform: 'greenhouse', resultCode: 'accepted', sent: true, httpStatus: 200 },
    });
    expect(await answersOf(id)).toHaveLength(1);
    expect(await app(id)).toMatchObject({ status: 'submitted' });
  });

  it('a re-armed application replaces the earlier blocked attempt\'s receipt and answers', async () => {
    const s = await mkStudent({ bank: { notice_period: '' } });
    await c.query("DELETE FROM answer_bank WHERE user_id = $1 AND question_key = 'notice_period'", [s.id]);
    const id = await mkApp(s);
    expect(await submitApplication(id, deps(), helpers)).toBe('blocked_fallback');
    expect((await receiptOf(id)).sent).toBe(false);
    // The student answers the question once; the application is re-armed and the next attempt goes through.
    const bid = randomUUID();
    await c.query('INSERT INTO answer_bank (id, user_id, question_key, answer_enc) VALUES ($1, $2, $3, $4)', [bid, s.id, 'notice_period', await vault.sealJson('30 days', bankAad(s.id, bid))]);
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE hirelane_app');
    await c.query("SELECT set_config('hirelane.user_id', $1, true)", [s.id]);
    await c.query("UPDATE applications SET status = 'ready' WHERE id = $1", [id]);
    await c.query('COMMIT');
    await c.query("UPDATE applications SET undo_until = now() - interval '1 second' WHERE id = $1", [id]);
    expect(await submitApplication(id, deps(), helpers)).toBe('submitted');
    expect(await receiptOf(id)).toMatchObject({ sent: true, result_code: 'accepted' });
    expect((await answersOf(id)).every((r) => !r.needs_you)).toBe(true);
  });
});

describe('answers written for one company are never reused for another', () => {
  const facts = (bank: Record<string, string>) => ({
    fullName: 'Asha Kulkarni',
    applyAddress: 'asha@apply.example.test',
    autoApply: true,
    eligibility: null,
    workAuthorizations: [],
    bank: Object.entries(bank).map(([questionKey, answer]) => ({ questionKey, answer, source: 'user' as const })),
    campusRule: null,
    countries: ['IN'],
    resumeConfirmed: true,
    skills: [],
    sensitiveKinds: [],
  });
  const claimed = { id: randomUUID(), userId: randomUUID(), platform: 'greenhouse' as const, applyUrl: 'https://greenhouse.fixture.invalid/x', resumeId: null, jobId: null, companyName: 'Acme', jobTitle: 'Engineer', attemptsToday: 1, dailyCap: 20 };

  it.each(['Cover letter', 'Anything else?', 'Anything else you would like us to know', 'Why do you want to work here?', 'Message to the hiring manager', 'Tell us about a project you are proud of'])(
    '"%s" is per application: a bank answer written for another company is not submitted',
    async (label) => {
      const key = bankKeyForLabel(label);
      const port = answerPortFor(facts({ [key]: 'Dear Company A, I love your mission.' }), claimed);
      const r = await port.resolve({ label, kind: 'textarea' });
      expect(r.status).toBe('needs_you');
      expect(r.value).toBeNull();
      expect(r.evidence).toEqual([]);
    },
  );

  it('a generic unknown label is still reused from the bank (answered once)', async () => {
    const key = bankKeyForLabel('Additional information');
    const r = await answerPortFor(facts({ [key]: 'Available to start in July 2026.' }), claimed).resolve({ label: 'Additional information', kind: 'textarea' });
    expect(r).toMatchObject({ status: 'filled', value: 'Available to start in July 2026.' });
  });
});

describe('purpose limitation: sensitive documents and answers', () => {
  it('a default resume with sensitive items (Aadhaar, PAN, DOB, caste, photo ...) is never sent: "finish on their site", no request', async () => {
    const s = await mkStudent();
    await c.query("UPDATE resumes SET sensitive_kinds = ARRAY['aadhaar', 'dob'] WHERE user_id = $1", [s.id]);
    const id = await mkApp(s);
    const sent: string[] = [];
    const transport = defaultTransport();
    expect(await submitApplication(id, deps({ transport: { send: (r) => (sent.push(r.method), transport.send(r)) } }), helpers)).toBe('blocked_fallback');
    expect(await app(id)).toMatchObject({ status: 'blocked_fallback', blocked_reason: 'sensitive_resume', fallback_note: 'finish on their site' });
    expect(await receiptOf(id)).toMatchObject({ sent: false, result_code: 'sensitive_resume' });
    expect(sent).toEqual([]);
  });

  it('a confirmed VERSION whose ROOT carries the extractor findings is still blocked (sensitive_kinds live on the root)', async () => {
    const s = await mkStudent();
    const root = (await c.query('SELECT id, blob_key FROM resumes WHERE user_id = $1', [s.id])).rows[0];
    await c.query("UPDATE resumes SET sensitive_kinds = ARRAY['pan'], is_default = false WHERE id = $1", [root.id]);
    await c.query(
      `INSERT INTO resumes (id, user_id, parent_id, source, mime, size_bytes, file_hmac, blob_key, parse_status, confirmed_at, is_default, skills, parsed_version)
       VALUES ($1, $2, $3, 'upload', 'application/pdf', 25, $4, $5, 'confirmed', now(), true, ARRAY['python'], 3)`,
      [randomUUID(), s.id, root.id, `hmac-v-${root.id}`, root.blob_key],
    );
    const id = await mkApp(s);
    const sent: string[] = [];
    const transport = defaultTransport();
    expect(await submitApplication(id, deps({ transport: { send: (r) => (sent.push(r.method), transport.send(r)) } }), helpers)).toBe('blocked_fallback');
    expect(await app(id)).toMatchObject({ status: 'blocked_fallback', blocked_reason: 'sensitive_resume' });
    expect(sent).toEqual([]);
  });

  it('a resume with no sensitive items is unaffected', async () => {
    const s = await mkStudent();
    await c.query("UPDATE resumes SET sensitive_kinds = '{}' WHERE user_id = $1", [s.id]);
    expect(await submitApplication(await mkApp(s), deps(), helpers)).toBe('submitted');
  });

  it('answer_bank rows the student marked sensitive are never filled into a form: the question becomes Needs-you', async () => {
    const s = await mkStudent();
    await c.query("UPDATE answer_bank SET sensitive = true WHERE user_id = $1 AND question_key = 'notice_period'", [s.id]);
    const id = await mkApp(s);
    expect(await submitApplication(id, deps(), helpers)).toBe('blocked_fallback');
    expect(await app(id)).toMatchObject({ blocked_reason: 'needs_you' });
    const needs = (await answersOf(id)).filter((r) => r.needs_you).map((r) => r.field_id);
    expect(needs.length).toBeGreaterThan(0);
    expect((await answersOf(id)).find((r) => r.question_key === 'notice_period')).toMatchObject({ needs_you: true, answer_enc: null });
  });
});

describe('claiming and the undo window', () => {
  it('too early: nothing is claimed and the task re-queues itself for the end of the window', async () => {
    const s = await mkStudent();
    const id = await mkApp(s, { open: true });
    jobs.length = 0;
    expect(await submitApplication(id, deps(), helpers)).toBe('rescheduled');
    expect((await app(id)).status).toBe('ready');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ name: 'apply:submit', payload: { applicationId: id }, opts: { jobKey: submitJobKey(id) } });
    const runAt = (jobs[0]!.opts as { runAt: Date }).runAt;
    expect(runAt.getTime()).toBeGreaterThan((await app(id)).undo_until.getTime());
    expect(runAt.getTime()).toBeLessThan((await app(id)).undo_until.getTime() + 1000);
  });

  it('undone: nothing is sent, ever', async () => {
    const s = await mkStudent();
    const id = await mkApp(s, { open: true });
    await c.query("UPDATE applications SET status = 'undone' WHERE id = $1", [id]);
    await c.query("UPDATE applications SET undo_until = now() - interval '1 minute' WHERE id = $1", [id]);
    expect(await submitApplication(id, deps(), helpers)).toBe('noop');
    expect((await app(id)).status).toBe('undone');
    expect(await receiptOf(id)).toBeUndefined();
  });

  it('two workers racing for one application: exactly one claims it', async () => {
    const s = await mkStudent();
    const id = await mkApp(s);
    const other = new Client({ connectionString: url.toString() });
    await other.connect();
    try {
      const repo2 = createApplyRepo((fn) => fn(other as never), vault);
      const [x, y] = await Promise.all([repo.claim(id), repo2.claim(id)]);
      expect([x.kind, y.kind].sort()).toEqual(['claimed', 'gone']);
    } finally {
      await other.end();
    }
  });

  it('an undo and a claim have one winner: a claim after the undo commits finds nothing; a claim that read the row first never claims', async () => {
    const startUndo = async (id: string, userId: string) => {
      const other = new Client({ connectionString: url.toString() });
      await other.connect();
      await other.query('BEGIN');
      await other.query('SET LOCAL ROLE hirelane_app');
      await other.query("SELECT set_config('hirelane.user_id', $1, true)", [userId]);
      const undo = await other.query("UPDATE applications SET status = 'undone' WHERE id = $1 AND status = 'ready' AND undo_until > now() RETURNING id", [id]);
      expect(undo.rowCount).toBe(1);
      return other;
    };
    const s = await mkStudent();
    // Ordering 1: the undo commits, then the claim. The row is undone, so there is nothing to claim.
    const first = await mkApp(s, { open: true });
    await c.query("UPDATE applications SET undo_until = now() + interval '1 hour' WHERE id = $1", [first]);
    const o1 = await startUndo(first, s.id);
    await o1.query('COMMIT');
    await o1.end();
    expect((await repo.claim(first)).kind).toBe('gone');
    expect((await app(first)).status).toBe('undone');
    // Ordering 2: the claim runs while the undo is still uncommitted. The window is open, so it cannot claim ('too_early'),
    // and the undo still wins.
    const second = await mkApp(s, { open: true });
    await c.query("UPDATE applications SET undo_until = now() + interval '1 hour' WHERE id = $1", [second]);
    const o2 = await startUndo(second, s.id);
    expect((await repo.claim(second)).kind).toBe('too_early');
    await o2.query('COMMIT');
    await o2.end();
    expect((await app(second)).status).toBe('undone');
    expect(await receiptOf(second)).toBeUndefined();
  });
});

describe('failure handling and the sweep', () => {
  it('an unexpected error never leaves the application in "submitting"', async () => {
    const s = await mkStudent();
    const id = await mkApp(s);
    const broken: ApplyRepo = { ...repo, studentFacts: async () => { throw new Error('boom: contains Asha'); } };
    expect(await submitApplication(id, deps({ repo: broken }), helpers)).toBe('failed');
    expect(await app(id)).toMatchObject({ status: 'failed', blocked_reason: 'internal_error' });
    expect(await receiptOf(id)).toMatchObject({ result_code: 'internal_error', sent: false });
    expect(logs.join('\n')).not.toContain('Asha');
  });

  it('the sweep re-queues lost ready applications and fails stuck ones', async () => {
    const s = await mkStudent();
    const lost = await mkApp(s);
    await c.query("UPDATE applications SET undo_until = now() - interval '10 minutes' WHERE id = $1", [lost]);
    const stuck = await mkApp(s);
    await c.query("UPDATE applications SET status = 'submitting' WHERE id = $1", [stuck]);
    await c.query("UPDATE applications SET claimed_at = now() - interval '1 hour' WHERE id = $1", [stuck]);
    const fresh = await mkApp(s, { open: true });
    jobs.length = 0;
    const r = await sweepApplications(deps({ now: () => new Date(Date.now()) }), helpers);
    expect(r.failed).toBeGreaterThanOrEqual(1);
    expect(jobs.map((j) => (j.payload as { applicationId: string }).applicationId)).toContain(lost);
    expect(jobs.map((j) => (j.payload as { applicationId: string }).applicationId)).not.toContain(fresh);
    expect(await app(stuck)).toMatchObject({ status: 'failed', blocked_reason: 'stuck' });
  });
});

describe('HIRELANE_AUTO_APPLY=off', () => {
  it('the worker claims nothing and sends nothing; the application stays ready', async () => {
    const s = await mkStudent();
    const id = await mkApp(s);
    const prev = process.env['HIRELANE_AUTO_APPLY'];
    process.env['HIRELANE_AUTO_APPLY'] = 'off';
    try {
      const tasks = createApplyTasks({ repo, now: () => NOW });
      await (tasks['apply:submit'] as (p: unknown, h: unknown) => Promise<void>)({ applicationId: id }, { logger: helpers.logger, addJob: helpers.addJob });
      await (tasks['apply:sweep'] as (p: unknown, h: unknown) => Promise<void>)({}, { logger: helpers.logger, addJob: helpers.addJob });
    } finally {
      if (prev === undefined) delete process.env['HIRELANE_AUTO_APPLY'];
      else process.env['HIRELANE_AUTO_APPLY'] = prev;
    }
    expect(await app(id)).toMatchObject({ status: 'ready', claimed_at: null });
    expect(await receiptOf(id)).toBeUndefined();
  });
});

describe('contracts', () => {
  it('payloads are exactly { applicationId }', () => {
    const id = randomUUID();
    expect(parseApplyPayload({ applicationId: id.toUpperCase() })).toBe(id);
    for (const bad of [null, {}, { applicationId: 'x' }, { applicationId: id, extra: 1 }, { id }, 'str', []]) expect(() => parseApplyPayload(bad as never), JSON.stringify(bad)).toThrow('apply task: invalid payload');
  });

  it('the AAD strings equal the services side (packages/services/src/apply/aad.ts pins the same literals)', () => {
    expect(applyAnswerAad('U', 'R')).toBe('applyans:U:R');
    expect(applyEvidenceAad('U', 'R')).toBe('applyev:U:R');
    expect(applySuggestionAad('U', 'R')).toBe('applysug:U:R');
    expect(inboundAad('U', 'R')).toBe('inbound:U:R');
    expect(bankAad('U', 'R')).toBe('answer:U:R');
  });

  it('the tasks are registered, the sweep is on the crontab, and the crontab names only real tasks', () => {
    expect(Object.keys(createApplyTasks())).toEqual(['apply:submit', 'apply:sweep']);
    expect(taskList['apply:submit']).toBeTypeOf('function');
    expect(taskList['inbound:scan']).toBeTypeOf('function');
    const items = parseCrontab(readFileSync(resolve(import.meta.dirname, '../crontab'), 'utf8'));
    expect(items.map((i) => i.task)).toContain('apply:sweep');
    for (const i of items) expect(taskList[i.task], i.task).toBeTypeOf('function');
  });

  it('answers come only from the engine: no LLM or network module is imported by the apply tasks', () => {
    for (const f of ['apply-common.ts', 'apply-submit.ts', 'inbound-scan.ts', 'inbound-mime.ts', 'inbound-classify.ts']) {
      const src = readFileSync(join(import.meta.dirname, '../src/tasks', f), 'utf8');
      expect(src, f).not.toMatch(/@anthropic-ai|openai|node:https?|\bfetch\s*\(|undici/);
    }
  });
});
