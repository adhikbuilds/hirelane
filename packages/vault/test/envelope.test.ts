import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EnvKeyProvider, hmac, open, seal, VaultError, type KeyProvider } from '../src/index.js';

const keyB64 = () => randomBytes(32).toString('base64');
const provider = (k = keyB64()) => new EnvKeyProvider({ HIRELANE_MASTER_KEY: k });

describe('EnvKeyProvider', () => {
  it('fails clearly when the key is missing, without echoing anything secret', () => {
    expect(() => new EnvKeyProvider({})).toThrow(/HIRELANE_MASTER_KEY is not set.*setup:keys/s);
    expect(() => new EnvKeyProvider({ HIRELANE_MASTER_KEY: '  ' })).toThrow(/not set/);
  });
  it('rejects a key that is not base64 of exactly 32 bytes', () => {
    const short = randomBytes(16).toString('base64');
    expect(() => new EnvKeyProvider({ HIRELANE_MASTER_KEY: short })).toThrow(/32 bytes/);
    expect(() => new EnvKeyProvider({ HIRELANE_MASTER_KEY: '!!!not base64!!!' })).toThrow(/base64/);
    try {
      new EnvKeyProvider({ HIRELANE_MASTER_KEY: short });
    } catch (e) {
      expect((e as Error).message).not.toContain(short);
    }
  });
});

describe('seal / open', () => {
  const keys = provider();
  it('round-trips bytes and strings', async () => {
    const data = Buffer.from('résumé text \u{1F600} 0123');
    const sealed = await seal(keys, data);
    expect(sealed.includes(data)).toBe(false);
    expect((await open(keys, sealed)).equals(data)).toBe(true);
  });
  it('round-trips empty and large payloads', async () => {
    for (const n of [0, 1, 5 * 1024 * 1024]) {
      const data = randomBytes(n);
      expect((await open(keys, await seal(keys, data))).equals(data)).toBe(true);
    }
  });
  it('uses a fresh DEK and IV per object (same plaintext, different ciphertext)', async () => {
    const a = await seal(keys, Buffer.from('same'));
    const b = await seal(keys, Buffer.from('same'));
    expect(a.equals(b)).toBe(false);
  });
  it('carries a versioned header', async () => {
    const sealed = await seal(keys, Buffer.from('x'));
    expect(sealed.subarray(0, 3).toString('latin1')).toBe('HLV');
    expect(sealed[3]).toBe(1);
  });
  it('fails with a different master key', async () => {
    const sealed = await seal(keys, Buffer.from('secret'));
    await expect(open(provider(), sealed)).rejects.toThrow(VaultError);
  });
  it('detects tampering in every region (header, wrapped DEK, iv, ciphertext, tag)', async () => {
    const sealed = await seal(keys, Buffer.from('tamper-me please'));
    for (const i of [0, 3, 4, 10, 30, sealed.length - 20, sealed.length - 1]) {
      const bad = Buffer.from(sealed);
      bad[i] = bad[i]! ^ 0x01;
      await expect(open(keys, bad)).rejects.toThrow(VaultError);
    }
  });
  it('rejects truncated, empty and unknown-version input', async () => {
    const sealed = await seal(keys, Buffer.from('abc'));
    await expect(open(keys, sealed.subarray(0, sealed.length - 1))).rejects.toThrow(VaultError);
    await expect(open(keys, sealed.subarray(0, 5))).rejects.toThrow(VaultError);
    await expect(open(keys, Buffer.alloc(0))).rejects.toThrow(VaultError);
    const v2 = Buffer.from(sealed);
    v2[3] = 2;
    await expect(open(keys, v2)).rejects.toThrow(/version/);
  });
  it('binds to the caller context (aad)', async () => {
    const sealed = await seal(keys, Buffer.from('bound'), { aad: 'resume:1' });
    expect((await open(keys, sealed, { aad: 'resume:1' })).toString()).toBe('bound');
    await expect(open(keys, sealed, { aad: 'resume:2' })).rejects.toThrow(VaultError);
    await expect(open(keys, sealed)).rejects.toThrow(VaultError);
  });
  it('error messages never include plaintext', async () => {
    const sealed = await seal(keys, Buffer.from('TOP-SECRET-PLAINTEXT'));
    const bad = Buffer.from(sealed);
    bad[bad.length - 1] = bad[bad.length - 1]! ^ 1;
    await open(keys, bad).catch((e: Error) => expect(e.message).not.toContain('TOP-SECRET'));
  });
  it('supports any KeyProvider (wrap/unwrap are the only contract)', async () => {
    const calls: string[] = [];
    const base = provider();
    const spy: KeyProvider = {
      keyId: base.keyId,
      wrapKey: (k, aad) => (calls.push('wrap'), base.wrapKey(k, aad)),
      unwrapKey: (w, id, aad) => (calls.push('unwrap'), base.unwrapKey(w, id, aad)),
      deriveKey: (p) => base.deriveKey(p),
    };
    await open(spy, await seal(spy, Buffer.from('z')));
    expect(calls).toEqual(['wrap', 'unwrap']);
  });
});

describe('hmac', () => {
  const keys = provider();
  it('is deterministic and hex encoded', async () => {
    const a = await hmac(keys, 'email', 'a@b.co');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hmac(keys, 'email', 'a@b.co')).toBe(a);
  });
  it('separates keys by purpose and by master key', async () => {
    const e = await hmac(keys, 'email', 'x');
    expect(await hmac(keys, 'phone', 'x')).not.toBe(e);
    expect(await hmac(provider(), 'email', 'x')).not.toBe(e);
  });
  it('rejects an empty purpose', async () => {
    await expect(hmac(keys, '', 'x')).rejects.toThrow(/purpose/);
  });
});
