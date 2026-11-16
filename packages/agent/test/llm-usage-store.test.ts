import { describe, expect, it } from 'vitest';
import { createDbUsageStore } from '../src/llm/index.js';

function fake(rows: unknown[][]) {
  const seen: { text: string; params: unknown[] }[] = [];
  return {
    seen,
    q: { query: async (text: string, params: unknown[]) => (seen.push({ text, params }), { rows: rows.shift() ?? [] }) },
  };
}
const at = new Date('2026-11-09T10:00:00Z');

describe('createDbUsageStore', () => {
  it('sums the month from llm_calls with a UTC month window', async () => {
    const f = fake([[{ usd: '4.25' }]]);
    expect(await createDbUsageStore(f.q).monthSpendUsd(at)).toBe(4.25);
    expect(f.seen[0]!.text).toMatch(/est_cost_usd/);
    expect(f.seen[0]!.params).toEqual(['2026-11-01T00:00:00.000Z', '2026-12-01T00:00:00.000Z']);
  });
  it('reads zero for an empty month and an unseen student', async () => {
    const f = fake([[{ usd: null }], []]);
    const s = createDbUsageStore(f.q);
    expect(await s.monthSpendUsd(at)).toBe(0);
    expect(await s.userCallsToday('u1', at)).toBe(0);
  });
  it('reads the student day count by UTC date', async () => {
    const f = fake([[{ calls: 7 }]]);
    expect(await createDbUsageStore(f.q).userCallsToday('u1', at)).toBe(7);
    expect(f.seen[0]!.params).toEqual(['u1', '2026-11-09']);
  });
  it('increments per student only when a student is given', async () => {
    const f = fake([[], []]);
    const s = createDbUsageStore(f.q);
    await s.noteCall(undefined, at);
    expect(f.seen).toHaveLength(0);
    await s.noteCall('u1', at);
    expect(f.seen[0]!.text).toMatch(/ON CONFLICT/);
    expect(f.seen[0]!.params).toEqual(['u1', '2026-11-09']);
  });
});
