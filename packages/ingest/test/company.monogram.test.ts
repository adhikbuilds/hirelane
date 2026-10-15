import { describe, expect, it } from 'vitest';
import { monogram } from '../src/company/monogram';

describe('monogram', () => {
  it('uses initials of the first two words', () => {
    expect(monogram('Open Source Co', 'open-source-co').initials).toBe('OS');
  });
  it('single mixed-case word gives one letter, all-caps short word gives two', () => {
    expect(monogram('Airtable', 'airtable').initials).toBe('A');
    expect(monogram('CRED', 'cred').initials).toBe('CR');
  });
  it('handles empty, emoji-only and non-latin names', () => {
    expect(monogram('', 'x').initials).toBe('?');
    expect(monogram('\u{1F680}\u{1F680}', 'x').initials).toBe('?');
    expect(monogram('école normale', 'e').initials).toBe('ÉN');
  });
  it('hue is deterministic per slug and within 0..359', () => {
    const a = monogram('A', 'same');
    expect(monogram('B', 'same').hue).toBe(a.hue);
    expect(a.hue).toBeGreaterThanOrEqual(0);
    expect(a.hue).toBeLessThan(360);
    expect(monogram('A', 'other-slug-xyz').hue).not.toBe(a.hue);
  });
});
