/**
 * inbound:scan against real Postgres (a throwaway database), the 60-email synthetic corpus as the fixture mailbox, and the
 * file outbox as the forwarding channel. Synthetic data only; no network; 0 LLM calls.
 */
import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyMigrations } from '@hirelane/db';
import { mkJob } from '../../../packages/db/test/apply-helpers';
import { mkUser } from '../../../packages/db/test/auth-helpers';
import { TEST_URL } from '../../../packages/db/test/helpers';
import { EnvKeyProvider, LocalBlobStore, generateMasterKey, MASTER_KEY_ENV } from '../../../packages/vault/src/index';
import { createFileOutbox } from '../../../packages/agent/src/mail/file-outbox';
import type { Mailer } from '../../../packages/agent/src/mail/mailer';
import { inboundAad } from '../src/tasks/apply-common';
import { addressOf, createInboundRepo, dmarcPass, defaultInboxDir, employerName, matchApplication, scanInbox, type CandidateApplication, type ScanDeps } from '../src/tasks/inbound-scan';
import { createResumeVault, type ResumeVault, type Run } from '../src/tasks/resume-common';

const CORPUS = join(import.meta.dirname, 'fixtures/inbound');
const LABELS = JSON.parse(readFileSync(join(CORPUS, 'labels.json'), 'utf8')) as Record<string, { kind: string; company: string; domain: string; subject: string }>;
const DBNAME = `hl_runner_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const url = new URL(TEST_URL);
let c: Client;
let admin: Client;
let storage: string;
let vault: ResumeVault;
let outbox: string;
let inbox: string;
let student: { id: string; email: string };
const apps: Record<string, string> = {};
const NOW = new Date('2026-10-29T10:00:00Z');
const logger = { info: () => undefined, warn: () => undefined };

beforeAll(async () => {
  admin = new Client({ connectionString: TEST_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${DBNAME}`);
  url.pathname = `/${DBNAME}`;
  c = new Client({ connectionString: url.toString() });
  await c.connect();
  await applyMigrations(c, resolve(import.meta.dirname, '../../../packages/db/migrations'));
  storage = mkdtempSync(join(tmpdir(), 'hl-inbound-'));
  outbox = join(storage, 'outbox');
  inbox = join(storage, 'inbox');
  cpSync(CORPUS, inbox, { recursive: true });
  vault = createResumeVault(new LocalBlobStore(join(storage, 'blobs')), new EnvKeyProvider({ [MASTER_KEY_ENV]: generateMasterKey() }));
  student = await mkUser(c);
  await c.query("INSERT INTO apply_addresses (user_id, handle, domain, reply_handle) VALUES ($1, 'asha.k3x', 'apply.hirelane.localhost', 'zz11yy22xx33')", [student.id]);
  for (const [name, slug] of [['Northwind Labs', 'northwindlabs'], ['Brightpath Systems', 'brightpathsystems'], ['Kestrel Analytics', 'kestrelanalytics']] as const) {
    const j = await mkJob(c, { org: slug });
    await c.query('UPDATE companies SET name = $2 WHERE id = $1', [j.companyId, name]);
    const id = randomUUID();
    await c.query('INSERT INTO applications (id, user_id, job_id) VALUES ($1, $2, $3)', [id, student.id, j.jobId]);
    apps[slug] = id;
  }
}, 60_000);
afterAll(async () => {
  await c?.end().catch(() => undefined);
  await admin?.query(`DROP DATABASE IF EXISTS ${DBNAME} WITH (FORCE)`).catch(() => undefined);
  await admin?.end().catch(() => undefined);
  if (storage) rmSync(storage, { recursive: true, force: true });
});

const run: Run = (fn) => fn(c as never);
const deps = (over: Partial<ScanDeps> = {}): ScanDeps => ({ repo: createInboundRepo(run, vault), mailer: createFileOutbox({ dir: outbox, env: { NODE_ENV: 'test' } }), dir: inbox, now: () => NOW, ...over });
const outboxFiles = (): string[] => (readdirSync(outbox, { withFileTypes: true }).filter((f) => f.isFile()).map((f) => f.name));

describe('scanning the corpus', () => {
  it('stores every message, detects its kind, notifies the student and forwards it through the file outbox', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const r = await scanInbox(deps(), logger);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r).toMatchObject({ scanned: 60, stored: 60, skipped: 0, forwarded: 60, failed: 0 });
    const want = { interview: 15, test: 12, rejection: 18, other: 15 };
    expect(r.byKind).toEqual(want);
    const rows = (await c.query('SELECT * FROM inbound_messages WHERE user_id = $1', [student.id])).rows;
    expect(rows).toHaveLength(60);
    expect(rows.every((m) => m.forwarded_at !== null)).toBe(true);
    const kinds = Object.fromEntries(Object.keys(want).map((k) => [k, rows.filter((m) => m.kind === k).length]));
    expect(kinds).toEqual(want);
    expect((await c.query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [student.id])).rows[0].n).toBe(60);
    expect(outboxFiles()).toHaveLength(60);
  }, 30_000);

  it('links a message to the application of the sender\'s company (by domain), and only that', async () => {
    const rows = (await c.query('SELECT message_id, application_id, matched_by, employer, from_domain FROM inbound_messages WHERE user_id = $1', [student.id])).rows;
    let linked = 0;
    for (const m of rows) {
      const slug = String(m.from_domain).replace('.example.test', '');
      if (apps[slug]) {
        expect(m.application_id, m.message_id).toBe(apps[slug]);
        expect(m.matched_by).toBe('domain');
        linked++;
      } else {
        expect(m.application_id, m.message_id).toBeNull();
        expect(m.matched_by).toBe('none');
      }
    }
    expect(linked).toBeGreaterThanOrEqual(15);
    expect(rows.find((m) => m.application_id)!.employer).toMatch(/^(Northwind Labs|Brightpath Systems|Kestrel Analytics)$/);
    expect(rows.find((m) => !m.application_id)!.employer).toMatch(/Recruiting|[A-Z]/);
  });

  it('seals the subject and excerpt: nothing readable in the row, bound to the owner and the row', async () => {
    const m = (await c.query("SELECT id, excerpt_enc FROM inbound_messages WHERE user_id = $1 AND kind = 'rejection' LIMIT 1", [student.id])).rows[0];
    expect(Buffer.from(m.excerpt_enc).toString('utf8')).not.toMatch(/Dear|Hi |application|regret|unfortunately/i);
    const opened = (await vault.openJson(m.excerpt_enc, inboundAad(student.id, m.id))) as { subject: string; excerpt: string };
    expect(opened.subject.length).toBeGreaterThan(3);
    expect(opened.excerpt.length).toBeGreaterThan(20);
    expect(opened.excerpt).not.toContain('\n');
    await expect(vault.openJson(m.excerpt_enc, inboundAad(randomUUID(), m.id))).rejects.toThrow();
  });

  it('forwards to the student\'s own address with a safe subject and the original text', () => {
    const files = outboxFiles();
    const mails = files.map((f) => readFileSync(join(outbox, f), 'utf8'));
    for (const m of mails) {
      expect(m).toContain(`To: ${student.email}`);
      expect(m).toMatch(/^Subject: Fwd: [^\r\n]+\r?$/m);
      expect(m).toContain('arrived at your Hirelane apply address');
      expect(m).toMatch(/Looks like: (interview invite|test or assessment|rejection|message)/);
    }
    expect(mails.some((m) => /Looks like: interview invite/.test(m))).toBe(true);
    // Header lines are exactly the ones the mailer wrote: no injected header can come from a subject.
    for (const m of mails) expect(m.split(/\r?\n\r?\n/)[0]!.split(/\r?\n/).every((l) => /^(From|To|Subject|Date|Message-ID|MIME-Version|Content-Type|Content-Transfer-Encoding): /.test(l))).toBe(true);
  });

  it('is idempotent: a second scan stores, notifies and forwards nothing new', async () => {
    const before = outboxFiles().length;
    expect(readdirSync(inbox).filter((f) => f.endsWith('.eml'))).toHaveLength(0); // the first scan drained the inbox
    expect(readdirSync(join(inbox, 'done'))).toHaveLength(60);
    cpSync(CORPUS, inbox, { recursive: true }); // the same Message-IDs arrive again
    const r = await scanInbox(deps(), logger);
    expect(r).toMatchObject({ scanned: 60, stored: 0, forwarded: 0, failed: 0 });
    expect(outboxFiles()).toHaveLength(before);
    expect((await c.query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1', [student.id])).rows[0].n).toBe(60);
  });
});

describe('edge cases', () => {
  it('mail for an unknown apply address, another domain, or with no recipient is skipped, not stored', async () => {
    const dir = mkdtempSync(join(storage, 'edge-'));
    const base = readFileSync(join(CORPUS, readdirSync(CORPUS).find((f) => f.endsWith('.eml'))!), 'utf8');
    writeFileSync(join(dir, 'a.eml'), base.replace(/asha\.k3x/g, 'nobody.zzz'));
    writeFileSync(join(dir, 'b.eml'), base.replace(/apply\.hirelane\.localhost/g, 'apply.other.example.test'));
    writeFileSync(join(dir, 'c.eml'), 'From: x@y.example.test\nSubject: hi\n\nno recipient');
    writeFileSync(join(dir, 'd.txt'), 'not an eml');
    const before = (await c.query('SELECT count(*)::int AS n FROM inbound_messages')).rows[0].n;
    const r = await scanInbox(deps({ dir }), logger);
    expect(r).toMatchObject({ scanned: 3, stored: 0, skipped: 3, forwarded: 0 });
    expect((await c.query('SELECT count(*)::int AS n FROM inbound_messages')).rows[0].n).toBe(before);
  });

  it('a failed forward leaves forwarded_at empty, and the next scan forwards it exactly once', async () => {
    const dir = mkdtempSync(join(storage, 'retry-'));
    const base = readFileSync(join(CORPUS, '01-interview-1.eml'), 'utf8').replace('corpus-01@', `retry-${randomUUID()}@`);
    writeFileSync(join(dir, 'r.eml'), base);
    let calls = 0;
    const flaky: Mailer = { send: async (m) => (++calls === 1 ? Promise.reject(new Error('disk full')) : createFileOutbox({ dir: outbox, env: { NODE_ENV: 'test' } }).send(m)) };
    const first = await scanInbox(deps({ dir, mailer: flaky }), logger);
    expect(first).toMatchObject({ stored: 1, forwarded: 0, failed: 1 });
    expect((await c.query('SELECT forwarded_at FROM inbound_messages WHERE message_id LIKE $1', ['retry-%'])).rows[0].forwarded_at).toBeNull();
    const second = await scanInbox(deps({ dir, mailer: flaky }), logger);
    expect(second).toMatchObject({ stored: 0, forwarded: 1, failed: 0 });
    expect((await c.query('SELECT forwarded_at FROM inbound_messages WHERE message_id LIKE $1', ['retry-%'])).rows[0].forwarded_at).not.toBeNull();
  });

  it('rejects mail without a DMARC pass, to the bare handle, or with a wrong reply tag; each goes to quarantine', async () => {
    const dir = mkdtempSync(join(storage, 'auth-'));
    const base = readFileSync(join(CORPUS, '02-interview-2.eml'), 'utf8');
    const mk = (n: string, f: (s: string) => string) => writeFileSync(join(dir, n), f(base).replace(/corpus-\d+@/, `${n}-${randomUUID()}@`));
    mk('noauth.eml', (s) => s.replace(/^Authentication-Results:.*\n/m, ''));
    mk('fail.eml', (s) => s.replace('dmarc=pass', 'dmarc=fail'));
    mk('foreign.eml', (s) => s.replace('mx.hirelane.localhost', 'attacker.test'));
    mk('bare.eml', (s) => s.replace('+zz11yy22xx33', ''));
    mk('wrongtag.eml', (s) => s.replace('zz11yy22xx33', 'aaaaaaaaaaaa'));
    mk('ccrecipient.eml', (s) => s.replace(/^To:.*$/m, 'To: someone@example.test\nCc: asha.k3x+zz11yy22xx33@apply.hirelane.localhost'));
    mk('good.eml', (s) => s);
    const before = (await c.query('SELECT count(*)::int AS n FROM inbound_messages')).rows[0].n;
    const sent = outboxFiles().length;
    const r = await scanInbox(deps({ dir }), logger);
    expect(r).toMatchObject({ scanned: 7, stored: 1, forwarded: 1, skipped: 6 });
    expect(r.unauthenticated).toBe(3);
    expect((await c.query('SELECT count(*)::int AS n FROM inbound_messages')).rows[0].n).toBe(before + 1);
    expect(outboxFiles()).toHaveLength(sent + 1);
    expect(readdirSync(join(dir, 'quarantine')).sort()).toEqual(['bare.eml', 'ccrecipient.eml', 'fail.eml', 'foreign.eml', 'noauth.eml', 'wrongtag.eml']);
    expect(readdirSync(join(dir, 'done'))).toEqual(['good.eml']);
    expect(readdirSync(dir).filter((f) => f.endsWith('.eml'))).toEqual([]);
  });

  it('a file that makes the parser throw is quarantined after one attempt, so the inbox drains', async () => {
    const dir = mkdtempSync(join(storage, 'poison-'));
    writeFileSync(join(dir, 'big.eml'), `From: a@b.example.test\n\n${'x'.repeat(1_100_000)}`);
    const r = await scanInbox(deps({ dir }), logger);
    expect(r.skipped).toBe(1);
    expect(readdirSync(join(dir, 'quarantine'))).toEqual(['big.eml']);
  });

  it('a missing inbox folder is not an error', async () => {
    expect(await scanInbox(deps({ dir: join(storage, 'nope') }), logger)).toMatchObject({ scanned: 0, stored: 0 });
  });

  it('the app role sees its own inbound rows and notifications and nobody else\'s', async () => {
    const other = await mkUser(c);
    await c.query('BEGIN');
    try {
      await c.query('SET LOCAL ROLE hirelane_app');
      await c.query("SELECT set_config('hirelane.user_id', $1, true)", [other.id]);
      expect((await c.query('SELECT count(*)::int AS n FROM inbound_messages')).rows[0].n).toBe(0);
      expect((await c.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n).toBe(0);
      await c.query("SELECT set_config('hirelane.user_id', $1, true)", [student.id]);
      expect((await c.query('SELECT count(*)::int AS n FROM inbound_messages')).rows[0].n).toBeGreaterThanOrEqual(60);
    } finally {
      await c.query('ROLLBACK');
    }
  });
});

describe('pure helpers', () => {
  const A = (id: string, name: string, domain: string | null, title = 'Software Developer'): CandidateApplication => ({ id, companyName: name, companyDomain: domain, jobTitle: title });
  const mail = (o: Partial<{ fromAddress: string; fromName: string; subject: string; text: string }>) => ({ fromAddress: 'jobs@x.example.test', fromName: '', subject: '', text: '', ...o });

  it('reads the apply address from To, ignoring +tags and case', () => {
    expect(addressOf(['Asha.K3X+greenhouse@Apply.Hirelane.Localhost', 'x@y'])).toEqual([{ handle: 'asha.k3x', tag: 'greenhouse', domain: 'apply.hirelane.localhost' }, { handle: 'x', tag: '', domain: 'y' }]);
    expect(addressOf(['no-at-sign'])).toEqual([]);
  });

  it('matches by domain first (also subdomains), then by company name, and breaks ties with the job title', () => {
    const apps = [A('1', 'Acme Labs', 'acme.example.test'), A('2', 'Acme Labs', 'acme.example.test', 'Data Analyst'), A('3', 'Zenith', null)];
    expect(matchApplication(mail({ fromAddress: 'hr@mail.acme.example.test' }), apps)).toMatchObject({ via: 'domain', app: { id: '1' } });
    expect(matchApplication(mail({ fromAddress: 'hr@acme.example.test', subject: 'Re: Data Analyst' }), apps)).toMatchObject({ via: 'domain', app: { id: '2' } });
    expect(matchApplication(mail({ fromAddress: 'noreply@ats-mail.example.test', fromName: 'Zenith Careers' }), apps)).toMatchObject({ via: 'company', app: { id: '3' } });
    expect(matchApplication(mail({ fromAddress: 'a@other.example.test', fromName: 'Someone' }), apps)).toBeNull();
    expect(matchApplication(mail({ fromAddress: 'a@notacme.example.test' }), apps)).toBeNull();
  });

  it('never matches a parent or public-suffix sender domain to a longer employer domain', () => {
    const apps = [A('1', 'Acme India', 'acme.co.in'), A('2', 'Other', 'other.co.in')];
    expect(matchApplication(mail({ fromAddress: 'x@co.in' }), apps)).toBeNull();
    expect(matchApplication(mail({ fromAddress: 'x@in' }), apps)).toBeNull();
    expect(matchApplication(mail({ fromAddress: 'x@mail.acme.co.in' }), apps)).toMatchObject({ app: { id: '1' } });
  });

  it('dmarcPass trusts only the topmost Authentication-Results of our own MTA, aligned with From', () => {
    const ok = 'mx.hirelane.localhost; spf=pass; dkim=pass header.d=a.test; dmarc=pass header.from=a.test';
    expect(dmarcPass({ fromAddress: 'x@a.test', authResults: [ok] }, 'mx.hirelane.localhost')).toBe(true);
    expect(dmarcPass({ fromAddress: 'x@mail.a.test', authResults: [ok] }, 'mx.hirelane.localhost')).toBe(true);
    expect(dmarcPass({ fromAddress: 'x@evil.test', authResults: [ok] }, 'mx.hirelane.localhost')).toBe(false);
    expect(dmarcPass({ fromAddress: 'x@a.test', authResults: [] }, 'mx.hirelane.localhost')).toBe(false);
    expect(dmarcPass({ fromAddress: 'x@a.test', authResults: [ok.replace('dmarc=pass', 'dmarc=fail')] }, 'mx.hirelane.localhost')).toBe(false);
    expect(dmarcPass({ fromAddress: 'x@a.test', authResults: [ok.replace('mx.hirelane.localhost', 'attacker.test')] }, 'mx.hirelane.localhost')).toBe(false);
    // A forged header below the MTA's own is ignored; one placed above it by the sender is not trusted either.
    expect(dmarcPass({ fromAddress: 'x@a.test', authResults: ['mx.hirelane.localhost; dmarc=fail header.from=a.test', ok] }, 'mx.hirelane.localhost')).toBe(false);
  });

  it('names the employer from the match, else the display name without role words, else the domain', () => {
    const m = (fromName: string, fromAddress: string) => ({ messageId: null, fromName, fromAddress, to: [], envelopeTo: [], authResults: [], subject: '', date: null, text: '' });
    expect(employerName(m('Kestrel Recruiting', 'a@b.example.test'), A('1', 'Matched Co', null))).toBe('Matched Co');
    expect(employerName(m('Kestrel Analytics Recruiting', 'a@b.example.test'), null)).toBe('Kestrel Analytics');
    expect(employerName(m('', 'a@initech.example.test'), null)).toBe('initech');
    expect(employerName(m('Careers Team', 'nobody'), null)).toBe('Unknown sender');
  });

  it('the inbox folder defaults to <repo>/.mail/inbox and honours HIRELANE_MAIL_INBOX', () => {
    expect(defaultInboxDir({ HIRELANE_MAIL_INBOX: '/tmp/x/in' })).toBe('/tmp/x/in');
    expect(defaultInboxDir({}, import.meta.dirname).endsWith(join('.mail', 'inbox'))).toBe(true);
  });
});
