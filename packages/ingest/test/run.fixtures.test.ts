import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { connectors } from '../src/connectors';
import { createFixtureFetch, parseInject } from '../src/run/fixtures';
import { fixtureText, opts } from './connectors.helpers';

const MINI = fileURLToPath(new URL('../fixtures/mini/', import.meta.url));
const sig = () => new AbortController().signal;
const boards = [
  { ats: 'ashby' as const, token: 'openai' },
  { ats: 'greenhouse' as const, token: 'airtable' },
  { ats: 'lever' as const, token: 'cred' },
];

describe('parseInject', () => {
  it('parses ats:token=status pairs', () => {
    expect(parseInject(['ashby:openai=500', 'lever:cred=429'])).toEqual({ 'ashby:openai': 500, 'lever:cred': 429 });
  });
  it.each(['openai=500', 'ashby:openai', 'ashby:openai=abc', 'ashby:openai=99', 'ashby:openai=700'])('rejects %s', (s) => {
    expect(() => parseInject([s])).toThrow();
  });
  it('is empty for no input', () => expect(parseInject([])).toEqual({}));
});

describe('createFixtureFetch', () => {
  it('serves the recorded body byte-exact for each ATS url', async () => {
    const f = createFixtureFetch({ dir: MINI, boards });
    for (const b of boards) {
      const res = await f(connectors[b.ats].boardUrl(b.token), { signal: sig(), headers: {} });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(fixtureText('mini', b.ats, b.token));
    }
  });

  it('lets a connector ingest it end to end', async () => {
    const f = createFixtureFetch({ dir: MINI, boards });
    const r = await connectors.ashby.fetchBoard('openai', opts(f));
    expect(r.ok && r.postings.length).toBeGreaterThan(0);
  });

  it('injects an HTTP status for the named board only', async () => {
    const f = createFixtureFetch({ dir: MINI, boards, inject: { 'ashby:openai': 500 } });
    const bad = await f(connectors.ashby.boardUrl('openai'), { signal: sig(), headers: {} });
    expect(bad.status).toBe(500);
    const ok = await f(connectors.lever.boardUrl('cred'), { signal: sig(), headers: {} });
    expect(ok.status).toBe(200);
  });

  it('answers 404 for a board with no fixture file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fx-'));
    const f = createFixtureFetch({ dir, boards });
    const res = await f(connectors.ashby.boardUrl('openai'), { signal: sig(), headers: {} });
    expect(res.status).toBe(404);
  });

  it('reads a gzip file from a custom directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fx-'));
    mkdirSync(join(dir, 'ashby'));
    writeFileSync(join(dir, 'ashby', 'openai.json.gz'), gzipSync('{"jobs":[]}'));
    const f = createFixtureFetch({ dir, boards });
    expect(await (await f(connectors.ashby.boardUrl('openai'), { signal: sig(), headers: {} })).text()).toBe('{"jobs":[]}');
  });

  it('throws on a url that is not a configured board (never a free-form fetch)', async () => {
    const f = createFixtureFetch({ dir: MINI, boards });
    await expect(f('https://evil.example/x', { signal: sig(), headers: {} })).rejects.toThrow(/unknown fixture url/);
  });
});
