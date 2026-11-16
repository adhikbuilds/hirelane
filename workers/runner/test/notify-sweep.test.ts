import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCrontab } from 'graphile-worker';
import { describe, expect, it, vi } from 'vitest';
import { createNotifyTasks } from '../src/tasks/notify-sweep';
import { taskList } from '../src/tasks/index';

const helpers = () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }) as never;

describe('notify:sweep', () => {
  it('runs one sweep with the owner connection, the shared mailer and the app origin, and logs counts only', async () => {
    const sweep = vi.fn(async () => ({ newDrives: { drives: 2, created: 5 }, closing: { drives: 1, created: 3 }, email: { sent: 4, skipped: 1, failed: 0 } }));
    const db = { query: vi.fn() };
    const mailer = { send: vi.fn() };
    const h = helpers();
    await createNotifyTasks({ sweep: sweep as never, db: db as never, mailer, keys: {} as never, appUrl: 'https://app.example.test', now: () => new Date('2026-11-01T00:00:00Z') })['notify:sweep']!({}, h);
    expect(sweep).toHaveBeenCalledOnce();
    const deps = (sweep.mock.calls[0] as unknown[])[0] as { db: unknown; mailer: unknown; appUrl: string };
    expect(deps).toMatchObject({ db, mailer, appUrl: 'https://app.example.test' });
    const logged = JSON.stringify((h as { logger: { info: { mock: { calls: unknown[] } } } }).logger.info.mock.calls);
    expect(logged).toMatch(/newDrives 5|created 5/);
  });

  it('is registered and on the crontab', () => {
    expect(taskList['notify:sweep']).toBeTypeOf('function');
    const tasks = parseCrontab(readFileSync(resolve(import.meta.dirname, '../crontab'), 'utf8')).map((i) => i.task);
    expect(tasks).toContain('notify:sweep');
  });
});
