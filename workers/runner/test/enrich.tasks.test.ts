import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCrontab } from 'graphile-worker';
import { describe, expect, it, vi } from 'vitest';
import { createEnrichTasks, type EnrichDeps } from '../src/tasks/enrich.js';
import { taskList } from '../src/tasks/index.js';

function make(over: Partial<EnrichDeps> = {}) {
  const deps: EnrichDeps = {
    prepare: vi.fn(async () => {}),
    pendingCompanies: vi.fn(async () => [{ companyId: 'c1', pending: 3 }, { companyId: 'c2', pending: 1 }]),
    enrichCompany: vi.fn(async () => ({ seen: 3, enriched: 3, created: 2, attached: 1, errors: 0, errorSamples: [] })),
    enrichPosting: vi.fn(async () => 'created'),
    syncLifecycle: vi.fn(async () => ({ updated: 2, orphansDeleted: 0 })),
    ...over,
  };
  const addJob = vi.fn(async () => ({}));
  const helpers = { addJob, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
  return { deps, helpers, addJob };
}

describe('enrich:schedule', () => {
  it('prepares reference data and fans out one keyed job per company with pending postings', async () => {
    const { deps, helpers, addJob } = make();
    await createEnrichTasks(deps)['enrich:schedule']!({}, helpers as never);
    expect(deps.prepare).toHaveBeenCalledOnce();
    const calls = addJob.mock.calls as unknown as [string, Record<string, unknown>, Record<string, unknown>][];
    expect(calls.map((c) => c[0])).toEqual(['enrich:company', 'enrich:company']);
    expect(calls[0]![1]).toEqual({ companyId: 'c1' });
    expect(calls[0]![2]['jobKey']).toBe('enrich:company:c1');
  });

  it('enqueues nothing when nothing is pending, but still propagates closures to jobs', async () => {
    const { deps, helpers, addJob } = make({ pendingCompanies: vi.fn(async () => []) });
    await createEnrichTasks(deps)['enrich:schedule']!({}, helpers as never);
    expect(addJob).not.toHaveBeenCalled();
    expect(deps.syncLifecycle).toHaveBeenCalledOnce();
  });
});

describe('enrich:company', () => {
  it('enriches the company named in the payload', async () => {
    const { deps, helpers } = make();
    await createEnrichTasks(deps)['enrich:company']!({ companyId: 'c1' }, helpers as never);
    expect(deps.enrichCompany).toHaveBeenCalledWith('c1');
  });

  it('rejects an invalid payload', async () => {
    const { deps, helpers } = make();
    const t = createEnrichTasks(deps)['enrich:company']!;
    await expect(t({}, helpers as never)).rejects.toThrow(/invalid payload/);
    await expect(t({ companyId: 7 }, helpers as never)).rejects.toThrow(/invalid payload/);
  });
});

describe('enrich:posting', () => {
  it('enriches the posting named in the payload', async () => {
    const { deps, helpers } = make();
    await createEnrichTasks(deps)['enrich:posting']!({ postingId: 'p1' }, helpers as never);
    expect(deps.enrichPosting).toHaveBeenCalledWith('p1');
  });

  it('rejects an invalid payload', async () => {
    const { deps, helpers } = make();
    const t = createEnrichTasks(deps)['enrich:posting']!;
    await expect(t({}, helpers as never)).rejects.toThrow(/invalid payload/);
    await expect(t(null, helpers as never)).rejects.toThrow(/invalid payload/);
    await expect(t({ postingId: '' }, helpers as never)).rejects.toThrow(/invalid payload/);
  });
});

describe('registration', () => {
  it('registers both tasks and schedules enrich:schedule in the crontab', () => {
    expect(Object.keys(taskList)).toEqual(expect.arrayContaining(['enrich:schedule', 'enrich:company', 'enrich:posting']));
    const items = parseCrontab(readFileSync(resolve(import.meta.dirname, '../crontab'), 'utf8'));
    expect(items.map((i) => i.task)).toContain('enrich:schedule');
  });
});
