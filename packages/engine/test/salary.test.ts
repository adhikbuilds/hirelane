import { describe, expect, it } from 'vitest';
import { EngineInvariantError } from '../src/errors';
import { isTrace } from '../src/trace';
import { defaultFxSnapshot, type FxSnapshot } from '../src/fx';
import {
  ANNUAL_FACTOR,
  CURRENCY_EXPONENT,
  SALARY_LLM_BELOW,
  formatSalary,
  normalizeSalary,
  parseSalary,
  parseSalaryTraced,
  salaryCues,
  isSalaryStated,
  type SalaryParse,
  type StructuredComp,
} from '../src/salary';

const ids = (t: { steps: { ruleId: string }[] }) => t.steps.map((s) => s.ruleId);
const fx90: FxSnapshot = { asOf: '2026-10-15', source: 'test fixture', perUsd: { USD: '1', INR: '90', EUR: '0.9', GBP: '0.8', JPY: '150' } };

const ashby = (over: Partial<StructuredComp> = {}): StructuredComp => ({
  min: 257000, max: 335000, currency: 'USD', interval: 'year', kind: 'salary', summaryText: '$257K - $335K', source: 'ashby.compensation', ...over,
});

describe('constants', () => {
  it('has the contract exponents and annual factors', () => {
    expect(CURRENCY_EXPONENT.USD).toBe(2);
    expect(CURRENCY_EXPONENT.JPY).toBe(0);
    expect(CURRENCY_EXPONENT.KRW).toBe(0);
    expect(Object.keys(CURRENCY_EXPONENT)).toHaveLength(22);
    expect(ANNUAL_FACTOR).toStrictEqual({ hour: 2080, day: 260, week: 52, month: 12, year: 1 });
    expect(SALARY_LLM_BELOW).toBe(0.7);
  });
});

describe('structured compensation (precedence 1)', () => {
  it('uses the Ashby openai posting 0 value unchanged', () => {
    const p = parseSalary('', ashby())!;
    expect(p.source).toBe('ats_structured');
    expect(p.minMinor).toBe(25_700_000);
    expect(p.maxMinor).toBe(33_500_000);
    expect(p.currency).toBe('USD');
    expect(p.period).toBe('year');
    expect(p.periodRule).toBe('structured');
    expect(p.currencyRule).toBe('structured');
    expect(p.kind).toBe('base');
    expect(p.bound).toBe('range');
    expect(p.confidence).toBe(1);
    expect(p.evidence[0]).toMatchObject({ source: 'structured', start: 0, end: 0, path: 'ashby.compensation' });
    expect(ids(p.trace)).toContain('salary.structured.use');
    expect(isTrace(p.trace)).toBe(true);
  });
  it('passes the Temporal first tier through unchanged', () => {
    const p = parseSalary('', ashby({ min: 216000, max: 283500, summaryText: null }))!;
    expect([p.minMinor, p.maxMinor]).toEqual([21_600_000, 28_350_000]);
  });
  it('treats an hourly Lever range as stated hourly, then annualises x2080', () => {
    const p = parseSalary('', ashby({ min: 40, max: 55, interval: 'hour', source: 'lever.salaryRange', summaryText: null }))!;
    expect([p.minMinor, p.maxMinor, p.period]).toEqual([4000, 5500, 'hour']);
    const n = normalizeSalary(p, defaultFxSnapshot());
    expect([n.minorMin, n.minorMax]).toEqual([8_320_000, 11_440_000]);
    expect(n.stated).toStrictEqual({ minorMin: 4000, minorMax: 5500, period: 'hour' });
  });
  it('flags OTE kind, never merging it with base', () => {
    expect(parseSalary('', ashby({ kind: 'ote' }))!.kind).toBe('ote');
  });
  it('handles one-sided and equal bounds', () => {
    expect(parseSalary('', ashby({ min: null, max: 100000 }))).toMatchObject({ bound: 'up_to', minMinor: null, maxMinor: 10_000_000 });
    expect(parseSalary('', ashby({ min: 100000, max: null }))).toMatchObject({ bound: 'from', minMinor: 10_000_000, maxMinor: null });
    expect(parseSalary('', ashby({ min: 90000, max: 90000 }))).toMatchObject({ bound: 'single' });
  });
  it('swaps reversed bounds and records it', () => {
    const p = parseSalary('', ashby({ min: 200000, max: 100000 }))!;
    expect([p.minMinor, p.maxMinor]).toEqual([10_000_000, 20_000_000]);
    expect(ids(p.trace)).toContain('salary.structured.swap');
  });
  it('rounds fractional majors once into minor units', () => {
    expect(parseSalary('', ashby({ min: 16.625, max: 20.1, interval: 'hour' }))!.minMinor).toBe(1663);
  });
  it('drops unusable structured data and falls back to the text parser', () => {
    const t = 'Salary: $100,000 - $120,000';
    for (const bad of [ashby({ currency: 'XYZ' }), ashby({ currency: null }), ashby({ min: 0, max: 0 }), ashby({ min: null, max: null }), ashby({ kind: 'other' })]) {
      const p = parseSalary(t, bad)!;
      expect(p.source).toBe('text');
      expect(p.minMinor).toBe(10_000_000);
    }
    expect(ids(parseSalary(t, ashby({ currency: 'XYZ' }))!.trace)).toContain('salary.currency.unsupported');
    expect(ids(parseSalary(t, ashby({ kind: 'other' }))!.trace)).toContain('salary.structured.kind_other');
  });
  it('resolves an unknown interval from the summary text', () => {
    const p = parseSalary('', ashby({ min: 40, max: 55, interval: 'unknown', summaryText: '$40 - $55 per hour' }))!;
    expect(p.period).toBe('hour');
    expect(p.periodRule).toBe('structured');
    expect(p.source).toBe('ats_structured');
  });
  it('resolves an unknown interval from the description text when the summary cannot', () => {
    const p = parseSalary('The pay range is $50 to $60 per hour.', ashby({ min: 50, max: 60, interval: 'unknown', summaryText: null }))!;
    expect(p.period).toBe('hour');
    expect(p.source).toBe('ats_structured');
  });
  it('drops the structured parse when the interval stays unknown', () => {
    const { parse, trace } = parseSalaryTraced('nothing here', ashby({ interval: 'unknown', summaryText: null }));
    expect(parse).toBeNull();
    expect(ids(trace)).toContain('salary.structured.period_unknown');
    expect(trace.outcome).toBe('null');
  });
  it('is case-insensitive about the currency code', () => {
    expect(parseSalary('', ashby({ currency: 'usd' }))!.currency).toBe('USD');
  });
});

describe('text parser: currency, numbers, ranges', () => {
  const cases: [string, string, Partial<SalaryParse>][] = [
    ['symbol range', 'Base pay: $75,000 - $135,000', { minMinor: 7_500_000, maxMinor: 13_500_000, currency: 'USD', period: 'year', bound: 'range', kind: 'base' }],
    ['k suffix', '$180K - $220K + Offers Equity', { minMinor: 18_000_000, maxMinor: 22_000_000, currency: 'USD' }],
    ['en dash no spaces', 'Annual OTE range: $200,000–$300,000 USD', { minMinor: 20_000_000, maxMinor: 30_000_000, kind: 'ote' }],
    ['space after symbol', '$ 231,000 - $340,000 USD', { minMinor: 23_100_000, maxMinor: 34_000_000 }],
    ['to', 'The base salary range for this role is $182,000 to $242,000.', { minMinor: 18_200_000, maxMinor: 24_200_000 }],
    ['cents', 'The base pay range is $196,000.00 - $312,000.50', { minMinor: 19_600_000, maxMinor: 31_200_050 }],
    ['second bound inherits symbol', 'Zone 2: Irvine, LA - $216,500 - 297,600 **', { minMinor: 21_650_000, maxMinor: 29_760_000 }],
    ['second bound inherits symbol 2', 'estimated base salary range is between $123,000-140,000 CAD.', { minMinor: 12_300_000, maxMinor: 14_000_000, currency: 'CAD' }],
    ['between and', 'expected to be between $144,000 and $193,000/year, with an expected On Target Earnings (OTE) between $288,000 - $386,000/year', { minMinor: 14_400_000, maxMinor: 19_300_000, kind: 'base' }],
    ['k inherited', 'Salary: £30k-35k', { minMinor: 3_000_000, maxMinor: 3_500_000, currency: 'GBP' }],
    ['M suffix', 'The salary is $1.2M per year', { minMinor: 120_000_000, maxMinor: 120_000_000, bound: 'single' }],
    ['EU grouping', '€73.300 — €115.900 EUR', { minMinor: 7_330_000, maxMinor: 11_590_000, currency: 'EUR' }],
    ['EU decimal comma', 'Salary €60.000,50 per year', { minMinor: 6_000_050, currency: 'EUR' }],
    ['western decimals eur', 'Germany: €91,572.20 – €102,851.53', { minMinor: 9_157_220, maxMinor: 10_285_153, currency: 'EUR' }],
    ['trailing iso', 'Compensation: 90,000 - 110,000 USD per year', { minMinor: 9_000_000, maxMinor: 11_000_000, currency: 'USD', currencyRule: 'iso_code' }],
    ['leading iso + symbol', 'The expected OTE range is USD $135,600 - $169,500.', { currency: 'USD', currencyRule: 'iso_code', kind: 'ote' }],
    ['iso both sides', 'USD 95,000 to USD 120,000 annually', { minMinor: 9_500_000, maxMinor: 12_000_000, periodRule: 'explicit' }],
    ['C$ prefix', 'C$110,000 – C$135,000', { currency: 'CAD', minMinor: 11_000_000 }],
    ['CA$ prefix', 'between CA$133,100 - CA$208,600/year', { currency: 'CAD', minMinor: 13_310_000 }],
    ['A$ prefix', 'Salary: A$150,000 - A$180,000', { currency: 'AUD' }],
    ['S$ monthly', 'S$8,000 - S$12,000 per month', { currency: 'SGD', period: 'month', minMinor: 800_000 }],
    ['AED monthly', 'AED 25,000 per month', { currency: 'AED', period: 'month', minMinor: 2_500_000 }],
    ['JPY has no minor digits', 'JPY 6,000,000 - 9,000,000 per year', { currency: 'JPY', minMinor: 6_000_000, maxMinor: 9_000_000 }],
    ['GBP stray space', 'GBR base pay range per year : £80 ,000 - 118,000', { currency: 'GBP', minMinor: 8_000_000, maxMinor: 11_800_000 }],
    ['up to', 'Salary of up to $200,000 per year', { bound: 'up_to', minMinor: null, maxMinor: 20_000_000 }],
    ['from', 'Salary from $90,000 per year', { bound: 'from', minMinor: 9_000_000, maxMinor: null }],
    ['starting at', 'Starting at $140,000', { bound: 'from', minMinor: 14_000_000 }],
    ['single with cue', 'The OTE for this position is $325,000.00', { bound: 'single', minMinor: 32_500_000, maxMinor: 32_500_000, kind: 'ote' }],
    ['no commas', 'Salary: 100000 USD', { minMinor: 10_000_000 }],
  ];
  it.each(cases)('%s', (_n, text, want) => {
    const p = parseSalary(text);
    expect(p, text).not.toBeNull();
    expect(p).toMatchObject(want);
    expect(p!.source).toBe('text');
    expect(isTrace(p!.trace)).toBe(true);
    expect(p!.evidence.length).toBeGreaterThanOrEqual(1);
    const ev = p!.evidence[0]!;
    expect(ev.source).toBe('description');
    expect(text.slice(ev.start, ev.end).startsWith(ev.quote.slice(0, 20))).toBe(true);
  });
  it('first-statement wins and the others are recorded as select steps', () => {
    const t = '$59,945 - $74,955 in Seattle, WA (hourly rate of $28.82 - $36.04)';
    const p = parseSalary(t)!;
    expect(p.minMinor).toBe(5_994_500);
    expect(p.period).toBe('year');
    expect(p.trace.steps.some((s) => s.ruleId === 'salary.select.first_base' && s.op === 'select')).toBe(true);
    expect(p.trace.steps.some((s) => s.ruleId === 'salary.select.skipped' && s.op === 'select')).toBe(true);
  });
  it('prefers the first base statement over an earlier OTE one', () => {
    const p = parseSalary('the On-Target Earnings (OTE) range is €128,000 - €162,000. The total OTE includes a base salary range of €70,400 - €89,100.')!;
    expect([p.kind, p.minMinor]).toEqual(['base', 7_040_000]);
  });
  it('falls back to the first OTE statement when only OTE is stated', () => {
    const p = parseSalary('OTE $140k')!;
    expect([p.kind, p.minMinor]).toEqual(['ote', 14_000_000]);
  });
  it('selects the statement whose location matches ctx.countries[0]', () => {
    const t = 'Salary $150,000-$180,000 for the US and CA$140,000-CA$160,000 for Canada.';
    expect(parseSalary(t)!.currency).toBe('USD');
    const p = parseSalary(t, null, { countries: ['CA'] })!;
    expect(p.currency).toBe('CAD');
    expect(p.minMinor).toBe(14_000_000);
  });
});

describe('currency disambiguation for a bare $', () => {
  const t = 'Salary $80,000 - $100,000';
  it('defaults to USD with reduced confidence and says so', () => {
    const p = parseSalary(t)!;
    expect(p.currency).toBe('USD');
    expect(p.currencyRule).toBe('symbol_default_usd');
    expect(p.confidence).toBeLessThanOrEqual(0.8);
  });
  it.each([
    [['CA'], 'CAD'],
    [['AU'], 'AUD'],
    [['SG'], 'SGD'],
    [['NZ'], 'NZD'],
    [['US', 'CA'], 'USD'],
    [['CA', 'US'], 'USD'],
    [['GB'], 'USD'],
  ])('countries %j -> %s', (countries, cur) => {
    expect(parseSalary(t, null, { countries })!.currency).toBe(cur);
  });
  it('reports symbol_by_country when a country decided it', () => {
    expect(parseSalary(t, null, { countries: ['CA'] })!.currencyRule).toBe('symbol_by_country');
  });
  it('lets a nearby CAN or Canada label decide when no context is given', () => {
    expect(parseSalary('CAN base pay range per year: $80,000 - $100,000')!.currency).toBe('CAD');
    expect(parseSalary('Canada: the pay range for this role is $129,500 - $ 178,000 per year.')!.currency).toBe('CAD');
  });
  it('does not mistake CA (California) for Canada', () => {
    expect(parseSalary('USA base pay range (CA, WA, NY) per year: $165,000 - $225,000')!.currency).toBe('USD');
  });
  it('explicit codes beat country context', () => {
    expect(parseSalary('$80,000 - $100,000 USD', null, { countries: ['CA'] })!.currency).toBe('USD');
  });
});

describe('periods', () => {
  const cases: [string, string, string][] = [
    ['per hour', 'The pay range is $50 to $60 per hour.', 'hour'],
    ['/hr', '$35/Hr USD', 'hour'],
    ['an hour', 'The base pay is: $29.74 - $39.03 an hour.', 'hour'],
    ['hourly cue before', 'the reasonably expected base hourly rate is $30.', 'hour'],
    ['/hour on both', 'US based candidates: $40/hour - $75/hour depending on factors', 'hour'],
    ['period after code', '$34-$36/hour CAD', 'hour'],
    ['per day', '£350 per day', 'day'],
    ['a day', '£350-£450 a day', 'day'],
    ['per week', '$1,200 per week', 'week'],
    ['per month', '$4,000 per month', 'month'],
    ['/month', 'Rs. 50,000 - Rs. 70,000 /month', 'month'],
    ['monthly cue', 'monthly salary of $5,000', 'month'],
    ['/yr', '$100,000/yr', 'year'],
    ['p.a.', '$100,000 p.a.', 'year'],
    ['per annum', '£45,000 - £55,000 per annum', 'year'],
    ['annually', '$100,000 annually', 'year'],
    ['per year before amount', 'USA base pay range (CA, WA) per year: $165,000 - $225,000', 'year'],
    ['annual salary cue', 'Estimated annual salary of $170,000 - $234,000.', 'year'],
  ];
  it.each(cases)('%s', (_n, text, period) => {
    const p = parseSalary(text)!;
    expect(p.period).toBe(period);
    expect(p.periodRule).toBe('explicit');
  });
  it.each([
    ['$30,000 - $40,000', 'year', 'USD'],
    ['$25 - $40', 'hour', 'USD'],
    ['Salary range: ₹40,000-60,000', 'month', 'INR'],
    ['CTC of Rs. 15,00,000', 'year', 'INR'],
  ])('magnitude: %s -> %s', (text, period, cur) => {
    const p = parseSalary(text)!;
    expect([p.period, p.currency]).toEqual([period, cur]);
    expect(p.periodRule).toBe('magnitude');
  });
  it('caps confidence for magnitude guesses that lack a pay cue', () => {
    expect(parseSalary('$25 - $40')!.confidence).toBeLessThanOrEqual(0.6);
    expect(parseSalary('$30,000 - $40,000')!.confidence).toBeLessThanOrEqual(0.6);
  });
  it('keeps every magnitude guess at or below 0.6, even after a pay label (contract 4.3)', () => {
    const p = parseSalary('Base pay: $75,000 - $135,000')!;
    expect(p.periodRule).toBe('magnitude');
    expect(p.confidence).toBeLessThanOrEqual(0.6);
    expect(p.confidence).toBeLessThan(SALARY_LLM_BELOW);
  });
  it('rejects ambiguous mid-size amounts with no period', () => {
    const { parse, trace } = parseSalaryTraced('Salary $500 - $800');
    expect(parse).toBeNull();
    expect(ids(trace)).toContain('salary.period.ambiguous');
  });
  it('gives explicit periods high confidence', () => {
    expect(parseSalary('Salary: $100,000 - $120,000 USD per year')!.confidence).toBeGreaterThanOrEqual(0.9);
  });
});

describe('Indian formats', () => {
  it('turns "18-25 LPA" into 18-25 lakh per year in paise', () => {
    const p = parseSalary('CTC: 18-25 LPA')!;
    expect(p).toMatchObject({ currency: 'INR', currencyRule: 'inr_word', period: 'year', periodRule: 'lpa_crore', minMinor: 180_000_000, maxMinor: 250_000_000, ctc: true, bound: 'range' });
    expect(ids(p.trace)).toContain('salary.num.lpa');
  });
  it.each([
    ['Salary: ₹18–25 LPA', 180_000_000, 250_000_000],
    ['Rs 6 - 9 LPA', 60_000_000, 90_000_000],
    ['Salary: 3.5 to 5 LPA', 35_000_000, 50_000_000],
    ['12 LPA to 15 LPA', 120_000_000, 150_000_000],
    ['₹8 lakh to ₹12 lakh per annum', 80_000_000, 120_000_000],
    ['Salary 8-12 lacs', 80_000_000, 120_000_000],
    ['Rs. 5 - 8 lakh per annum', 50_000_000, 80_000_000],
    ['ctc 10-12 lpa', 100_000_000, 120_000_000],
    ['INR 7.4m - 9.8m OTE', 740_000_000, 980_000_000],
  ])('%s', (text, lo, hi) => {
    const p = parseSalary(text)!;
    expect([p.minMinor, p.maxMinor]).toEqual([lo, hi]);
    expect(p.currency).toBe('INR');
  });
  it('parses crore and single lakh amounts', () => {
    expect(parseSalary('Package: 1.2 Cr per annum')).toMatchObject({ minMinor: 1_200_000_000, currency: 'INR', periodRule: 'explicit' });
    expect(parseSalary('Annual package of ₹1.5 crore')!.minMinor).toBe(1_500_000_000);
    expect(parseSalary('Rs 15 lakhs')!.minMinor).toBe(150_000_000);
    expect(parseSalary('Salary up to 1 crore')).toMatchObject({ bound: 'up_to', maxMinor: 1_000_000_000 });
    expect(ids(parseSalary('Salary up to 1 crore')!.trace)).toContain('salary.num.crore');
  });
  it('validates Indian grouping and accepts the western grouping too', () => {
    expect(parseSalary('INR 25,00,000 per annum')!.minMinor).toBe(250_000_000);
    expect(parseSalary('₹6,612,600 — ₹6,612,600 INR')!.minMinor).toBe(661_260_000);
    expect(ids(parseSalary('INR 25,00,000 per annum')!.trace)).toContain('salary.num.indian_grouping');
  });
  it('treats small INR amounts with a period as monthly', () => {
    expect(parseSalary('₹1,20,000 per month')).toMatchObject({ period: 'month', minMinor: 12_000_000 });
    expect(parseSalary('Up to ₹2,00,000 per month')).toMatchObject({ period: 'month', bound: 'up_to' });
  });
  it('sets ctc only when CTC wording is present', () => {
    expect(parseSalary('Salary: 12 LPA')!.ctc).toBe(false);
    expect(parseSalary('CTC of Rs. 15,00,000')!.ctc).toBe(true);
    expect(parseSalary('Package up to 45 LPA CTC')!.ctc).toBe(true);
  });
  it('does not read loan sizes or ticket sizes as salary', () => {
    expect(parseSalary('loan offerings ranging from ₹50,000 to ₹5 Lakh, we are enabling instant personal loans')).toBeNull();
    expect(parseSalary('Sustain an average ticket size of at least ₹15,000 by prioritising family floater')).toBeNull();
  });
});

describe('false positives are rejected with evidence', () => {
  const nulls: [string, string, string][] = [
    ['401k', 'Retirement plan: 401(k) with 100% match', 'salary.reject.401k'],
    ['401k plain', 'Generous 401k matching', 'salary.reject.401k'],
    ['funding raised', 'Nuro has raised over $2B in capital from Uber', 'salary.reject.funding'],
    ['series', 'recently raised our $1.5B Series F, led by Altimeter', 'salary.reject.funding'],
    ['valuation', 'a $5.8B valuation, more than $1 billion in annualized bookings', 'salary.reject.funding'],
    ['ARR after', 'Experience supporting complex strategic accounts generating $5M+ ARR.', 'salary.reject.funding'],
    ['ARR before', 'monthly incremental ARR targets of approximately $109,000', 'salary.reject.funding'],
    ['revenue', 'Revenue exceeding $1 billion last year', 'salary.reject.funding'],
    ['quota', 'a proven track record of closing $5M+ annual quotas', 'salary.reject.funding'],
    ['comparator', 'Achieving revenue targets >$1M per year', 'salary.reject.comparator'],
    ['equity', 'Equity worth $50,000 in RSUs vests over four years', 'salary.reject.equity'],
    ['bonus', 'A sign-on bonus of $10,000 is available', 'salary.reject.benefit'],
    ['stipend', '$75 monthly home office stipend', 'salary.reject.benefit'],
    ['stipend of', 'A weekly lunch stipend of $75/£75 or equivalent', 'salary.reject.benefit'],
    ['budget', '$1,500 annual learning and development budget', 'salary.reject.benefit'],
    ['match', 'We match up to $2000 (or local currency equivalent) for donations', 'salary.reject.benefit'],
    ['match with period', 'A 401(k) with 100% employer match (up to $6,000/year) in the U.S.', 'salary.reject.benefit'],
    ['relocation', 'Relocation assistance of up to $5,000', 'salary.reject.benefit'],
    ['hra', 'Fertility HRA (up to $10,000 per year)', 'salary.reject.benefit'],
    ['deal size', 'average deal size of $100k+', 'salary.reject.funding'],
    ['no pay cue', 'Proven success in $10M+ technical evaluations', 'salary.reject.no_pay_cue'],
    ['zero', 'Salary: $0 - $0', 'salary.reject.zero'],
    ['implausible high', 'Pay is $900,000,000 per year', 'salary.plausible.annual_range'],
    ['implausible low', 'Pay is $3 per hour', 'salary.plausible.annual_range'],
    ['project size range', 'projects will vary from $50K to $30M+', 'salary.plausible.annual_range'],
    ['malformed grouping', 'The salary range for this role is: $170,00 - $240,000', 'salary.reject.grouping'],
    ['malformed second', 'The expected OTE range for this role is $250,000 - $315,00 . The starting', 'salary.reject.grouping'],
    ['crore funding', 'We closed a ₹500 crore funding round last year', 'salary.reject.funding'],
    ['turnover', 'Turnover of ₹100 crore across 40 cities', 'salary.reject.funding'],
  ];
  it.each(nulls)('%s', (_n, text, rule) => {
    const { parse, trace } = parseSalaryTraced(text);
    expect(parse, text).toBeNull();
    expect(trace.outcome).toBe('null');
    expect(ids(trace)).toContain(rule);
    const rej = trace.steps.find((s) => s.ruleId === rule)!;
    expect(rej.op).toBe('reject');
    expect(isTrace(trace)).toBe(true);
  });
  it('401(k) rejection points at the exact span', () => {
    const text = 'Benefits: 401(k) plan';
    const { trace } = parseSalaryTraced(text);
    const ev = trace.steps.find((s) => s.ruleId === 'salary.reject.401k')!.evidence[0]!;
    expect(text.slice(ev.start, ev.end)).toBe(ev.quote);
    expect(ev.quote).toContain('401');
  });
  it('records team size, years and percent as rejected numbers', () => {
    const { parse, trace } = parseSalaryTraced('Join 3,000 employees. Looking for 5+ years of experience and 30% growth.');
    expect(parse).toBeNull();
    expect(ids(trace)).toEqual(expect.arrayContaining(['salary.reject.team_size', 'salary.reject.years', 'salary.reject.percent']));
  });
  it('keeps a real salary that sits next to equity and bonus wording', () => {
    for (const t of [
      '$279,000 to $310,000 + equity + benefits',
      'The United States base range for this position is $74,000 – $106,000 USD, plus equity. The benefits available include a 401(k) retirement plan',
      'Base pay: $149,040 - $195,615 per year. You are also eligible for equity grants and annual performance bonuses',
      'The base salary range is $188,000 to $275,000. In addition to base salary, our package includes a discretionary bonus',
      '$280K – $430K + Equity',
    ]) {
      expect(parseSalary(t), t).not.toBeNull();
    }
  });
  it('still reads a real salary when a 401k is mentioned in the same text', () => {
    const p = parseSalary('Base salary $120,000 - $150,000. Benefits include a 401(k) and health cover.')!;
    expect(p.minMinor).toBe(12_000_000);
    expect(ids(p.trace)).toContain('salary.reject.401k');
  });
  it('returns null for text with no money at all', () => {
    for (const t of ['', 'Competitive salary', 'Salary: negotiable', 'Pay: 45 - 55 per hour', 'Posted on 2026-10-15, reference ID 123456', 'Call 1-800-555-1234']) {
      expect(parseSalary(t), t).toBeNull();
    }
  });
  it('never throws on odd input', () => {
    for (const t of ['$', '$$$', '₹ LPA', '-', '$1,', '$,000', '1e999 USD', '$' + '9'.repeat(40), '\u0000$5']) {
      expect(() => parseSalary(t)).not.toThrow();
    }
  });
});

describe('OTE and CTC labels', () => {
  it.each([
    ['The OTE compensation range for this role is $178,503 - $214,203.', 'ote'],
    ['$125,000 - $145,000 OTE', 'ote'],
    ['$160K-$220K OTE + equity', 'ote'],
    ['Total target compensation $250,000 - $300,000', 'ote'],
    ['USA On Target Earnings (all other U.S. states) per year: $205,000 - $280,000', 'ote'],
    ['estimated range for total on target earnings (including base salary and on target incentive pay) for this role is $180,000 - $216,000 per year.', 'ote'],
    ['The base pay range for this role is $196,000 - $294,000', 'base'],
  ])('%s', (text, kind) => {
    expect(parseSalary(text)!.kind).toBe(kind);
  });
});

describe('normalizeSalary', () => {
  const fx = fx90;
  it('annualises with exact integer multiplication and always emits a period step', () => {
    const n = normalizeSalary(parseSalary('$4,000 per month')!, fx);
    expect([n.minorMin, n.minorMax, n.period]).toEqual([4_800_000, 4_800_000, 'year']);
    expect(ids(n.trace)).toContain('salary.period.annualise');
    const d = normalizeSalary(parseSalary('£350-£450 a day')!, fx);
    expect(d.minorMin).toBe(350_00 * 260);
    const w = normalizeSalary(parseSalary('$1,200 per week')!, fx);
    expect(w.minorMin).toBe(120_000 * 52);
  });
  it('emits salary.period.identity for yearly figures', () => {
    const n = normalizeSalary(parseSalary('Salary: $100,000 - $120,000 per year')!, fx);
    expect(ids(n.trace)).toContain('salary.period.identity');
    expect(ids(n.trace)).not.toContain('salary.period.annualise');
  });
  it('USD structured: identity for USD and a convert step for INR', () => {
    const n = normalizeSalary(parseSalary('', ashby())!, fx);
    const r = ids(n.trace);
    expect(r).toContain('salary.period.identity');
    expect(r).toContain('salary.fx.identity');
    expect(r).toContain('salary.fx.convert');
    expect(n.annualMin).toStrictEqual({ USD: 25_700_000, INR: 2_313_000_000 });
    expect(n.annualMax).toStrictEqual({ USD: 33_500_000, INR: 3_015_000_000 });
    expect(n.fxAsOf).toBe('2026-10-15');
    expect(n.fxSource).toBe('test fixture');
    expect(n.source).toBe('ats_structured');
  });
  it('LPA job: period identity, USD convert and INR identity steps', () => {
    const n = normalizeSalary(parseSalary('CTC: 18-25 LPA')!, fx);
    expect([n.minorMin, n.minorMax, n.currency]).toEqual([180_000_000, 250_000_000, 'INR']);
    expect(n.annualMin).toStrictEqual({ USD: 2_000_000, INR: 180_000_000 });
    expect(n.annualMax.USD).toBe(2_777_778);
    const r = ids(n.trace);
    expect(r).toEqual(expect.arrayContaining(['salary.num.lpa', 'salary.period.identity', 'salary.fx.convert', 'salary.fx.identity']));
    expect(n.trace.steps.map((s) => s.seq)).toEqual(n.trace.steps.map((_, i) => i));
    expect(n.trace.outcome).toBe('value');
    expect(isTrace(n.trace)).toBe(true);
  });
  it('converts cross-currency amounts to both USD and INR', () => {
    const n = normalizeSalary(parseSalary('€90,000 - €99,000 per year')!, fx);
    expect(n.annualMin.USD).toBe(10_000_000);
    expect(n.annualMin.INR).toBe(900_000_000);
  });
  it('keeps the salary but nulls an unavailable rate', () => {
    const n = normalizeSalary(parseSalary('$100,000 per year')!, { ...fx, perUsd: { USD: '1' } });
    expect(n.annualMin).toStrictEqual({ USD: 10_000_000, INR: null });
    expect(ids(n.trace)).toContain('salary.fx.missing_rate');
  });
  it('handles one-sided bounds', () => {
    const n = normalizeSalary(parseSalary('Salary of up to $200,000 per year')!, fx);
    expect(n.minorMin).toBeNull();
    expect(n.annualMin).toStrictEqual({ USD: null, INR: null });
    expect(n.annualMax.USD).toBe(20_000_000);
  });
  it('carries kind and stated period through', () => {
    const n = normalizeSalary(parseSalary('OTE $140k')!, fx);
    expect(n.kind).toBe('ote');
    expect(n.stated).toStrictEqual({ minorMin: 14_000_000, minorMax: 14_000_000, period: 'year' });
  });
  it('throws EngineInvariantError(salary.overflow) when annualising exceeds the safe range', () => {
    const base = parseSalary('$100 per hour')!;
    const big: SalaryParse = { ...base, minMinor: 2 ** 52, maxMinor: 2 ** 52 };
    expect(() => normalizeSalary(big, fx)).toThrow(EngineInvariantError);
    try {
      normalizeSalary(big, fx);
    } catch (e) {
      expect((e as EngineInvariantError).ruleId).toBe('salary.overflow');
    }
  });
  it('is deterministic and JSON safe', () => {
    const a = normalizeSalary(parseSalary('CTC: 18-25 LPA')!, fx);
    const b = normalizeSalary(parseSalary('CTC: 18-25 LPA')!, fx);
    expect(a).toStrictEqual(b);
    expect(JSON.parse(JSON.stringify(a))).toStrictEqual(a);
    const p = parseSalary('Base pay: $75,000 - $135,000')!;
    expect(JSON.parse(JSON.stringify(p))).toStrictEqual(p);
  });
  it('labels read as deterministic English with grouped money', () => {
    const n = normalizeSalary(parseSalary('₹1,50,000 per month')!, fx);
    const step = n.trace.steps.find((s) => s.ruleId === 'salary.period.annualise')!;
    expect(step.label).toBe('Monthly ₹1,50,000 × 12 = ₹18,00,000 per year');
    expect(step.inputs).toMatchObject({ period: 'month', factor: 12 });
  });
});

describe('formatSalary', () => {
  it('formats INR in lakh per year', () => {
    expect(formatSalary({ minMinor: 180_000_000, maxMinor: 250_000_000, currency: 'INR', period: 'year' })).toBe('₹18–25 L/yr');
    expect(formatSalary({ minMinor: 1_200_000_000, maxMinor: 1_200_000_000, currency: 'INR', period: 'year' })).toBe('₹1.2 Cr/yr');
    expect(formatSalary({ minMinor: 35_000_000, maxMinor: 50_000_000, currency: 'INR', period: 'year' })).toBe('₹3.5–5 L/yr');
    expect(formatSalary({ minMinor: 12_000_000, maxMinor: 20_000_000, currency: 'INR', period: 'month' })).toBe('₹1,20,000–₹2,00,000/mo');
  });
  it('formats other currencies compactly', () => {
    expect(formatSalary({ minMinor: 25_700_000, maxMinor: 33_500_000, currency: 'USD', period: 'year' })).toBe('$257K–$335K/yr');
    expect(formatSalary({ minMinor: 7_040_000, maxMinor: 10_780_000, currency: 'EUR', period: 'year' })).toBe('€70.4K–€107.8K/yr');
    expect(formatSalary({ minMinor: 4000, maxMinor: 5500, currency: 'USD', period: 'hour' })).toBe('$40–$55/hr');
    expect(formatSalary({ minMinor: null, maxMinor: 20_000_000, currency: 'USD', period: 'year' })).toBe('Up to $200K/yr');
    expect(formatSalary({ minMinor: 14_000_000, maxMinor: null, currency: 'GBP', period: 'year' })).toBe('From £140K/yr');
    expect(formatSalary({ minMinor: 6_000_000, maxMinor: 6_000_000, currency: 'JPY', period: 'year' })).toBe('¥6M/yr');
    expect(formatSalary({ minMinor: 12_000_050, maxMinor: 12_000_050, currency: 'USD', period: 'year' })).toBe('$120K/yr');
    expect(formatSalary({ minMinor: 1663, maxMinor: 2027, currency: 'USD', period: 'hour' })).toBe('$16.63–$20.27/hr');
  });
  it('uses the right words for every period', () => {
    for (const [period, suffix] of [['day', '/day'], ['week', '/wk'], ['month', '/mo'], ['year', '/yr'], ['hour', '/hr']] as const) {
      expect(formatSalary({ minMinor: 10_000, maxMinor: 10_000, currency: 'USD', period })).toMatch(new RegExp(suffix.replace('/', '\\/') + '$'));
    }
  });
});

describe('salaryCues', () => {
  it('finds cue words and currency amounts with exact offsets', () => {
    const text = 'Salary range: $100,000 - $120,000. 401(k) available. LPA 18.';
    const cues = salaryCues(text);
    expect(cues.length).toBeGreaterThanOrEqual(3);
    for (const c of cues) expect(text.slice(c.start, c.end)).toBe(c.quote);
    expect(cues.map((c) => c.quote.toLowerCase()).join('|')).toContain('salary');
    expect(cues.some((c) => c.quote.startsWith('$100,000'))).toBe(true);
  });
  it('is empty when nothing is stated and in document order', () => {
    expect(salaryCues('We build software.')).toEqual([]);
    const cues = salaryCues('pay $5 then compensation');
    expect(cues.map((c) => c.start)).toEqual([...cues.map((c) => c.start)].sort((a, b) => a - b));
  });
});

describe('determinism', () => {
  it('same input gives byte-identical output', () => {
    const t = 'Pay Transparency: The base pay for this role is: $149,040 - $195,615 per year. 401(k) too.';
    expect(JSON.stringify(parseSalary(t))).toBe(JSON.stringify(parseSalary(t)));
  });
});

describe('regressions found by auditing the full fixture set', () => {
  it('does not read a family-planning allowance as pay', () => {
    expect(parseSalary('Family planning : Up to £7,200 per year')).toBeNull();
  });
  it('keeps a salary followed by "not inclusive of potential equity"', () => {
    const p = parseSalary('The expected base pay range for this position is $60,800-$76,000 not inclusive of potential equity offering, variable or benefits.')!;
    expect([p.minMinor, p.maxMinor]).toEqual([6_080_000, 7_600_000]);
  });
  it('reads a space as a thousands separator when a currency is present', () => {
    const p = parseSalary('ESP base pay range per year: €73 000 - €109 000')!;
    expect([p.minMinor, p.maxMinor, p.currency]).toEqual([7_300_000, 10_900_000, 'EUR']);
  });
  it('reads OTEs of $500k+ as OTE', () => {
    const p = parseSalary('This role features a 50/50 compensation model, with OTEs of $500k+, designed for strong leaders')!;
    expect([p.kind, p.minMinor]).toEqual(['ote', 50_000_000]);
  });
  it('reads Rs.80,000/month where the dot belongs to Rs', () => {
    expect(parseSalary('Rs.80,000/month')).toMatchObject({ minMinor: 8_000_000, currency: 'INR', period: 'month' });
  });
  it('does not turn version-like dotted numbers into money', () => {
    expect(parseSalary('Requires Python 3.10.2 and 2.5.1')).toBeNull();
  });
});

describe('trace headroom', () => {
  it('keeps the period and FX steps when a posting has dozens of salary statements', () => {
    const zones = Array.from({ length: 40 }, (_, i) => `Zone ${i + 1}: $${100 + i},000 - $${150 + i},000`).join('\n');
    const p = parseSalary(zones)!;
    expect(p.trace.steps.length).toBeLessThanOrEqual(58);
    expect(ids(p.trace)).toContain('salary.select.skipped_more');
    const n = normalizeSalary(p, defaultFxSnapshot());
    const r = ids(n.trace);
    expect(r).toContain('salary.period.identity');
    expect(r.filter((x) => x.startsWith('salary.fx.')).length).toBeGreaterThanOrEqual(2);
    expect(r).not.toContain('trace.truncated');
    expect(isTrace(n.trace)).toBe(true);
  });
});

describe('isSalaryStated (A3: stated only with an amount)', () => {
  const parse = (min: number | null, max: number | null) => ({ minMinor: min, maxMinor: max });
  it('is false with no parse and no structured amount', () => {
    expect(isSalaryStated(null, null)).toBe(false);
    expect(isSalaryStated(undefined, undefined)).toBe(false);
  });
  it('is false for a parse that carries no amount', () => {
    expect(isSalaryStated(parse(null, null), null)).toBe(false);
    expect(isSalaryStated(parse(0, 0), null)).toBe(false);
  });
  it('is true when min or max exists', () => {
    expect(isSalaryStated(parse(100, null), null)).toBe(true);
    expect(isSalaryStated(parse(null, 100), null)).toBe(true);
  });
  it('uses structured min or max, and ignores a structured block with neither', () => {
    const sc = (min: number | null, max: number | null) => ({ min, max });
    expect(isSalaryStated(null, sc(50000, null))).toBe(true);
    expect(isSalaryStated(null, sc(null, 90000))).toBe(true);
    expect(isSalaryStated(null, sc(null, null))).toBe(false);
    expect(isSalaryStated(null, sc(0, 0))).toBe(false);
  });
  it('is not driven by a bare cue word such as "compensation"', () => {
    const text = 'Competitive compensation and equity. Benefits include health.';
    expect(salaryCues(text).length).toBeGreaterThan(0);
    expect(isSalaryStated(parseSalary(text, null, { countries: ['US'] }), null)).toBe(false);
  });
});
