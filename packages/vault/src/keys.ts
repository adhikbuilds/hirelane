import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { VaultError } from './errors.js';

/**
 * Holds the master secret. The envelope code only ever sees wrapped keys, so the master key can
 * later live in a KMS / Key Vault without touching seal/open.
 */
export interface KeyProvider {
  /** Identifies the master key version that produced a wrapped DEK. Stored in the sealed header. */
  readonly keyId: string;
  wrapKey(dek: Buffer, aad: Buffer): Promise<Buffer>;
  unwrapKey(wrapped: Buffer, keyId: string, aad: Buffer): Promise<Buffer>;
  /** A 32-byte subkey bound to a purpose string (HMAC and similar). Distinct purposes never share a key. */
  deriveKey(purpose: string): Promise<Buffer>;
}

export const MASTER_KEY_ENV = 'HIRELANE_MASTER_KEY';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const WRAPPED_DEK_BYTES = IV_BYTES + KEY_BYTES + TAG_BYTES;

export function generateMasterKey(): string {
  return randomBytes(KEY_BYTES).toString('base64');
}

/** Master key from HIRELANE_MASTER_KEY (base64, 32 bytes). Subkeys are derived with HKDF-SHA256. */
export class EnvKeyProvider implements KeyProvider {
  readonly keyId = 'env:1';
  private readonly master: Buffer;

  constructor(env: Record<string, string | undefined> = process.env) {
    const raw = env[MASTER_KEY_ENV]?.trim();
    if (!raw) {
      throw new VaultError(`${MASTER_KEY_ENV} is not set. Run \`pnpm setup:keys\` and put the printed line in .env.local.`);
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
      throw new VaultError(`${MASTER_KEY_ENV} must be base64.`);
    }
    const key = Buffer.from(raw, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new VaultError(`${MASTER_KEY_ENV} must decode to exactly ${KEY_BYTES} bytes.`);
    }
    this.master = key;
  }

  private kek(): Buffer {
    return Buffer.from(hkdfSync('sha256', this.master, Buffer.alloc(0), 'hirelane/vault/kek/v1', KEY_BYTES));
  }

  async wrapKey(dek: Buffer, aad: Buffer): Promise<Buffer> {
    const iv = randomBytes(IV_BYTES);
    const c = createCipheriv('aes-256-gcm', this.kek(), iv);
    c.setAAD(aad);
    const ct = Buffer.concat([c.update(dek), c.final()]);
    return Buffer.concat([iv, ct, c.getAuthTag()]);
  }

  async unwrapKey(wrapped: Buffer, keyId: string, aad: Buffer): Promise<Buffer> {
    if (keyId !== this.keyId) throw new VaultError('unknown key id');
    if (wrapped.length !== WRAPPED_DEK_BYTES) throw new VaultError('malformed wrapped key');
    try {
      const d = createDecipheriv('aes-256-gcm', this.kek(), wrapped.subarray(0, IV_BYTES));
      d.setAAD(aad);
      d.setAuthTag(wrapped.subarray(WRAPPED_DEK_BYTES - TAG_BYTES));
      return Buffer.concat([d.update(wrapped.subarray(IV_BYTES, WRAPPED_DEK_BYTES - TAG_BYTES)), d.final()]);
    } catch (cause) {
      throw new VaultError('could not unwrap key (wrong master key or tampered data)', { cause });
    }
  }

  async deriveKey(purpose: string): Promise<Buffer> {
    if (!purpose) throw new VaultError('purpose must be a non-empty string');
    return Buffer.from(hkdfSync('sha256', this.master, Buffer.alloc(0), `hirelane/vault/hmac/v1/${purpose}`, KEY_BYTES));
  }
}
