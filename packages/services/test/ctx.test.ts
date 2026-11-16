import { describe, expect, it, vi } from 'vitest';

const { withUser, addJob } = vi.hoisted(() => ({
  withUser: vi.fn(async (_id: string, fn: (c: unknown) => unknown) => fn({ query: 'client' })),
  addJob: vi.fn(async (..._args: unknown[]) => undefined),
}));
vi.mock('@hirelane/db', () => ({ withUser, addJob }));

import { createServiceCtx, ServiceError, withUserTx } from '../src/index';
import { EnvKeyProvider, LocalBlobStore, generateMasterKey } from '@hirelane/vault';

const UUID = '3f2b8c1e-6a4d-4e0b-9c57-1d2e3f405162';
const keys = new EnvKeyProvider({ HIRELANE_MASTER_KEY: generateMasterKey() });
const blobs = new LocalBlobStore('/tmp/hirelane-services-test-never-written');

describe('createServiceCtx', () => {
  it('requires a uuid user id', () => {
    expect(() => createServiceCtx({ userId: 'not-a-uuid', blobs, keys })).toThrow(ServiceError);
    expect(() => createServiceCtx({ userId: '', blobs, keys })).toThrow(ServiceError);
  });

  it('fills requestId and now, and passes blobs and keys through', () => {
    const fixed = new Date('2026-10-29T10:00:00Z');
    const ctx = createServiceCtx({ userId: UUID, blobs, keys, now: () => fixed });
    expect(ctx.userId).toBe(UUID);
    expect(ctx.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(ctx.now()).toBe(fixed);
    expect(ctx.blobs).toBe(blobs);
    expect(ctx.keys).toBe(keys);
  });

  it('keeps a caller supplied requestId', () => {
    expect(createServiceCtx({ userId: UUID, blobs, keys, requestId: 'req-abc' }).requestId).toBe('req-abc');
  });

  it('default enqueue forwards id-only payloads to the queue with the job key', async () => {
    addJob.mockClear();
    const ctx = createServiceCtx({ userId: UUID, blobs, keys });
    await ctx.enqueue('resume:extract', { resumeId: UUID }, { jobKey: `extract:${UUID}` });
    expect(addJob).toHaveBeenCalledWith('resume:extract', { resumeId: UUID }, { jobKey: `extract:${UUID}` });
  });

  it('default enqueue refuses a payload that is not ids only, and never calls the queue', async () => {
    addJob.mockClear();
    const ctx = createServiceCtx({ userId: UUID, blobs, keys });
    await expect(ctx.enqueue('resume:extract', { resumeId: 'asha@example.test' } as never)).rejects.toThrow(ServiceError);
    await expect(ctx.enqueue('resume:extract', { text: 'x' } as never)).rejects.toThrow(ServiceError);
    expect(addJob).not.toHaveBeenCalled();
  });

  it('accepts an injected enqueue (tests, and the web app)', async () => {
    const enqueue = vi.fn(async () => undefined);
    const ctx = createServiceCtx({ userId: UUID, blobs, keys, enqueue });
    await ctx.enqueue('resume:purge', { resumeId: UUID });
    expect(enqueue).toHaveBeenCalledOnce();
  });
});

describe('withUserTx', () => {
  it('runs the callback through withUser for the ctx user and returns its result', async () => {
    withUser.mockClear();
    const ctx = createServiceCtx({ userId: UUID, blobs, keys });
    const out = await withUserTx(ctx, async (c) => ({ got: c }));
    expect(out).toEqual({ got: { query: 'client' } });
    expect(withUser).toHaveBeenCalledWith(UUID, expect.any(Function));
  });

  it('propagates errors untouched', async () => {
    const ctx = createServiceCtx({ userId: UUID, blobs, keys });
    await expect(withUserTx(ctx, async () => { throw new ServiceError('conflict', 409); })).rejects.toMatchObject({ code: 'conflict', status: 409 });
  });
});
