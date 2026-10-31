import { describe, expect, it } from 'vitest';
import { EnvKeyProvider, generateMasterKey } from '@hirelane/vault';
import { CODE_ALPHABET, campusCodeHmac, domainOf, generateCampusCode, mailboxHmac, normalizeCampusCode, normalizeMailbox } from '../src/campus/codes';

describe('campus join codes', () => {
  it('generates 8 characters of Crockford base32', () => {
    for (let i = 0; i < 200; i++) expect(generateCampusCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(new Set(CODE_ALPHABET).size).toBe(32);
    expect(generateCampusCode((n) => n - 1)).toBe('ZZZZZZZZ');
  });

  it('forgives case, spaces, hyphens and look-alike letters', () => {
    expect(normalizeCampusCode('abcd-2345')).toBe('ABCD2345');
    expect(normalizeCampusCode(' ab cd 23 45 ')).toBe('ABCD2345');
    expect(normalizeCampusCode('LOOIl0O1')).toBe('10011001');
  });

  it('rejects the wrong length, characters outside the alphabet, and non-strings', () => {
    for (const bad of ['', 'ABC', 'ABCD23456', 'ABCD234U', 'ABCD234!', 'ＡＢＣＤ２３４５'.replace(/./g, '€'), 12345678, null, undefined, {}, 'A'.repeat(500)]) {
      expect(normalizeCampusCode(bad as never), String(bad)).toBeNull();
    }
  });

  it('NFKC folds full-width letters to the plain code', () => {
    expect(normalizeCampusCode('ＡＢＣＤ２３４５')).toBe('ABCD2345');
  });
});

describe('mailbox normalisation and hashing (shared by OTP, account match and roster)', () => {
  const keys = new EnvKeyProvider({ HIRELANE_MASTER_KEY: generateMasterKey() });

  it('lower-cases and trims, so case and whitespace do not change the hash', async () => {
    expect(normalizeMailbox('  Asha.K@College.EDU ')).toBe('asha.k@college.edu');
    const a = await mailboxHmac(keys, normalizeMailbox('Asha.K@College.edu')!);
    const b = await mailboxHmac(keys, normalizeMailbox(' asha.k@COLLEGE.EDU  ')!);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is keyed: another purpose or another master key gives another hash', async () => {
    const other = new EnvKeyProvider({ HIRELANE_MASTER_KEY: generateMasterKey() });
    expect(await mailboxHmac(keys, 'a@b.edu')).not.toBe(await mailboxHmac(other, 'a@b.edu'));
    expect(await mailboxHmac(keys, 'a@b.edu')).not.toBe(await campusCodeHmac(keys, 'a@b.edu'));
  });

  it('refuses things that are not a plain address', () => {
    for (const bad of ['', 'nope', 'a@', '@b.edu', 'a b@c.edu', 'x'.repeat(300) + '@c.edu', null, 5]) expect(normalizeMailbox(bad as never), String(bad)).toBeNull();
  });

  it('reads the domain after the last @', () => {
    expect(domainOf('a@b.example.edu')).toBe('b.example.edu');
  });
});
