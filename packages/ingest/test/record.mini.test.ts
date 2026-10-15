import { describe, expect, it } from 'vitest';
import { deriveMini, MINI_REQUIRED, type KeptBoard } from '../src/record/mini';

const b = (ats: KeptBoard['ats'], token: string, gzBytes: number, postings = 10): KeptBoard => ({
  ats,
  token,
  gzBytes,
  postings,
});

const pool: KeptBoard[] = [
  b('ashby', 'openai', 500),
  b('ashby', 'benchling', 300),
  b('ashby', 'temporal', 100),
  b('ashby', 'notion', 50),
  b('greenhouse', 'stripe', 900),
  b('greenhouse', 'tiny', 20),
  b('lever', 'razorpay', 700),
  b('lever', 'cred', 40),
];

describe('deriveMini', () => {
  it('returns exactly 5 boards including the three required ashby boards', () => {
    const m = deriveMini(pool);
    expect(m).toHaveLength(5);
    for (const t of MINI_REQUIRED) expect(m).toContain(`ashby:${t}`);
  });

  it('adds the smallest greenhouse and lever boards', () => {
    const m = deriveMini(pool);
    expect(m).toContain('greenhouse:tiny');
    expect(m).toContain('lever:cred');
  });

  it('fills from the smallest other boards when a required board is missing', () => {
    const m = deriveMini(pool.filter((x) => x.token !== 'openai'));
    expect(m).toHaveLength(5);
    expect(m).not.toContain('ashby:openai');
    expect(m).toContain('ashby:notion');
  });

  it('is deterministic regardless of input order', () => {
    expect(deriveMini([...pool].reverse())).toEqual(deriveMini(pool));
  });

  it('throws when there is no greenhouse or lever board to keep both ATSs represented', () => {
    expect(() => deriveMini(pool.filter((x) => x.ats === 'ashby'))).toThrow(/greenhouse|lever/);
  });
});
