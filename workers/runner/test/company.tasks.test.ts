import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createCompanyTasks, createFixtureLogoReader, createLogoStore, type CompanyDeps, type CompanyRow } from '../src/tasks/company.js';

const row = (o: Partial<CompanyRow> = {}): CompanyRow => ({ id: 'c1', slug: 'acme', name: 'Acme', domain: 'acme.com', logoSource: null, logoPath: null, ...o });

function make(over: Partial<CompanyDeps> = {}) {
  const deps: CompanyDeps = {
    mode: () => 'fixture',
    load: vi.fn(async () => row()),
    save: vi.fn(async () => {}),
    fixtureLogo: vi.fn(() => null),
    fetchLogo: vi.fn(async () => ({ ok: false as const, reason: 'no_usable_icon' as const, attempts: [] })),
    store: vi.fn(async (slug: string) => `logos/${slug}.png`),
    ...over,
  };
  const helpers = { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
  return { deps, helpers, run: (p: unknown) => createCompanyTasks(deps)['company:logo']!(p, helpers as never) };
}

describe('company:logo', () => {
  it('rejects invalid payloads', async () => {
    const { run, deps } = make();
    for (const p of [null, {}, { companyId: '' }, { companyId: 5 }, 'x']) await expect(run(p)).rejects.toThrow(/invalid payload/);
    expect(deps.load).not.toHaveBeenCalled();
  });

  it('throws when the company does not exist', async () => {
    const { run } = make({ load: vi.fn(async () => null) });
    await expect(run({ companyId: 'nope' })).rejects.toThrow(/not found/);
  });

  it('fixture mode: uses the committed fixture logo and makes no network call', async () => {
    const png = Buffer.from('png');
    const { run, deps } = make({ fixtureLogo: vi.fn(() => png) });
    await run({ companyId: 'c1' });
    expect(deps.fetchLogo).not.toHaveBeenCalled();
    expect(deps.store).toHaveBeenCalledWith('acme', png);
    expect(deps.save).toHaveBeenCalledWith('c1', { logoPath: 'logos/acme.png', logoSource: 'fixture' });
  });

  it('fixture mode: no fixture means monogram (null path), still no network', async () => {
    const { run, deps } = make();
    await run({ companyId: 'c1' });
    expect(deps.fetchLogo).not.toHaveBeenCalled();
    expect(deps.save).toHaveBeenCalledWith('c1', { logoPath: null, logoSource: 'monogram' });
  });

  it('live mode: stores the fetched logo', async () => {
    const png = Buffer.from('p');
    const { run, deps } = make({ mode: () => 'live', fetchLogo: vi.fn(async () => ({ ok: true as const, png, sourceUrl: 'https://acme.com/a.png', attempts: [] })) });
    await run({ companyId: 'c1' });
    expect(deps.fetchLogo).toHaveBeenCalledWith('acme.com');
    expect(deps.save).toHaveBeenCalledWith('c1', { logoPath: 'logos/acme.png', logoSource: 'fetched' });
  });

  it('live mode: failure falls back to monogram and logs the reason', async () => {
    const { run, deps, helpers } = make({ mode: () => 'live' });
    await run({ companyId: 'c1' });
    expect(deps.save).toHaveBeenCalledWith('c1', { logoPath: null, logoSource: 'monogram' });
    expect(deps.store).not.toHaveBeenCalled();
    expect(helpers.logger.info).toHaveBeenCalledWith(expect.stringContaining('no_usable_icon'));
  });

  it('live mode: no domain means monogram without fetching', async () => {
    const { run, deps } = make({ mode: () => 'live', load: vi.fn(async () => row({ domain: null })) });
    await run({ companyId: 'c1' });
    expect(deps.fetchLogo).not.toHaveBeenCalled();
    expect(deps.save).toHaveBeenCalledWith('c1', { logoPath: null, logoSource: 'monogram' });
  });

  it('live mode: an unexpected fetch error becomes a monogram, not a retry storm', async () => {
    const { run, deps } = make({ mode: () => 'live', fetchLogo: vi.fn(async () => { throw new Error('boom'); }) });
    await run({ companyId: 'c1' });
    expect(deps.save).toHaveBeenCalledWith('c1', { logoPath: null, logoSource: 'monogram' });
  });

  it('skips companies that already have a fetched/fixture logo unless forced', async () => {
    const { run, deps } = make({ mode: () => 'live', load: vi.fn(async () => row({ logoSource: 'fetched', logoPath: 'logos/acme.png' })) });
    await run({ companyId: 'c1' });
    expect(deps.fetchLogo).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
    await run({ companyId: 'c1', force: true });
    expect(deps.fetchLogo).toHaveBeenCalledOnce();
  });
});

describe('logo store and fixture reader', () => {
  it('store writes {slug}.png under the dir and returns a relative path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'logos-'));
    const store = createLogoStore(dir);
    expect(await store('acme', Buffer.from('x'))).toBe('logos/acme.png');
    expect(readFileSync(join(dir, 'acme.png')).toString()).toBe('x');
  });
  it('store refuses slugs that could escape the directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'logos-'));
    const store = createLogoStore(dir);
    for (const s of ['../x', 'a/b', '', '.hidden', 'A B', 'x\0y']) await expect(store(s, Buffer.from('x'))).rejects.toThrow(/slug/);
    expect(existsSync(join(dir, '..', 'x.png'))).toBe(false);
  });
  it('fixture reader returns bytes or null, and refuses unsafe slugs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fx-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'acme.png'), 'abc');
    const read = createFixtureLogoReader(dir);
    expect(read('acme')?.toString()).toBe('abc');
    expect(read('missing')).toBeNull();
    expect(read('../acme')).toBeNull();
  });
});
