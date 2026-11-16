/**
 * `notify:sweep`: the scheduler for the notification pipeline (new drives, closes tomorrow, then the mail). One pass is
 * idempotent: rows are claimed before they are sent. Uses the worker's owner connection and the shared Mailer factory (the
 * file outbox outside production; in production the sweep fails until a real transport is wired). Logs carry counts only.
 */
import type { Task, TaskList } from 'graphile-worker';
import { EnvKeyProvider, type KeyProvider } from '../../../../packages/vault/src/index';
import type { Mailer } from '../../../../packages/agent/src/mail/mailer';
import { createMailer } from '../../../../packages/agent/src/mail/factory';
import { runNotifySweep, type NotifyDb, type NotifyDeps, type SweepResult } from '../../../../packages/services/src/notify/dispatch';
import { adminRun, type ResumeHelpers } from './resume-common';

export interface NotifyTaskOver {
  sweep?: (deps: NotifyDeps) => Promise<SweepResult>;
  db?: NotifyDb;
  mailer?: Mailer;
  keys?: KeyProvider;
  appUrl?: string;
  now?: () => Date;
}

export function createNotifyTasks(over: NotifyTaskOver = {}): TaskList {
  const task: Task = async (_payload, helpers) => {
    const sweep = over.sweep ?? runNotifySweep;
    const make = (db: NotifyDb): NotifyDeps => ({
      db,
      mailer: over.mailer ?? createMailer(),
      keys: over.keys ?? new EnvKeyProvider(),
      now: over.now ?? (() => new Date()),
      appUrl: over.appUrl ?? process.env['HIRELANE_APP_ORIGIN']?.trim() ?? 'http://localhost:3001',
    });
    const r = over.db ? await sweep(make(over.db)) : await adminRun((c) => sweep(make(c as unknown as NotifyDb)));
    (helpers as unknown as ResumeHelpers).logger.info(
      `notify:sweep newDrives ${r.newDrives.created} closing ${r.closing.created} email sent ${r.email.sent} skipped ${r.email.skipped} failed ${r.email.failed}`,
    );
  };
  return { 'notify:sweep': task };
}
