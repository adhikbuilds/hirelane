import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { BlobNotFoundError, VaultError } from './errors.js';

/** Opaque byte storage. Callers store already sealed bytes; the store never sees keys. */
export interface BlobStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

export const STORAGE_DIR_ENV = 'HIRELANE_STORAGE_DIR';

/** Segments start with an alphanumeric, so "." / ".." / dotfiles / empty segments cannot be expressed. */
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export class LocalBlobStore implements BlobStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    if (typeof key !== 'string' || key.length === 0 || key.length > 512 || !KEY_RE.test(key)) {
      throw new VaultError('invalid blob key');
    }
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new VaultError('invalid blob key');
    return full;
  }

  /** Refuses paths whose real location escapes the root (a symlink planted under it). */
  private async assertInside(dir: string): Promise<void> {
    const realRoot = await realpath(this.root).catch(() => this.root);
    let probe = dir;
    for (;;) {
      try {
        const real = await realpath(probe);
        if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new VaultError('invalid blob key');
        return;
      } catch (e) {
        if (e instanceof VaultError) throw e;
        const parent = dirname(probe);
        if (parent === probe) return;
        probe = parent;
      }
    }
  }

  async put(key: string, data: Buffer): Promise<void> {
    const file = this.path(key);
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await this.assertInside(dirname(file));
    const tmp = join(dirname(file), `.tmp-${randomBytes(8).toString('hex')}`);
    const fh = await open(tmp, 'wx', 0o600);
    try {
      await fh.writeFile(data);
      await fh.sync();
    } catch (e) {
      await fh.close();
      await rm(tmp, { force: true });
      throw e;
    }
    await fh.close();
    try {
      await rename(tmp, file);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
  }

  async get(key: string): Promise<Buffer> {
    const file = this.path(key);
    await this.assertInside(dirname(file));
    try {
      return await readFile(file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new BlobNotFoundError();
      throw e;
    }
  }

  async exists(key: string): Promise<boolean> {
    const file = this.path(key);
    await this.assertInside(dirname(file));
    return stat(file).then(
      (s) => s.isFile(),
      () => false,
    );
  }

  async delete(key: string): Promise<void> {
    const file = this.path(key);
    await this.assertInside(dirname(file));
    await rm(file, { force: true });
  }
}

/** Root from HIRELANE_STORAGE_DIR, default ./storage (gitignored). */
export function localBlobStoreFromEnv(env: Record<string, string | undefined> = process.env): LocalBlobStore {
  return new LocalBlobStore(env[STORAGE_DIR_ENV]?.trim() || './storage');
}
