import { describe, expect, it } from 'vitest';
import { candidateTokens } from '../src/discovery/candidates';

describe('candidateTokens', () => {
  it('lowercases and returns the plain name', () => {
    expect(candidateTokens('Razorpay')).toEqual(['razorpay']);
  });

  it('strips corporate suffixes and keeps the unstripped variant', () => {
    const t = candidateTokens('Razorpay Software Pvt Ltd');
    expect(t[0]).toBe('razorpay');
    expect(t).toContain('razorpaysoftwarepvtltd');
    expect(t).toContain('razorpay-software-pvt-ltd');
  });

  it('strips Technologies, Labs, India, Inc', () => {
    expect(candidateTokens('Acme Technologies India Inc')[0]).toBe('acme');
    expect(candidateTokens('Foo Labs')[0]).toBe('foo');
  });

  it('emits joined and hyphenated variants for multi-word names', () => {
    expect(candidateTokens('Pocket FM')).toEqual(['pocketfm', 'pocket-fm']);
  });

  it('removes punctuation and diacritics', () => {
    expect(candidateTokens("Observe.AI")).toEqual(['observeai', 'observe-ai']);
    expect(candidateTokens('Café Düsseldorf, Inc.')).toContain('cafedusseldorf');
  });

  it('adds the domain stem', () => {
    const t = candidateTokens('Hevo Data', 'https://www.hevodata.com/careers');
    expect(t).toContain('hevodata');
    expect(candidateTokens('X', 'www.zeta.tech')).toContain('zeta');
  });

  it('dedupes and only returns valid slugs', () => {
    const t = candidateTokens('Zeta', 'zeta.tech');
    expect(t).toEqual(['zeta']);
    for (const x of candidateTokens('A&B  Co. (Beta)!')) expect(x).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });

  it('does not strip a name down to nothing', () => {
    expect(candidateTokens('Labs')).toEqual(['labs']);
  });

  it('returns [] for empty, whitespace or non-latin-only input', () => {
    expect(candidateTokens('')).toEqual([]);
    expect(candidateTokens('   ')).toEqual([]);
    expect(candidateTokens('日本語')).toEqual([]);
    expect(candidateTokens(null as unknown as string)).toEqual([]);
  });

  it('drops tokens shorter than 2 chars', () => {
    expect(candidateTokens('X')).toEqual([]);
  });
});
