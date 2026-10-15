import { describe, expect, it } from 'vitest';
import { EngineInvariantError } from '../src/errors';
import { CURRENCY_EXPONENT } from '../src/currency';
import { convertMinor, defaultFxSnapshot, parseRate, validateFx, type FxSnapshot } from '../src/fx';

const fx = (perUsd: FxSnapshot['perUsd']): FxSnapshot => ({ asOf: '2026-01-01', source: 'test', perUsd });

describe('fx_rates fixture', () => {
  const snap = defaultFxSnapshot();
  it('carries a date, an honest source and a rate for every supported currency', () => {
    expect(snap.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(snap.source.length).toBeGreaterThan(10);
    expect(snap.source.toLowerCase()).toContain('fixture');
    for (const c of Object.keys(CURRENCY_EXPONENT)) expect(snap.perUsd[c as keyof typeof CURRENCY_EXPONENT]).toBeTruthy();
    expect(snap.perUsd.USD).toBe('1');
  });
  it('validates cleanly', () => expect(() => validateFx(snap)).not.toThrow());
});

describe('parseRate', () => {
  it('scales decimal strings by 1e8', () => {
    expect(parseRate('1')).toBe(100000000n);
    expect(parseRate('88.5')).toBe(8850000000n);
    expect(parseRate('0.00000001')).toBe(1n);
    expect(parseRate('1.23456789')).toBe(123456789n);
  });
  it.each(['', 'abc', '1.234567891', '-1', '0', '0.0', '1e3', ' 1', '1.', '.5'])('rejects %j', (s) => {
    expect(() => parseRate(s)).toThrow(EngineInvariantError);
  });
});

describe('validateFx', () => {
  it('rejects bad dates and bad rates', () => {
    expect(() => validateFx({ ...fx({ USD: '1' }), asOf: 'yesterday' })).toThrow(EngineInvariantError);
    expect(() => validateFx(fx({ USD: '1', EUR: 'x' }))).toThrow(EngineInvariantError);
    expect(() => validateFx(fx({ USD: '2' }))).toThrow(EngineInvariantError);
  });
});

describe('convertMinor', () => {
  it('is the identity for the same currency', () => {
    const r = convertMinor(12345, 'USD', 'USD', fx({ USD: '1' }));
    expect(r).toStrictEqual({ value: 12345, rule: 'salary.fx.identity', rate: '1' });
  });
  it('converts INR paise to USD cents with the documented formula', () => {
    // 180,000,000 paise / 90 = 2,000,000 cents
    const r = convertMinor(180_000_000, 'INR', 'USD', fx({ USD: '1', INR: '90' }));
    expect(r.value).toBe(2_000_000);
    expect(r.rule).toBe('salary.fx.convert');
    expect(r.rate).toBe('0.01111111');
  });
  it('converts USD cents to INR paise', () => {
    expect(convertMinor(2_000_000, 'USD', 'INR', fx({ USD: '1', INR: '90' })).value).toBe(180_000_000);
  });
  it('rounds once, half up', () => {
    expect(convertMinor(3, 'INR', 'USD', fx({ USD: '1', INR: '2' })).value).toBe(2);
    expect(convertMinor(4, 'INR', 'USD', fx({ USD: '1', INR: '3' })).value).toBe(1);
    expect(convertMinor(5, 'INR', 'USD', fx({ USD: '1', INR: '3' })).value).toBe(2);
    expect(convertMinor(0, 'INR', 'USD', fx({ USD: '1', INR: '3' })).value).toBe(0);
  });
  it('accounts for exponent differences (JPY has none)', () => {
    expect(convertMinor(1_500_000, 'JPY', 'USD', fx({ USD: '1', JPY: '150' })).value).toBe(1_000_000);
    expect(convertMinor(1_000_000, 'USD', 'JPY', fx({ USD: '1', JPY: '150' })).value).toBe(1_500_000);
  });
  it('cross-converts through USD', () => {
    // 100 EUR (0.9/USD) -> GBP (0.8/USD): 100 * 0.8 / 0.9
    expect(convertMinor(10_000, 'EUR', 'GBP', fx({ USD: '1', EUR: '0.9', GBP: '0.8' })).value).toBe(8889);
  });
  it('reports a missing rate instead of guessing', () => {
    const r = convertMinor(100, 'INR', 'USD', fx({ USD: '1' }));
    expect(r).toStrictEqual({ value: null, rule: 'salary.fx.missing_rate', rate: null });
    expect(convertMinor(100, 'USD', 'INR', fx({ USD: '1' })).value).toBeNull();
  });
  it('throws salary.overflow when the result is not a safe integer', () => {
    expect(() => convertMinor(Number.MAX_SAFE_INTEGER, 'USD', 'INR', fx({ USD: '1', INR: '90' }))).toThrow(EngineInvariantError);
    try {
      convertMinor(Number.MAX_SAFE_INTEGER, 'USD', 'INR', fx({ USD: '1', INR: '90' }));
    } catch (e) {
      expect((e as EngineInvariantError).ruleId).toBe('salary.overflow');
    }
  });
  it('rejects negative, fractional or unsafe inputs', () => {
    expect(() => convertMinor(-1, 'USD', 'INR', fx({ USD: '1', INR: '90' }))).toThrow(EngineInvariantError);
    expect(() => convertMinor(1.5, 'USD', 'INR', fx({ USD: '1', INR: '90' }))).toThrow(EngineInvariantError);
  });
});
