import { describe, expect, it } from 'vitest';
import { EnvKeyProvider, generateMasterKey } from '../src/index.js';

describe('generateMasterKey', () => {
  it('returns a fresh base64 32-byte key that EnvKeyProvider accepts', () => {
    const a = generateMasterKey();
    expect(Buffer.from(a, 'base64')).toHaveLength(32);
    expect(generateMasterKey()).not.toBe(a);
    expect(() => new EnvKeyProvider({ HIRELANE_MASTER_KEY: a })).not.toThrow();
  });
});
