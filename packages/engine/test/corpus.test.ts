import { describe, expect, it } from 'vitest';
import { loadRequirementsCorpus, loadSalaryCorpus, scoreRequirements, scoreSalary, THRESHOLDS } from '../scripts/score';

describe('corpus provenance', () => {
  it('salary corpus: header names who labelled and when, and meets the PLAN 2.2 size', () => {
    const { header, rows } = loadSalaryCorpus();
    expect(header.labelledBy).toMatch(/Claude/);
    expect(header.labelledAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rows.filter((r) => r.origin === 'fixture').length).toBeGreaterThanOrEqual(300);
    expect(rows.filter((r) => r.origin === 'hand').length).toBeGreaterThanOrEqual(60);
    expect(rows.filter((r) => r.expected).length).toBeGreaterThan(100);
    expect(rows.filter((r) => !r.expected).length).toBeGreaterThan(50);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });
  it('requirements corpus: 60 postings with a header', () => {
    const { header, rows } = loadRequirementsCorpus();
    expect(header.labelledBy).toMatch(/Claude/);
    expect(header.labelledAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rows).toHaveLength(60);
    expect(rows.every((r) => r.expected.length > 0)).toBe(true);
  });
});

describe('Phase 2 thresholds on the labelled corpora', () => {
  it('salary precision, recall and period+currency accuracy', () => {
    const s = scoreSalary(loadSalaryCorpus().rows);
    expect(s.precision, JSON.stringify(s.misses.slice(0, 12), null, 1)).toBeGreaterThanOrEqual(THRESHOLDS.salaryPrecision);
    expect(s.recall, JSON.stringify(s.misses.slice(0, 12), null, 1)).toBeGreaterThanOrEqual(THRESHOLDS.salaryRecall);
    expect(s.periodCurrencyAccuracy).toBeGreaterThanOrEqual(THRESHOLDS.salaryPeriodCurrency);
  });
  it('requirements must/nice F1', () => {
    const r = scoreRequirements(loadRequirementsCorpus().rows);
    expect(r.f1, JSON.stringify(r.misses.slice(0, 12), null, 1)).toBeGreaterThanOrEqual(THRESHOLDS.requirementsF1);
  });
});

describe('scorers detect regressions', () => {
  it('a parser that returns nothing has zero recall and perfect precision', () => {
    const s = scoreSalary(loadSalaryCorpus().rows, () => null);
    expect(s.recall).toBe(0);
    expect(s.precision).toBe(1);
    expect(s.misses.every((m) => m.kind === 'false_negative')).toBe(true);
  });
  it('a parser that always answers has low precision', () => {
    const s = scoreSalary(loadSalaryCorpus().rows, () => ({ source: 'text', kind: 'base', ctc: false, currency: 'USD', currencyRule: 'symbol', period: 'year', periodRule: 'explicit', bound: 'single', minMinor: 1, maxMinor: 1, confidence: 1, evidence: [], trace: { engineVersion: '1.0.0', subject: 'salary', outcome: 'value', steps: [] } }));
    expect(s.precision).toBeLessThan(0.1);
  });
  it('requirements scoring ignores spacing and punctuation but not kind', () => {
    const rows = loadRequirementsCorpus().rows.slice(0, 3);
    const perfect = scoreRequirements(rows, () => ({ sections: [], lowConfidence: false, trace: { engineVersion: '1.0.0', subject: 'requirements', outcome: 'value', steps: [] }, requirements: [] }));
    expect(perfect.recall).toBe(0);
  });
});
