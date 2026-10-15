import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { canonicalDomain, fetchGreenhouseBoardName, nameFromGreenhouseJobs, resolveCompanyName, sanitizeName } from '../src/company/name';

describe('sanitizeName', () => {
  it('collapses whitespace, strips control chars and tags, decodes common entities, caps length', () => {
    expect(sanitizeName('  Acme \n\t Corp ')).toBe('Acme Corp');
    expect(sanitizeName('Ac\u0000me​')).toBe('Acme');
    expect(sanitizeName('<b>Acme</b> &amp; Sons')).toBe('Acme & Sons');
    expect(sanitizeName('x'.repeat(500))!.length).toBe(120);
    expect(sanitizeName('Café')).toBe('Café');
  });
  it('returns null for empty / non-string input', () => {
    expect(sanitizeName('')).toBeNull();
    expect(sanitizeName('   ')).toBeNull();
    expect(sanitizeName(null)).toBeNull();
    expect(sanitizeName(42 as never)).toBeNull();
    expect(sanitizeName('<script></script>')).toBeNull();
  });
});

describe('canonicalDomain', () => {
  it('lowercases, strips www and trailing dot', () => {
    expect(canonicalDomain('WWW.Airtable.com.')).toBe('airtable.com');
    expect(canonicalDomain('cred.club')).toBe('cred.club');
  });
  it('rejects anything that is not a bare hostname', () => {
    for (const bad of ['', null, undefined, 'http://a.com', 'a.com/x', 'a.com:8080', '127.0.0.1', '[::1]', 'localhost', 'a b.com', 'user@a.com', '-a.com'])
      expect(canonicalDomain(bad as never)).toBeNull();
  });
});

describe('resolveCompanyName', () => {
  it('prefers the boards config name', () => {
    expect(resolveCompanyName({ configName: 'CRED', boardName: 'Other', token: 'cred' })).toEqual({ name: 'CRED', source: 'config' });
  });
  it('falls back to board metadata, then to the token', () => {
    expect(resolveCompanyName({ configName: '  ', boardName: ' Airtable ', token: 'airtable' })).toEqual({ name: 'Airtable', source: 'board_metadata' });
    expect(resolveCompanyName({ configName: null, boardName: null, token: 'acme-labs' })).toEqual({ name: 'acme-labs', source: 'token' });
  });
});

describe('Greenhouse board names', () => {
  it('reads company_name from a RECORDED Greenhouse jobs fixture (verified path)', () => {
    const raw = JSON.parse(gunzipSync(readFileSync(new URL('../fixtures/mini/greenhouse/airtable.json.gz', import.meta.url))).toString());
    expect(nameFromGreenhouseJobs(raw)).toBe('Airtable');
  });
  it('nameFromGreenhouseJobs is null for odd shapes', () => {
    expect(nameFromGreenhouseJobs(null)).toBeNull();
    expect(nameFromGreenhouseJobs({ jobs: [] })).toBeNull();
    expect(nameFromGreenhouseJobs({ jobs: [{ company_name: 5 }] })).toBeNull();
  });
  // [assumption: Greenhouse board-name endpoint] GET /v1/boards/{token} -> { name }. Observed live 2026-10-16, not recorded.
  it('fetchGreenhouseBoardName uses the board endpoint and sanitises', async () => {
    const urls: string[] = [];
    const f = async (u: string) => {
      urls.push(u);
      return new Response(JSON.stringify({ name: ' Airtable <i>x</i>', content: '...' }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    expect(await fetchGreenhouseBoardName('airtable', f as never)).toBe('Airtable x');
    expect(urls).toEqual(['https://boards-api.greenhouse.io/v1/boards/airtable']);
  });
  it('fetchGreenhouseBoardName returns null on 404, bad JSON, network error or unsafe token', async () => {
    expect(await fetchGreenhouseBoardName('x', (async () => new Response('', { status: 404 })) as never)).toBeNull();
    expect(await fetchGreenhouseBoardName('x', (async () => new Response('{nope', { status: 200 })) as never)).toBeNull();
    expect(await fetchGreenhouseBoardName('x', (async () => { throw new Error('down'); }) as never)).toBeNull();
    let called = false;
    expect(await fetchGreenhouseBoardName('../etc', (async () => { called = true; return new Response('{}'); }) as never)).toBeNull();
    expect(called).toBe(false);
  });
});
