export const CURRENCY_EXPONENT = {
  USD: 2, CAD: 2, AUD: 2, SGD: 2, NZD: 2, HKD: 2, GBP: 2, EUR: 2, CHF: 2, SEK: 2, NOK: 2,
  DKK: 2, PLN: 2, CZK: 2, INR: 2, BRL: 2, MXN: 2, ILS: 2, AED: 2, ZAR: 2, JPY: 0, KRW: 0,
} as const;
/** Any other currency means parse returns null ('salary.currency.unsupported'). */
export type Iso4217 = keyof typeof CURRENCY_EXPONENT;

export const ISO_CODES = Object.keys(CURRENCY_EXPONENT) as Iso4217[];

export function isIso4217(x: string): x is Iso4217 {
  return Object.prototype.hasOwnProperty.call(CURRENCY_EXPONENT, x);
}

export const CURRENCY_SYMBOL: Readonly<Record<Iso4217, string>> = {
  USD: '$', CAD: 'CA$', AUD: 'A$', SGD: 'S$', NZD: 'NZ$', HKD: 'HK$', GBP: '£', EUR: '€', CHF: 'CHF ', SEK: 'SEK ', NOK: 'NOK ',
  DKK: 'DKK ', PLN: 'PLN ', CZK: 'CZK ', INR: '₹', BRL: 'R$', MXN: 'MX$', ILS: '₪', AED: 'AED ', ZAR: 'R', JPY: '¥', KRW: '₩',
};
