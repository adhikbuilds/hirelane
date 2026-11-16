import { mkdtemp, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BlobNotFoundError, LocalBlobStore, localBlobStoreFromEnv, VaultError } from '../src/index.js';

let root: string;
let store: LocalBlobStore;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hl-vault-'));
  store = new LocalBlobStore(root);
});
afterEach(async () => rm(root, { recursive: true, force: true }));

describe('LocalBlobStore', () => {
  it('puts, gets, checks and deletes', async () => {
    await store.put('resumes/u1/r1.bin', Buffer.from('hello'));
    expect((await store.get('resumes/u1/r1.bin')).toString()).toBe('hello');
    expect(await store.exists('resumes/u1/r1.bin')).toBe(true);
    await store.delete('resumes/u1/r1.bin');
    expect(await store.exists('resumes/u1/r1.bin')).toBe(false);
    await store.delete('resumes/u1/r1.bin'); // idempotent
  });
  it('throws BlobNotFoundError for a missing key', async () => {
    await expect(store.get('nope')).rejects.toBeInstanceOf(BlobNotFoundError);
  });
  it('overwrites atomically and leaves no temp files', async () => {
    await store.put('a/b', Buffer.from('1'));
    await store.put('a/b', Buffer.from('22'));
    expect((await store.get('a/b')).toString()).toBe('22');
    expect(await readdir(join(root, 'a'))).toEqual(['b']);
  });
  it('writes private files', async () => {
    await store.put('k', Buffer.from('x'));
    expect((await stat(join(root, 'k'))).mode & 0o077).toBe(0);
  });
  it.each(['../evil', 'a/../../evil', '/abs/path', 'a//b', '', '.', '..', 'a/./b', 'a\\b', 'a\0b', '.hidden', 'a/.tmp', 'x'.repeat(600), 'a b', 'é'])(
    'rejects key %j',
    async (key) => {
      await expect(store.put(key, Buffer.from('x'))).rejects.toBeInstanceOf(VaultError);
      await expect(store.get(key)).rejects.toBeInstanceOf(VaultError);
      await expect(store.delete(key)).rejects.toBeInstanceOf(VaultError);
      await expect(store.exists(key)).rejects.toBeInstanceOf(VaultError);
    },
  );
  it('does not follow a symlink out of the root', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'hl-outside-'));
    try {
      await writeFile(join(outside, 'secret'), 'nope');
      await symlink(outside, join(root, 'link'));
      await expect(store.get('link/secret')).rejects.toBeInstanceOf(VaultError);
      await expect(store.put('link/new', Buffer.from('x'))).rejects.toBeInstanceOf(VaultError);
      await expect(store.put('link/sub/new', Buffer.from('x'))).rejects.toBeInstanceOf(VaultError);
      expect(await readdir(outside)).toEqual(['secret']); // nothing was created outside
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
  it('does not follow a symlink as the final path component', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'hl-outside-'));
    try {
      await writeFile(join(outside, 'secret'), 'nope');
      await symlink(join(outside, 'secret'), join(root, 'k'));
      await expect(store.get('k')).rejects.toBeInstanceOf(VaultError);
      await expect(store.exists('k')).rejects.toBeInstanceOf(VaultError);
      await expect(store.put('k', Buffer.from('x'))).rejects.toBeInstanceOf(VaultError);
      await expect(store.delete('k')).rejects.toBeInstanceOf(VaultError);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
  it('reads its root from HIRELANE_STORAGE_DIR', () => {
    expect(localBlobStoreFromEnv({ HIRELANE_STORAGE_DIR: root }).root).toBe(resolve(root));
  });
  it('outside production the default is <workspace root>/storage from any cwd, so web and runner share one folder', () => {
    const repo = resolve(import.meta.dirname, '../../..');
    expect(localBlobStoreFromEnv({}, resolve(repo, 'apps/web')).root).toBe(resolve(repo, 'storage'));
    expect(localBlobStoreFromEnv({}, resolve(repo, 'workers/runner')).root).toBe(resolve(repo, 'storage'));
  });
  it('in production an unset or relative HIRELANE_STORAGE_DIR fails closed', () => {
    expect(() => localBlobStoreFromEnv({ NODE_ENV: 'production' })).toThrow(VaultError);
    expect(() => localBlobStoreFromEnv({ NODE_ENV: 'production', HIRELANE_STORAGE_DIR: './storage' })).toThrow(VaultError);
    expect(localBlobStoreFromEnv({ NODE_ENV: 'production', HIRELANE_STORAGE_DIR: root }).root).toBe(resolve(root));
  });
});
