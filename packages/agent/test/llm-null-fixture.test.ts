import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FixtureProvider, NullProvider, type LlmCallRecord } from '../src/llm/index.js';

const Schema = z.object({ results: z.array(z.object({ id: z.string(), n: z.number() })) });
const req = {
  purpose: 'salary',
  system: 'sys',
  schema: Schema,
  items: [{ id: 'a', text: 'one' }, { id: 'b', text: 'two' }],
};

describe('NullProvider', () => {
  it('is unavailable and logs nothing', async () => {
    const calls: LlmCallRecord[] = [];
    const p = new NullProvider();
    const r = await p.extract(req);
    expect(r).toEqual({ status: 'unavailable', reason: 'off' });
    expect(p.available).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('FixtureProvider', () => {
  it('returns the fixture for the purpose and validates against the schema', async () => {
    const p = new FixtureProvider({ salary: { results: [{ id: 'a', n: 1 }] } });
    const r = await p.extract(req);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.parsed.results[0]).toEqual({ id: 'a', n: 1 });
  });
  it('supports a function handler receiving the request', async () => {
    const p = new FixtureProvider({
      salary: (rq) => ({ results: rq.items.map((i, k) => ({ id: i.id, n: k })) }),
    });
    const r = await p.extract(req);
    expect(r.status === 'ok' && r.parsed.results.map((x) => x.n)).toEqual([0, 1]);
  });
  it('is unavailable when no fixture matches', async () => {
    const r = await new FixtureProvider({}).extract(req);
    expect(r).toEqual({ status: 'unavailable', reason: 'no_fixture' });
  });
  it('rejects fixtures that violate the schema', async () => {
    const r = await new FixtureProvider({ salary: { results: 'bad' } }).extract(req);
    expect(r).toEqual({ status: 'unavailable', reason: 'parse_failed' });
  });
  it('logs a call without content', async () => {
    const calls: LlmCallRecord[] = [];
    const p = new FixtureProvider({ salary: { results: [] } }, { record: (c) => void calls.push(c) });
    await p.extract(req);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ purpose: 'salary', mode: 'fixture', status: 'ok', batchSize: 2, inputTokens: 0 });
    expect(JSON.stringify(calls[0])).not.toContain('one');
  });
  it('a throwing sink never breaks extraction', async () => {
    const p = new FixtureProvider({ salary: { results: [] } }, { record: () => { throw new Error('db down'); } });
    expect((await p.extract(req)).status).toBe('ok');
  });
});
