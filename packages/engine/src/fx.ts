import fxData from '../data/fx_rates.json';
import { CURRENCY_EXPONENT, type Iso4217 } from './currency';
import { EngineInvariantError } from './errors';

export interface FxSnapshot {
  /** 'YYYY-MM-DD', from fx_rates.as_of. */
  asOf: string;
  /** fx_rates.source. */
  source: string;
  /** Decimal strings, at most 8 fraction digits (numeric(18,8)). USD = '1'. */
  perUsd: Readonly<Partial<Record<Iso4217, string>>>;
}

const SCALE_DIGITS = 8;
const SCALE = 10n ** BigInt(SCALE_DIGITS);
const RATE_RE = /^(\d+)(?:\.(\d{1,8}))?$/;

/** Parse a decimal rate string into a bigint scaled by 1e8. Throws on anything else, and on zero. */
export function parseRate(s: string): bigint {
  const m = RATE_RE.exec(s);
  if (!m) throw new EngineInvariantError('fx.invalid_rate', `invalid FX rate ${JSON.stringify(s)}`);
  const v = BigInt(m[1]!) * SCALE + BigInt((m[2] ?? '').padEnd(SCALE_DIGITS, '0'));
  if (v === 0n) throw new EngineInvariantError('fx.invalid_rate', 'FX rate must be positive');
  return v;
}

export function validateFx(fx: FxSnapshot): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fx.asOf)) throw new EngineInvariantError('fx.invalid_date', `invalid FX date ${JSON.stringify(fx.asOf)}`);
  for (const [cur, rate] of Object.entries(fx.perUsd)) {
    if (rate === undefined) continue;
    if (!(cur in CURRENCY_EXPONENT)) throw new EngineInvariantError('fx.unknown_currency', `unsupported currency ${cur} in FX snapshot`);
    parseRate(rate);
  }
  if (fx.perUsd.USD !== undefined && parseRate(fx.perUsd.USD) !== SCALE) throw new EngineInvariantError('fx.invalid_rate', 'USD must be 1');
}

let cached: FxSnapshot | null = null;
/** The committed fixture snapshot (data/fx_rates.json). */
export function defaultFxSnapshot(): FxSnapshot {
  if (!cached) {
    const snap: FxSnapshot = { asOf: fxData.as_of, source: fxData.source, perUsd: fxData.per_usd as FxSnapshot['perUsd'] };
    validateFx(snap);
    cached = snap;
  }
  return cached;
}

export interface FxConversion {
  value: number | null;
  rule: 'salary.fx.convert' | 'salary.fx.identity' | 'salary.fx.missing_rate';
  /** Decimal string of perUsd[to] / perUsd[from] (8 fraction digits, trailing zeros trimmed), or null. */
  rate: string | null;
}

function fmtScaled(n: bigint): string {
  const whole = n / SCALE;
  const frac = (n % SCALE).toString().padStart(SCALE_DIGITS, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/**
 * minor_target = minor_native * perUsd[target] / perUsd[native] * 10^(exp[target] - exp[native]),
 * computed in bigint and rounded once, half up (amounts are non-negative).
 */
export function convertMinor(minor: number, from: Iso4217, to: Iso4217, fx: FxSnapshot): FxConversion {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new EngineInvariantError('fx.invalid_amount', `amount must be a non-negative safe integer, got ${minor}`);
  if (from === to) return { value: minor, rule: 'salary.fx.identity', rate: '1' };
  const rf = fx.perUsd[from];
  const rt = fx.perUsd[to];
  if (rf === undefined || rt === undefined) return { value: null, rule: 'salary.fx.missing_rate', rate: null };
  const rateFrom = parseRate(rf);
  const rateTo = parseRate(rt);
  const dExp = CURRENCY_EXPONENT[to] - CURRENCY_EXPONENT[from];
  let num = BigInt(minor) * rateTo;
  let den = rateFrom;
  if (dExp >= 0) num *= 10n ** BigInt(dExp);
  else den *= 10n ** BigInt(-dExp);
  const rounded = (2n * num + den) / (2n * den);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new EngineInvariantError('salary.overflow', `converted amount exceeds the safe integer range (${from} -> ${to})`);
  const rate = fmtScaled((rateTo * SCALE + rateFrom / 2n) / rateFrom);
  return { value: Number(rounded), rule: 'salary.fx.convert', rate };
}
