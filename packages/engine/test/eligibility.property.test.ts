import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateEligibility, parseCriteria } from '../src/eligibility';
import type { CgpaRule, EligibilityProfileInput } from '../src/eligibility/types';
import { isWorthwhile, type WorthwhileInput } from '../src/worthwhile';

/** mulberry32: deterministic seeded PRNG (never Math.random). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const here = dirname(fileURLToPath(import.meta.url));
const texts = readFileSync(join(here, 'corpus', 'drive-criteria.labelled.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .slice(1)
  .map((l) => (JSON.parse(l) as { text: string }).text);

describe('property: unknown never blocks the worthwhile gate', () => {
  it('holds over 1000 seeded random profiles', () => {
    const rnd = prng(20261029);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    const maybe = <T>(v: () => T): T | undefined => (rnd() < 0.55 ? v() : undefined);
    const counts = { pass: 0, fail: 0, unknown: 0 };
    const rules: CgpaRule[] = [null, { kind: 'linear', a: 9.5, b: 0 }, { kind: 'linear', a: 10, b: -5 }];

    for (let i = 0; i < 1000; i++) {
      const profile: EligibilityProfileInput = { confirmed: true };
      const pct10 = maybe(() => Math.round(rnd() * 70 + 30));
      if (pct10 !== undefined) profile.pct_10 = pct10;
      const sk = maybe(() => pick(['12th', 'diploma'] as const));
      if (sk) profile.secondary_kind = sk;
      const ps = maybe(() => Math.round(rnd() * 70 + 30));
      if (ps !== undefined) profile.pct_secondary = ps;
      const scale = maybe(() => pick([4, 5, 10, 100] as const));
      if (scale) profile.grad_scale = scale;
      const gs = maybe(() => (scale === 100 ? rnd() * 60 + 40 : rnd() * (scale ?? 10)));
      if (gs !== undefined) profile.grad_score = gs;
      const ab = maybe(() => Math.floor(rnd() * 3));
      if (ab !== undefined) profile.active_backlogs = ab;
      const bh = maybe(() => Math.floor(rnd() * 4));
      if (bh !== undefined) profile.backlog_history = bh;
      const gap = maybe(() => Math.floor(rnd() * 4));
      if (gap !== undefined) profile.gap_years = gap;
      const py = maybe(() => 2023 + Math.floor(rnd() * 5));
      if (py !== undefined) profile.passout_year = py;
      const deg = maybe(() => pick(['B.Tech', 'BCA', 'MCA', 'B.Sc', 'Bachelor of Arts']));
      if (deg) profile.degree = deg;
      const br = maybe(() => pick(['CSE', 'IT', 'ECE', 'MECH', 'AIML', 'Basketry']));
      if (br) profile.branch_code = br;
      if (rnd() < 0.3) profile.grad_is_final = rnd() < 0.5;

      const nText = 1 + Math.floor(rnd() * 3);
      const text = Array.from({ length: nText }, () => pick(texts)).join('. ');
      const result = evaluateEligibility(parseCriteria(text), profile, { cgpaRule: pick(rules) });
      counts[result.overall]++;

      const input: WorthwhileInput = {
        job: { fresher: true, open: true, lastCheckedAt: '2026-10-28T00:00:00Z', payStated: true, remote: null, locations: [] },
        evidence: { mustMet: 3, mustTotal: 4 },
        user: { cities: [], remote: false },
        now: '2026-10-29T00:00:00Z',
      };
      const without = isWorthwhile(input);
      const withE = isWorthwhile({ ...input, eligibility: result });
      expect(without.worthwhile).toBe(true);
      if (result.overall === 'fail') expect(withE.worthwhile).toBe(false);
      else expect(withE.worthwhile).toBe(true);
      if (result.overall === 'unknown') expect(withE.worthwhile).toBe(without.worthwhile);
    }
    // Not vacuous: all three outcomes were actually exercised.
    expect(counts.unknown).toBeGreaterThan(50);
    expect(counts.fail).toBeGreaterThan(50);
    expect(counts.pass).toBeGreaterThan(20);
  });
});
