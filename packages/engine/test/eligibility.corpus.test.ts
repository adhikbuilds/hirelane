import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateEligibility, parseCriteria } from '../src/eligibility';
import type { CgpaRule, Criterion, EligibilityProfileInput, VerdictStatus } from '../src/eligibility/types';

interface EvalCase {
  profile: EligibilityProfileInput;
  cgpaRule: CgpaRule;
  expect: Record<string, VerdictStatus>;
}
interface Row {
  id: string;
  text: string;
  criteria: string[];
  evals?: EvalCase[];
}

const here = dirname(fileURLToPath(import.meta.url));
const lines = readFileSync(join(here, 'corpus', 'drive-criteria.labelled.jsonl'), 'utf8').split('\n').filter(Boolean);
const header = (JSON.parse(lines[0]!) as { _header: { labelledBy: string; labelledAt: string; count: number } })._header;
const rows = lines.slice(1).map((l) => JSON.parse(l) as Row);

const num = (n: number | undefined): string => (n === undefined || !Number.isFinite(n) ? '-' : String(n));
/** Canonical, offset-free key; the same format the corpus labels use. */
export function keyOf(c: Criterion): string {
  switch (c.type) {
    case 'min_score':
      return `min|${[...c.levels].sort().join(',')}|${num(c.pct)}|${num(c.cgpa)}|${c.throughout ? 'T' : 'F'}`;
    case 'no_active_backlogs':
      return 'nobl';
    case 'max_backlog_history':
      return `blh|${c.n}`;
    case 'passout_years':
      return `yr|${[...c.years].sort((a, b) => a - b).join(',')}`;
    case 'degrees':
      return `deg|${[...c.list].sort().join(',')}`;
    case 'branches':
      return `br|${[...c.list].sort().join(',')}`;
    case 'max_gap_years':
      return `gap|${c.n}`;
  }
}

describe('drive-criteria corpus provenance', () => {
  it('has a header, at least 80 unique lines and some negatives', () => {
    expect(header.labelledBy).toMatch(/Claude/);
    expect(header.labelledAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rows.length).toBeGreaterThanOrEqual(80);
    expect(header.count).toBe(rows.length);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect(rows.filter((r) => r.criteria.length === 0).length).toBeGreaterThanOrEqual(10);
    expect(rows.filter((r) => r.evals?.length).length).toBeGreaterThanOrEqual(20);
  });
  it('is synthetic: no emails, long digit runs or capitalised company-style names from the brief', () => {
    const blob = rows.map((r) => r.text).join('\n');
    expect(blob).not.toMatch(/@|\d{10}/);
    expect(blob).not.toMatch(/\b(TCS|Infosys|Capgemini|Deloitte|IBM|LTIMindtree)\b/i);
  });
});

describe('parseCriteria on the labelled corpus', () => {
  it('criterion accuracy >= 0.90, counting spurious criteria as errors', () => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    const misses: unknown[] = [];
    for (const r of rows) {
      const got = parseCriteria(r.text).map(keyOf);
      const want = [...r.criteria];
      const gotSet = new Set(got);
      for (const w of want) {
        if (gotSet.has(w)) tp++;
        else {
          fn++;
          misses.push({ id: r.id, text: r.text, missing: w, got });
        }
      }
      for (const g of got) {
        if (!want.includes(g)) {
          fp++;
          misses.push({ id: r.id, text: r.text, spurious: g, want });
        }
      }
    }
    const accuracy = tp / (tp + fp + fn);
    expect(accuracy, JSON.stringify(misses.slice(0, 15), null, 1)).toBeGreaterThanOrEqual(0.9);
  });

  it('negative lines produce no criteria', () => {
    const bad = rows.filter((r) => r.criteria.length === 0 && parseCriteria(r.text).length > 0).map((r) => r.text);
    expect(bad).toEqual([]);
  });

  it('evidence offsets point at the matched text', () => {
    for (const r of rows) {
      for (const c of parseCriteria(r.text)) {
        expect(c.evidence.length).toBeGreaterThan(0);
        for (const e of c.evidence) {
          expect(e.start).toBeGreaterThanOrEqual(0);
          expect(e.end).toBeGreaterThan(e.start);
          expect(e.end).toBeLessThanOrEqual(r.text.length);
        }
      }
    }
  });
});

describe('evaluateEligibility on the labelled verdicts', () => {
  const cases = rows.flatMap((r) => (r.evals ?? []).map((e, i) => ({ r, e, i })));
  it('has verdict labels of every status', () => {
    const all = cases.flatMap((c) => Object.values(c.e.expect));
    for (const s of ['pass', 'fail', 'unknown'] as const) expect(all).toContain(s);
  });
  it('matches every labelled verdict, and never fails where the label is unknown', () => {
    let wrong = 0;
    let unknownButFail = 0;
    let total = 0;
    const misses: unknown[] = [];
    for (const { r, e, i } of cases) {
      const criteria = parseCriteria(r.text);
      const res = evaluateEligibility(criteria, e.profile, { cgpaRule: e.cgpaRule });
      for (const [key, want] of Object.entries(e.expect)) {
        total++;
        const v = res.verdicts.find((x) => keyOf(x.criterion) === key);
        const got = v?.status ?? 'missing';
        if (got !== want) {
          wrong++;
          misses.push({ id: r.id, i, key, want, got, reason: v?.reason });
        }
        if (want === 'unknown' && got === 'fail') unknownButFail++;
      }
    }
    expect(total).toBeGreaterThan(60);
    expect(unknownButFail).toBe(0);
    expect(wrong, JSON.stringify(misses.slice(0, 15), null, 1)).toBe(0);
  });
});
