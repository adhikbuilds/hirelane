import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCrontab } from 'graphile-worker';
import { describe, expect, it, vi } from 'vitest';
import { heartbeat } from '../src/tasks/heartbeat.js';
import { taskList } from '../src/tasks/index.js';

describe('heartbeat task', () => {
  it('inserts a worker_heartbeats row and prunes old ones', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const helpers = {
      withPgClient: async (fn: (c: { query: typeof query }) => Promise<unknown>) => fn({ query }),
    };
    await heartbeat({}, helpers as never);
    const sqls = (query.mock.calls as unknown as [string, unknown[]?][]).map((c) => c[0]);
    expect(sqls.some((s) => /INSERT INTO worker_heartbeats/i.test(s))).toBe(true);
    expect(sqls.some((s) => /DELETE FROM worker_heartbeats/i.test(s))).toBe(true);
    const insert = (query.mock.calls as unknown as [string, string[]][]).find((c) => /INSERT/i.test(c[0]));
    expect(insert?.[1]?.[0]).toMatch(/\S+:\d+/);
  });
});

describe('task list and crontab', () => {
  it('registers heartbeat', () => {
    expect(Object.keys(taskList)).toContain('heartbeat');
  });

  it('crontab schedules heartbeat every minute for a registered task', () => {
    const items = parseCrontab(readFileSync(resolve(import.meta.dirname, '../crontab'), 'utf8'));
    expect(items.map((i) => i.task)).toContain('heartbeat');
    for (const item of items) expect(Object.keys(taskList)).toContain(item.task);
  });
});
