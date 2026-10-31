import { describe, expect, it } from 'vitest';
import { EnvKeyProvider, generateMasterKey } from '@hirelane/vault';
import { CRITICAL_KINDS, NOTIFY_KINDS, OPTIONAL_KINDS, renderNotificationEmail, SetPrefInput, tokenHash, unsubscribeToken, unsubscribeUrl } from '../src/notify';
import { parseInput } from '../src/schema';

// Pure parts of the notifications: kinds, the unsubscribe token, and the plain-text mail. 0 LLM; the mail is text only.
const keys = new EnvKeyProvider({ [`HIRELANE_MASTER_KEY`]: generateMasterKey() } as never);

describe('kinds', () => {
  it('are the four from the plan, split into critical and optional', () => {
    expect([...NOTIFY_KINDS].sort()).toEqual(['drive_closing', 'drive_published', 'employer_reply', 'outcome_verified']);
    expect([...CRITICAL_KINDS].sort()).toEqual(['employer_reply', 'outcome_verified']);
    expect([...OPTIONAL_KINDS].sort()).toEqual(['drive_closing', 'drive_published']);
  });
  it('a preference can be set for an optional kind only', () => {
    expect(parseInput(SetPrefInput, { kind: 'drive_closing', email: false })).toEqual({ kind: 'drive_closing', email: false });
    for (const bad of [{ kind: 'employer_reply', email: false }, { kind: 'outcome_verified', email: false }, { kind: 'x', email: true }, { kind: 'drive_closing' }, { kind: 'drive_closing', email: 'no' }, { kind: 'drive_closing', email: true, extra: 1 }]) {
      expect(() => parseInput(SetPrefInput, bad), JSON.stringify(bad)).toThrow();
    }
  });
});

describe('unsubscribe token', () => {
  it('is stable per student, differs per student, and is URL-safe', async () => {
    const a = await unsubscribeToken(keys, '11111111-1111-4111-8111-111111111111');
    expect(a).toBe(await unsubscribeToken(keys, '11111111-1111-4111-8111-111111111111'));
    expect(a).not.toBe(await unsubscribeToken(keys, '22222222-2222-4222-8222-222222222222'));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it('is stored only as a hash, and the hash is not the token', async () => {
    const t = await unsubscribeToken(keys, '11111111-1111-4111-8111-111111111111');
    expect(tokenHash(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash(t)).not.toBe(t);
    expect(tokenHash(t)).toBe(tokenHash(t));
  });
  it('builds a link on the app origin only', () => {
    expect(unsubscribeUrl('https://app.example.test/', 'abc')).toBe('https://app.example.test/unsubscribe?t=abc');
    expect(() => unsubscribeUrl('javascript:alert(1)', 'abc')).toThrow();
  });
});

describe('mail text', () => {
  const base = { appUrl: 'https://app.example.test', unsubscribeUrl: 'https://app.example.test/unsubscribe?t=tok' };
  it('every kind has a subject and a plain-text body that points to Home', () => {
    for (const kind of NOTIFY_KINDS) {
      const m = renderNotificationEmail({ kind, title: 'Acme: something happened', ...base });
      expect(m.subject.length).toBeGreaterThan(5);
      expect(m.text).toContain('https://app.example.test/home');
      expect(m.text).not.toMatch(/<[a-z]/i);
    }
  });
  it('optional kinds carry the unsubscribe link; critical kinds say why they cannot be switched off', () => {
    for (const kind of OPTIONAL_KINDS) expect(renderNotificationEmail({ kind, title: 'T', ...base }).text).toContain('https://app.example.test/unsubscribe?t=tok');
    for (const kind of CRITICAL_KINDS) {
      const t = renderNotificationEmail({ kind, title: 'T', ...base }).text;
      expect(t).not.toContain('unsubscribe');
      expect(t).toMatch(/applications|offer/i);
    }
  });
  it('a title cannot inject a header, and nothing from scam flags can appear', () => {
    const m = renderNotificationEmail({ kind: 'drive_published', title: 'Evil\r\nBcc: x@example.test', ...base });
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.subject).toContain('Evil');
  });
});
