import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseCrontab } from 'graphile-worker';
import { describe, expect, it, vi } from 'vitest';
import { createResumePurgeTasks, purgeResume, sweepResumes } from '../src/tasks/resume-purge';
import { PURGE_BOUND_HOURS, SWEEP_PICKUP_HOURS, type PurgeTarget, type ResumeRepo, type ResumeVault } from '../src/tasks/resume-common';
import { taskList } from '../src/tasks/index';

const NOW = new Date('2026-10-29T10:00:00Z');
const helpers = () => {
  const logs: string[] = [];
  return { logs, h: { logger: { info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), error: (m: string) => logs.push(m) }, addJob: vi.fn(async () => {}) } };
};

function fake(targets: PurgeTarget[] = [], due: string[] = [], superseded: string[] = []) {
  const events: string[] = [];
  const repo = {
    loadPurgeTree: vi.fn(async () => targets),
    completePurge: vi.fn(async () => void events.push('rows')),
    dueForPurge: vi.fn(async (_n: Date, _l: number, exclude: string[]) => due.filter((id) => !exclude.includes(id))),
    supersedeSensitive: vi.fn(async () => superseded),
  } as unknown as ResumeRepo;
  const vault = { deleteBlob: vi.fn(async (k: string) => void events.push(`blob:${k}`)) } as unknown as ResumeVault;
  return { repo, vault, events };
}
const target = (blobKey: string | null = `resumes/u/${randomUUID()}`): PurgeTarget => ({ id: randomUUID(), userId: randomUUID(), blobKey });

describe('purgeResume', () => {
  it('deletes EVERY blob (root and versions) first, and only then marks the rows', async () => {
    const ts = [target('resumes/u/a'), target('resumes/u/b'), target(null)];
    const f = fake(ts);
    const { h } = helpers();
    expect(await purgeResume(ts[0]!.id, { ...f, now: () => NOW }, h)).toBe('purged');
    expect(f.events).toEqual(['blob:resumes/u/a', 'blob:resumes/u/b', 'rows']);
    expect(f.repo.completePurge).toHaveBeenCalledWith(ts, NOW);
  });

  it('is a no-op when the resume is not deleted or already purged (empty tree)', async () => {
    const f = fake([]);
    expect(await purgeResume(randomUUID(), { ...f, now: () => NOW }, helpers().h)).toBe('noop');
    expect(f.vault.deleteBlob).not.toHaveBeenCalled();
    expect(f.repo.completePurge).not.toHaveBeenCalled();
  });

  it('keeps the rows unpurged when a blob delete fails, so the retry still finds the keys', async () => {
    const ts = [target('resumes/u/a'), target('resumes/u/b')];
    const f = fake(ts);
    (f.vault.deleteBlob as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('disk Asha'));
    const { h, logs } = helpers();
    await expect(purgeResume(ts[0]!.id, { ...f, now: () => NOW }, h)).rejects.toThrow(/^resume:purge failed$/);
    expect(f.repo.completePurge).not.toHaveBeenCalled();
    expect(logs.join('\n')).not.toContain('Asha');
  });
});

describe('resume:purge task', () => {
  it('takes an id-only payload', async () => {
    const f = fake([target()]);
    const t = createResumePurgeTasks({ ...f, now: () => NOW });
    await expect(t['resume:purge']!({ resumeId: 'x' }, helpers().h as never)).rejects.toThrow(/invalid payload/);
    await expect(t['resume:purge']!({ resumeId: randomUUID(), blobKey: 'k' }, helpers().h as never)).rejects.toThrow(/invalid payload/);
    await t['resume:purge']!({ resumeId: randomUUID() }, helpers().h as never);
    expect(f.repo.completePurge).toHaveBeenCalledTimes(1);
  });
});

describe('resume:purge-sweep', () => {
  it('soft-deletes superseded Aadhaar/PAN originals first, then purges every due id', async () => {
    const ids = [randomUUID(), randomUUID()];
    const f = fake([target()], ids, [randomUUID()]);
    const { h } = helpers();
    const r = await sweepResumes({ ...f, now: () => NOW }, h);
    expect(f.repo.supersedeSensitive).toHaveBeenCalledWith(null, NOW);
    expect(r).toEqual({ purged: 2, failed: 0 });
    expect(f.repo.loadPurgeTree).toHaveBeenCalledTimes(2);
  });

  it('keeps going after one failure and then fails the job so it is visible', async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const f = fake([target()], ids);
    (f.repo.loadPurgeTree as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('x'));
    const t = createResumePurgeTasks({ ...f, now: () => NOW });
    await expect(t['resume:purge-sweep']!({}, helpers().h as never)).rejects.toThrow(/^resume:purge-sweep failed: 1 of 3$/);
    expect(f.repo.loadPurgeTree).toHaveBeenCalledTimes(3);
  });

  it('does not loop forever on an id that keeps failing', async () => {
    const id = randomUUID();
    const f = fake([target()], [id]);
    (f.repo.loadPurgeTree as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('x'));
    const r = await sweepResumes({ ...f, now: () => NOW }, helpers().h);
    expect(r.failed).toBe(1);
  });

  it('pages past a full batch of failing ids to reach later due rows (no starvation)', async () => {
    const failing: string[] = Array.from({ length: 200 }, () => randomUUID());
    const good = randomUUID();
    const f = fake([target()]);
    (f.repo.dueForPurge as ReturnType<typeof vi.fn>).mockImplementation(async (_n: Date, limit: number, exclude: string[]) =>
      [...failing, good].filter((id) => !exclude.includes(id)).slice(0, limit),
    );
    (f.repo.loadPurgeTree as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => {
      if (failing.includes(id)) throw new Error('x');
      return [target()];
    });
    const r = await sweepResumes({ ...f, now: () => NOW }, helpers().h);
    expect(r).toEqual({ purged: 1, failed: 200 });
  });
});

describe('24 h bound (PRD R8)', () => {
  const items = parseCrontab(readFileSync(resolve(import.meta.dirname, '../crontab'), 'utf8')).filter((i) => i.task === 'resume:purge-sweep');

  /** First time at or after `from` (UTC minute resolution) when the sweep fires. */
  const nextSweep = (from: Date): Date => {
    const t = new Date(Math.ceil(from.getTime() / 60_000) * 60_000);
    for (let i = 0; i < 3 * 24 * 60; i++, t.setUTCMinutes(t.getUTCMinutes() + 1)) {
      const digest = { min: t.getUTCMinutes(), hour: t.getUTCHours(), date: t.getUTCDate(), month: t.getUTCMonth() + 1, dow: t.getUTCDay() };
      if (items.some((it) => it.match(digest))) return new Date(t);
    }
    throw new Error('no sweep within 3 days');
  };

  it('the sweep is registered and scheduled', () => {
    expect(items.length).toBeGreaterThan(0);
    expect(Object.keys(taskList)).toEqual(expect.arrayContaining(['resume:extract', 'resume:render', 'resume:purge', 'resume:purge-sweep']));
  });

  it('a sweep fires at least once in every window shorter than the pickup margin', () => {
    // Worst case: deleted just after a sweep. The gap to the next sweep must leave the row picked up before 24 h.
    let worst = 0;
    for (let m = 0; m < 24 * 60; m += 7) {
      const del = new Date(NOW.getTime() + m * 60_000);
      const next = nextSweep(new Date(del.getTime() + 1));
      worst = Math.max(worst, next.getTime() - del.getTime());
    }
    expect(worst).toBeLessThanOrEqual(60 * 60_000 + 60_000);
    expect(SWEEP_PICKUP_HOURS * 3600_000 + worst).toBeLessThanOrEqual(PURGE_BOUND_HOURS * 3600_000 + 60_000);
  });

  it('worst case with injected clock: the immediate job fails, purge_after is set 30 days out, the sweep still purges within 24 h', () => {
    // Mirrors dueForPurge's cutoff: a row is due once deleted_at <= now - SWEEP_PICKUP_HOURS.
    const deletedAt = new Date('2026-10-29T10:01:00Z');
    const isDue = (now: Date, purgeAfter: Date) => purgeAfter <= now || deletedAt.getTime() <= now.getTime() - SWEEP_PICKUP_HOURS * 3600_000;
    const purgeAfter = new Date(deletedAt.getTime() + 30 * 24 * 3600_000);
    let clock = new Date(deletedAt);
    let purgedAt: Date | null = null;
    for (let i = 0; i < 48 && !purgedAt; i++) {
      clock = nextSweep(new Date(clock.getTime() + 1));
      if (isDue(clock, purgeAfter)) purgedAt = clock;
    }
    expect(purgedAt).not.toBeNull();
    expect(purgedAt!.getTime() - deletedAt.getTime()).toBeLessThanOrEqual(PURGE_BOUND_HOURS * 3600_000);
  });
});
