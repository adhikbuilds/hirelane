import { describe, expect, it, vi } from 'vitest';

const quickAddJob = vi.fn(async () => ({ id: '1' }));
vi.mock('graphile-worker', () => ({ quickAddJob }));

describe('addJob', () => {
  it('forwards identifier, payload and spec to graphile-worker', async () => {
    const { addJob } = await import('../src/queue.js');
    await addJob('heartbeat', { a: 1 }, { jobKey: 'k', queueName: 'q' }, 'postgres://x@localhost/db');
    expect(quickAddJob).toHaveBeenCalledWith(
      { connectionString: 'postgres://x@localhost/db' },
      'heartbeat',
      { a: 1 },
      { jobKey: 'k', queueName: 'q' },
    );
  });

  it('fails clearly when no connection string is available', async () => {
    const { addJob } = await import('../src/queue.js');
    const saved = process.env['DATABASE_URL'];
    delete process.env['DATABASE_URL'];
    await expect(addJob('x', {}, {}, '')).rejects.toThrow(/DATABASE_URL/);
    if (saved) process.env['DATABASE_URL'] = saved;
  });
});
