import { describe, expect, it } from 'vitest';
import { parseAllowlist, loadAllowlist, SOURCE_ALLOWLIST } from '../src/allowlist';

describe('allowlist', () => {
  it('requires a dated note recording the robots.txt and terms check', () => {
    expect(() => parseAllowlist({ jsonld: [{ host: 'a.example.com' }], zoho_rss: [] })).toThrow(/checked_at/);
    expect(() => parseAllowlist({ jsonld: [{ host: 'a.example.com', checked_at: 'yesterday', note: 'ok' }], zoho_rss: [] })).toThrow(/checked_at/);
    expect(() => parseAllowlist({ jsonld: [{ host: 'a.example.com', checked_at: '2026-11-06', note: '' }], zoho_rss: [] })).toThrow(/note/);
  });
  it('rejects bad hosts', () => {
    expect(() => parseAllowlist({ jsonld: [{ host: 'http://a.com/x', checked_at: '2026-11-06', note: 'n' }], zoho_rss: [] })).toThrow(/host/);
  });
  it('maps hosts to caps', () => {
    const a = parseAllowlist({ jsonld: [{ host: 'Careers.Example.com', checked_at: '2026-11-06', note: 'robots+terms read', max_pages: 40 }], zoho_rss: [] });
    expect(a.jsonld['careers.example.com']).toEqual({ maxPages: 40 });
  });
  it('zoho entries are per employer token', () => {
    const a = parseAllowlist({ jsonld: [], zoho_rss: [{ token: 'in-60012345678', checked_at: '2026-11-06', note: 'robots allows /recruit/downloadrssfeed' }] });
    expect(a.zoho_rss['in-60012345678']).toEqual({});
    expect(() => parseAllowlist({ jsonld: [], zoho_rss: [{ token: 'recruit.zoho.in', checked_at: '2026-11-06', note: 'n' }] })).toThrow(/token/);
  });
  it('the shipped allowlist file parses', () => {
    const a = loadAllowlist(SOURCE_ALLOWLIST);
    expect(a).toHaveProperty('jsonld');
    expect(a).toHaveProperty('zoho_rss');
  });
});
