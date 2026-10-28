import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { assertHeaderValue, assertMailbox, type Mailer, type MailMessage } from './mailer.js';

export const OUTBOX_DIR_ENV = 'HIRELANE_MAIL_OUTBOX';

/** `<repo root>/.mail/outbox` (git-ignored), found by walking up to pnpm-workspace.yaml. */
export function defaultOutboxDir(env: Record<string, string | undefined> = process.env, cwd: string = process.cwd()): string {
  if (env[OUTBOX_DIR_ENV]) return resolve(env[OUTBOX_DIR_ENV]!);
  let dir = cwd;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return join(dir, '.mail', 'outbox');
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(cwd, '.mail', 'outbox');
}

/**
 * Development and test mailer: each message becomes `<timestamp>-<id>.eml` in a private folder.
 * It never writes to stdout or stderr (an address or code must not reach a log) and refuses to run in production.
 */
export function createFileOutbox(opts: { dir?: string; env?: Record<string, string | undefined>; from?: string } = {}): Mailer {
  const env = opts.env ?? process.env;
  return {
    async send(message: MailMessage): Promise<{ id: string }> {
      if (env['NODE_ENV'] === 'production') throw new Error('mail: the file outbox is disabled in production');
      assertMailbox(message.to);
      assertHeaderValue('subject', message.subject);
      const from = opts.from ?? 'Hirelane <no-reply@hirelane.localhost>';
      assertHeaderValue('from', from);
      const id = randomUUID();
      const dir = opts.dir ?? defaultOutboxDir(env);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const body = message.text.replace(/\r?\n/g, '\r\n');
      const eml = [
        `From: ${from}`,
        `To: ${message.to}`,
        `Subject: ${message.subject}`,
        `Date: ${new Date().toUTCString()}`,
        `Message-ID: <${id}@hirelane.localhost>`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        body,
      ].join('\r\n');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await writeFile(join(dir, `${stamp}-${id}.eml`), eml, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      return { id };
    },
  };
}
