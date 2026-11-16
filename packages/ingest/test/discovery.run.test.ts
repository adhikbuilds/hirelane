import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCandidates, loadKnown, loadSeedNames, runDiscovery, SEED_JSON, KNOWN_BOARD_FILES } from '../src/discovery/run';

const none = { names: new Set<string>(), tokens: new Set<string>() };

describe('buildCandidates', () => {
  it('skips known companies by name and known tokens', () => {
    const known = { names: new Set(['groww']), tokens: new Set(['zeta']) };
    const c = buildCandidates(['Groww', 'Zeta', 'Swiggy'], known);
    expect(c).toEqual([{ name: 'Swiggy', token: 'swiggy' }]);
  });
  it('dedupes tokens across names', () => {
    const t = buildCandidates(['Acme Inc', 'Acme Labs'], none).map((c) => c.token);
    expect(t.filter((x) => x === 'acme')).toHaveLength(1);
    expect(new Set(t).size).toBe(t.length);
  });
});

describe('seed list', () => {
  const names = loadSeedNames();
  const known = loadKnown(KNOWN_BOARD_FILES);
  it('has roughly 300 unique names', () => {
    expect(names.length).toBeGreaterThanOrEqual(280);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
  });
  it('contains no company we already ingest', () => {
    expect(known.names.size).toBeGreaterThan(100);
    expect(names.filter((n) => known.names.has(n.toLowerCase().replace(/[^a-z0-9]+/g, '')))).toEqual([]);
  });
  it('is names only', () => {
    expect(names.every((n) => typeof n === 'string' && n.trim() === n && !/https?:|\//.test(n))).toBe(true);
    expect(SEED_JSON).toContain('discovery-candidates.json');
  });
});

describe('runDiscovery', () => {
  it('writes one JSON line per hit and no DB', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'disc-'));
    const fetchFn = async (url: string) =>
      url.includes('greenhouse') && url.includes('/acme/')
        ? new Response(JSON.stringify({ jobs: [{ id: 1, location: { name: 'Pune' } }] }), { status: 200 })
        : new Response('{}', { status: 404 });
    const { file, result } = await runDiscovery({
      names: ['Acme'], known: none, outDir: dir, date: '2026-01-02',
      probe: { fetch: fetchFn, minIntervalMs: 0 },
    });
    expect(file).toBe(join(dir, '2026-01-02.jsonl'));
    const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ ats: 'greenhouse', token: 'acme', job_count: 1, india_count: 1 });
    expect(result.hits).toHaveLength(1);
  });
  it('writes an empty file when nothing hits', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'disc-'));
    const { file } = await runDiscovery({ names: ['Nope'], known: none, outDir: dir, date: 'd', probe: { fetch: async () => new Response('', { status: 404 }), minIntervalMs: 0 } });
    expect(readFileSync(file, 'utf8')).toBe('');
  });
  it('rejects a malformed seed file', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'disc-')), 's.json');
    writeFileSync(p, '[1,2]');
    expect(() => loadSeedNames(p)).toThrow();
  });
});
