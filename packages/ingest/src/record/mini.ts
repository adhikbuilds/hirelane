import type { Ats } from '../contract';

export interface KeptBoard {
  ats: Ats;
  token: string;
  gzBytes: number;
  postings: number;
}

/** Ashby boards the recon sample verified; they must be in the mini fixture. */
export const MINI_REQUIRED = ['openai', 'benchling', 'temporal'] as const;
export const MINI_SIZE = 5;
const MIN_USEFUL_POSTINGS = 5;

const key = (b: KeptBoard) => `${b.ats}:${b.token}`;
const bySize = (a: KeptBoard, b: KeptBoard) => a.gzBytes - b.gzBytes || key(a).localeCompare(key(b));

/** Picks the 5 mini boards: the required ashby three, the smallest greenhouse and lever board, then fills by size. Deterministic. */
export function deriveMini(kept: KeptBoard[]): string[] {
  const pool = [...kept].sort(bySize);
  const chosen = new Map<string, KeptBoard>();
  for (const t of MINI_REQUIRED) {
    const b = pool.find((x) => x.ats === 'ashby' && x.token === t);
    if (b) chosen.set(key(b), b);
  }
  for (const ats of ['greenhouse', 'lever'] as const) {
    const ofAts = pool.filter((x) => x.ats === ats);
    if (!ofAts.length) throw new Error(`cannot derive mini fixture: no ${ats} board was recorded`);
    const b = ofAts.find((x) => x.postings >= MIN_USEFUL_POSTINGS) ?? ofAts[0]!;
    chosen.set(key(b), b);
  }
  for (const b of pool) {
    if (chosen.size >= MINI_SIZE) break;
    if (b.ats === 'ashby' && !chosen.has(key(b)) && b.postings >= MIN_USEFUL_POSTINGS) chosen.set(key(b), b);
  }
  for (const b of pool) {
    if (chosen.size >= MINI_SIZE) break;
    chosen.set(key(b), b);
  }
  return [...chosen.keys()].sort();
}
