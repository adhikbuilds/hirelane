import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { VaultError } from './errors.js';
import type { KeyProvider } from './keys.js';

/**
 * Sealed object layout (all integers big endian):
 *   "HLV" | version(1) | keyIdLen(1) | keyId | wrappedLen(2) | wrappedDek | iv(12) | ciphertext | tag(16)
 * Everything before the iv, plus the caller's optional context string, is authenticated as AAD, so
 * a flipped header byte or a blob moved to another owner fails to open.
 */
const MAGIC = Buffer.from('HLV', 'latin1');
const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface SealOptions {
  /** Binds the object to its owner (for example `resume:<id>`). Must be passed again to open. */
  aad?: string;
}

function aadFor(header: Buffer, ctx: string | undefined): Buffer {
  return Buffer.concat([header, Buffer.from(ctx ?? '', 'utf8')]);
}

export async function seal(keys: KeyProvider, plaintext: Buffer, opts: SealOptions = {}): Promise<Buffer> {
  const dek = randomBytes(32);
  const keyId = Buffer.from(keys.keyId, 'utf8');
  if (keyId.length > 255) throw new VaultError('key id too long');
  // The wrapped DEK is bound to the key id and the caller context, not to its own length prefix.
  const wrapped = await keys.wrapKey(dek, aadFor(Buffer.concat([MAGIC, Buffer.from([VERSION]), keyId]), opts.aad));
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(wrapped.length);
  const header = Buffer.concat([MAGIC, Buffer.from([VERSION, keyId.length]), keyId, lenBuf, wrapped]);
  const iv = randomBytes(IV_BYTES);
  const c = createCipheriv('aes-256-gcm', dek, iv);
  c.setAAD(aadFor(header, opts.aad));
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  dek.fill(0);
  return Buffer.concat([header, iv, ct, c.getAuthTag()]);
}

export async function open(keys: KeyProvider, sealed: Buffer, opts: SealOptions = {}): Promise<Buffer> {
  // Minimum: magic+version+keyIdLen+(keyId>=0)+wrappedLen+iv+tag
  if (sealed.length < 4 + 1 + 2 + IV_BYTES + TAG_BYTES) throw new VaultError('sealed data is too short');
  if (!sealed.subarray(0, 3).equals(MAGIC)) throw new VaultError('not a vault object');
  if (sealed[3] !== VERSION) throw new VaultError(`unsupported vault version ${sealed[3]}`);
  let off = 4;
  const keyIdLen = sealed[off++]!;
  if (sealed.length < off + keyIdLen + 2) throw new VaultError('sealed data is truncated');
  const keyIdBuf = sealed.subarray(off, off + keyIdLen);
  off += keyIdLen;
  const wrappedLen = sealed.readUInt16BE(off);
  off += 2;
  const headerEnd = off + wrappedLen;
  if (sealed.length < headerEnd + IV_BYTES + TAG_BYTES) throw new VaultError('sealed data is truncated');
  const wrapped = sealed.subarray(off, headerEnd);
  const header = sealed.subarray(0, headerEnd);
  const iv = sealed.subarray(headerEnd, headerEnd + IV_BYTES);
  const ct = sealed.subarray(headerEnd + IV_BYTES, sealed.length - TAG_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);

  const dek = await keys.unwrapKey(wrapped, keyIdBuf.toString('utf8'), aadFor(Buffer.concat([MAGIC, Buffer.from([VERSION]), keyIdBuf]), opts.aad));
  try {
    const d = createDecipheriv('aes-256-gcm', dek, iv);
    d.setAAD(aadFor(header, opts.aad));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
  } catch (cause) {
    throw new VaultError('could not open sealed data (wrong key, wrong context or tampered data)', { cause });
  } finally {
    dek.fill(0);
  }
}

/** Keyed hash for lookups on sensitive values (email, phone). Different purposes use unrelated keys. */
export async function hmac(keys: KeyProvider, purpose: string, data: string | Buffer): Promise<string> {
  if (!purpose) throw new VaultError('purpose must be a non-empty string');
  const key = await keys.deriveKey(purpose);
  try {
    return createHmac('sha256', key).update(data).digest('hex');
  } finally {
    key.fill(0);
  }
}
