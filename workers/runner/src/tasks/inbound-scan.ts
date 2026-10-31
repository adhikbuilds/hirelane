/**
 * `inbound:scan`: parse employer mail from a FIXTURE mailbox and hand it to the student. 0 LLM calls, no network.
 *
 * Reads `*.eml` from the inbox folder (env HIRELANE_MAIL_INBOX, default `<repo root>/.mail/inbox`, git-ignored). For each message:
 *   1. The recipient must be a student's Hirelane apply address (`handle@domain`, `handle+tag@domain` is the same address).
 *   2. It is linked to one of that student's applications by the sender's company (domain first, then name; the job title breaks ties).
 *   3. The kind is detected (interview | test | rejection | other) and the subject and an excerpt are sealed into inbound_messages.
 *   4. An in-app notification row is written, in the same transaction.
 *   5. The message is forwarded to the student's own address through the file outbox, then forwarded_at is set.
 * Idempotent: a message is stored once per student (Message-ID); a stored message that was not yet forwarded is forwarded on the next scan.
 * Mail that is not for a known apply address is skipped. Logs carry counts only: never addresses, subjects or bodies.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Task, TaskList } from 'graphile-worker';
import { createFileOutbox } from '../../../../packages/agent/src/mail/file-outbox';
import type { Mailer } from '../../../../packages/agent/src/mail/mailer';
import { authservIdFor } from '../../../../packages/agent/src/apply-mode';
import { inboundAad } from './apply-common';
import { classify, ownWords, type InboundKind } from './inbound-classify';
import { parseEml, type ParsedMail } from './inbound-mime';
import { adminRun, defaultVault, type ResumeVault, type Run } from './resume-common';

export const INBOX_DIR_ENV = 'HIRELANE_MAIL_INBOX';
const MAX_FILES = 500;
const MAX_FILE_BYTES = 1_000_000;
const EXCERPT_CHARS = 600;
const FORWARD_CHARS = 20_000;

/** `<repo root>/.mail/inbox` (git-ignored), found by walking up to pnpm-workspace.yaml. Mirrors defaultOutboxDir. */
export function defaultInboxDir(env: Record<string, string | undefined> = process.env, cwd: string = process.cwd()): string {
  if (env[INBOX_DIR_ENV]) return resolve(env[INBOX_DIR_ENV]!);
  let dir = cwd;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return join(dir, '.mail', 'inbox');
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(cwd, '.mail', 'inbox');
}

export interface Recipient {
  userId: string;
  email: string;
  /** The opaque tag that must follow "+" in the local part. A bare handle is never accepted. */
  replyHandle: string;
}
export interface CandidateApplication {
  id: string;
  companyName: string;
  companyDomain: string | null;
  jobTitle: string;
}
export interface InboundRepo {
  recipient(handle: string, domain: string): Promise<Recipient | null>;
  applications(userId: string): Promise<CandidateApplication[]>;
  /** Stores the message and its notification in one transaction. `existing` is true when this Message-ID was already stored. */
  store(m: {
    userId: string;
    applicationId: string | null;
    messageId: string;
    employer: string;
    fromDomain: string;
    kind: InboundKind;
    matchedBy: 'company' | 'domain' | 'none';
    subject: string;
    excerpt: string;
    receivedAt: Date;
  }): Promise<{ id: string; existing: boolean; forwarded: boolean }>;
  markForwarded(id: string, at: Date): Promise<void>;
}

const lowerDomain = (a: string): string => (a.split('@')[1] ?? '').toLowerCase();
const words = (s: string): string[] => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
const NOISE = new Set(['inc', 'ltd', 'llp', 'pvt', 'private', 'limited', 'labs', 'systems', 'technologies', 'solutions', 'the', 'and', 'co']);

/** The apply address a message was sent to: handle (before any +tag), the tag, and domain. */
export function addressOf(to: string[]): { handle: string; tag: string; domain: string }[] {
  const out: { handle: string; tag: string; domain: string }[] = [];
  for (const a of to) {
    const [local, domain] = a.split('@');
    if (local && domain) {
      const plus = local.indexOf('+');
      out.push({ handle: (plus === -1 ? local : local.slice(0, plus)).toLowerCase(), tag: plus === -1 ? '' : local.slice(plus + 1).toLowerCase(), domain: domain.toLowerCase() });
    }
  }
  return out;
}


/**
 * True only when OUR receiving MTA's Authentication-Results (the topmost header, authserv-id equal to the trusted id) says
 * `dmarc=pass` for a header.from aligned with the From domain. A header any other server (or the sender) wrote is ignored.
 */
export function dmarcPass(mail: Pick<ParsedMail, 'fromAddress' | 'authResults'>, authservId: string): boolean {
  const top = mail.authResults[0];
  if (!top) return false;
  const parts = top.split(';').map((x) => x.trim());
  if ((parts[0] ?? '').toLowerCase() !== authservId.toLowerCase()) return false;
  if (!parts.slice(1).some((p) => /^dmarc=pass\b/i.test(p))) return false;
  const hf = /header\.from=([^\s;]+)/i.exec(top)?.[1]?.toLowerCase();
  const from = lowerDomain(mail.fromAddress);
  return !!hf && !!from && (from === hf || from.endsWith(`.${hf}`));
}

/** Which of the student's applications the sender belongs to: domain first, then company name; the job title breaks ties. */
export function matchApplication(mail: Pick<ParsedMail, 'fromAddress' | 'fromName' | 'subject' | 'text'>, apps: CandidateApplication[]): { app: CandidateApplication; via: 'domain' | 'company' } | null {
  const dom = lowerDomain(mail.fromAddress);
  const byDomain = dom ? apps.filter((a) => a.companyDomain && (dom === a.companyDomain || dom.endsWith(`.${a.companyDomain}`))) : [];
  const sender = ` ${words(`${mail.fromName} ${mail.subject}`).join(' ')} `;
  const byName = apps.filter((a) => {
    const w = words(a.companyName).filter((x) => !NOISE.has(x));
    return w.length > 0 && sender.includes(` ${w.join(' ')} `);
  });
  const pick = (list: CandidateApplication[], via: 'domain' | 'company') => {
    if (list.length === 0) return null;
    const hay = ` ${words(`${mail.subject} ${mail.text}`).join(' ')} `;
    const titled = list.filter((a) => hay.includes(` ${words(a.jobTitle).join(' ')} `));
    return { app: (titled[0] ?? list[0])!, via };
  };
  return pick(byDomain, 'domain') ?? pick(byName, 'company');
}

const KIND_LABEL: Record<InboundKind, string> = { interview: 'interview invite', test: 'test or assessment', rejection: 'rejection', other: 'message' };
const clean = (s: string, n: number): string => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export function employerName(mail: ParsedMail, matched: CandidateApplication | null): string {
  if (matched) return clean(matched.companyName, 200);
  const fromName = clean(mail.fromName.replace(/\b(recruiting|recruitment|careers|talent|hr|jobs|hiring|team|no-?reply)\b/gi, ''), 80);
  if (fromName) return fromName;
  const label = lowerDomain(mail.fromAddress).split('.')[0] ?? '';
  return clean(label, 80) || 'Unknown sender';
}

export interface ScanDeps {
  repo: InboundRepo;
  mailer: Mailer;
  dir: string;
  now: () => Date;
  /** authserv-id of our receiving MTA (default: env HIRELANE_MAIL_AUTHSERV_ID, required in production). The MTA must also strip any inbound Authentication-Results that carries this id. */
  authservId?: string;
}
export interface ScanResult {
  scanned: number;
  stored: number;
  skipped: number;
  /** Mail without an aligned DMARC pass from our MTA: quarantined, never stored or forwarded (counted in skipped too). */
  unauthenticated: number;
  forwarded: number;
  failed: number;
  byKind: Record<InboundKind, number>;
}

export async function scanInbox(deps: ScanDeps, logger: { info(m: string): void; warn(m: string): void }): Promise<ScanResult> {
  const res: ScanResult = { scanned: 0, stored: 0, skipped: 0, unauthenticated: 0, forwarded: 0, failed: 0, byKind: { interview: 0, test: 0, rejection: 0, other: 0 } };
  if (!existsSync(deps.dir)) {
    logger.info('inbound:scan no inbox folder');
    return res;
  }
  const files = readdirSync(deps.dir).filter((f) => f.toLowerCase().endsWith('.eml')).sort().slice(0, MAX_FILES);
  const authserv = deps.authservId ?? authservIdFor();
  const move = (f: string, to: 'done' | 'quarantine') => {
    try {
      mkdirSync(join(deps.dir, to), { recursive: true });
      renameSync(join(deps.dir, f), join(deps.dir, to, f));
    } catch {
      /* a file we cannot move is retried next scan; the cap on files and the linear parser bound the cost */
    }
  };
  for (const f of files) {
    const path = join(deps.dir, f);
    res.scanned++;
    let sending = false;
    try {
      if (statSync(path).size > MAX_FILE_BYTES) {
        res.skipped++;
        move(f, 'quarantine');
        continue;
      }
      const mail = parseEml(readFileSync(path));
      // Only the envelope recipient counts, and only as handle+reply_handle@domain: the bare handle is guessable.
      let rcpt: Recipient | null = null;
      for (const a of addressOf(mail.envelopeTo)) {
        const r = await deps.repo.recipient(a.handle, a.domain);
        if (r && a.tag !== '' && a.tag === r.replyHandle.toLowerCase()) {
          rcpt = r;
          break;
        }
      }
      if (!rcpt) {
        res.skipped++;
        move(f, 'quarantine');
        continue;
      }
      if (!dmarcPass(mail, authserv)) {
        res.skipped++;
        res.unauthenticated++;
        move(f, 'quarantine');
        continue;
      }
      const m = matchApplication(mail, await deps.repo.applications(rcpt.userId));
      const kind = classify(mail.subject, mail.text);
      const employer = employerName(mail, m?.app ?? null);
      const messageId = mail.messageId ?? `sha256:${createHash('sha256').update(`${mail.fromAddress}\n${mail.subject}\n${mail.date?.toISOString() ?? ''}`).digest('hex')}`;
      const stored = await deps.repo.store({
        userId: rcpt.userId,
        applicationId: m?.app.id ?? null,
        messageId: messageId.slice(0, 500),
        employer,
        fromDomain: lowerDomain(mail.fromAddress).slice(0, 255) || 'unknown',
        kind,
        matchedBy: m?.via ?? 'none',
        subject: mail.subject,
        excerpt: ownWords(mail.text).replace(/\s+/g, ' ').trim().slice(0, EXCERPT_CHARS),
        receivedAt: mail.date ?? deps.now(),
      });
      if (!stored.existing) {
        res.stored++;
        res.byKind[kind]++;
      }
      if (!stored.forwarded) {
        sending = true;
        await deps.mailer.send({
          to: rcpt.email,
          subject: `Fwd: ${clean(mail.subject, 200) || '(no subject)'}`,
          text: [
            `A message for your application${m ? ` to ${clean(m.app.companyName, 100)}` : ''} arrived at your Hirelane apply address.`,
            `From: ${clean(mail.fromName, 100)} <${mail.fromAddress}>`,
            `Looks like: ${KIND_LABEL[kind]}`,
            '',
            mail.text.slice(0, FORWARD_CHARS),
          ].join('\n'),
        });
        await deps.repo.markForwarded(stored.id, deps.now());
        res.forwarded++;
      }
      move(f, 'done');
    } catch {
      res.failed++;
      logger.warn(`inbound:scan file ${f.slice(0, 40)} failed`);
      // A failed hand-off to the outbox stays in the inbox to be retried; anything else is a poison file: one attempt only.
      if (!sending) move(f, 'quarantine');
    }
  }
  logger.info(`inbound:scan scanned ${res.scanned} stored ${res.stored} forwarded ${res.forwarded} skipped ${res.skipped} failed ${res.failed}`);
  return res;
}

export function createInboundRepo(run: Run = adminRun, vault: ResumeVault = defaultVault()): InboundRepo {
  return {
    recipient: (handle, domain) =>
      run(async (c) => {
        const r = (
          await c.query('SELECT a.user_id, a.reply_handle, u.email FROM apply_addresses a JOIN users u ON u.id = a.user_id WHERE a.handle = $1 AND a.domain = $2', [handle, domain])
        ).rows[0];
        return r ? { userId: String(r['user_id']), email: String(r['email']), replyHandle: String(r['reply_handle']) } : null;
      }),
    applications: (userId) =>
      run(async (c) =>
        (
          await c.query("SELECT id, company_name, company_domain, job_title FROM applications WHERE user_id = $1 AND status <> 'undone' ORDER BY created_at DESC LIMIT 500", [userId])
        ).rows.map((r) => ({ id: String(r['id']), companyName: String(r['company_name']), companyDomain: r['company_domain'] ? String(r['company_domain']).toLowerCase() : null, jobTitle: String(r['job_title']) })),
      ),
    store: (m) =>
      run(async (c) => {
        const have = (await c.query('SELECT id, forwarded_at FROM inbound_messages WHERE user_id = $1 AND message_id = $2', [m.userId, m.messageId])).rows[0];
        if (have) return { id: String(have['id']), existing: true, forwarded: have['forwarded_at'] != null };
        const id = randomUUID();
        const sealed = await vault.sealJson({ subject: m.subject.slice(0, 300), excerpt: m.excerpt }, inboundAad(m.userId, id));
        await c.query('BEGIN');
        try {
          await c.query(
            `INSERT INTO inbound_messages (id, user_id, application_id, message_id, employer, from_domain, kind, matched_by, excerpt_enc, received_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [id, m.userId, m.applicationId, m.messageId, m.employer, m.fromDomain, m.kind, m.matchedBy, sealed, m.receivedAt],
          );
          await c.query("INSERT INTO notifications (user_id, kind, title, application_id, inbound_id) VALUES ($1, 'employer_message', $2, $3, $4)", [
            m.userId,
            clean(`${m.employer}: ${KIND_LABEL[m.kind]}`, 200),
            m.applicationId,
            id,
          ]);
          await c.query('COMMIT');
        } catch (e) {
          await c.query('ROLLBACK').catch(() => undefined);
          throw e;
        }
        return { id, existing: false, forwarded: false };
      }),
    markForwarded: (id, at) =>
      run(async (c) => {
        await c.query('UPDATE inbound_messages SET forwarded_at = $2 WHERE id = $1 AND forwarded_at IS NULL', [id, at]);
      }),
  };
}

export function createInboundTasks(over: Partial<ScanDeps> = {}): TaskList {
  let repo: InboundRepo | undefined;
  const scan: Task = async (_payload, helpers) => {
    await scanInbox(
      {
        repo: over.repo ?? (repo ??= createInboundRepo()),
        mailer: over.mailer ?? createFileOutbox(),
        dir: over.dir ?? defaultInboxDir(),
        now: over.now ?? (() => new Date()),
      },
      helpers.logger,
    );
  };
  return { 'inbound:scan': scan };
}
