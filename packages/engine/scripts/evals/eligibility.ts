/** engine:eval hook: drive-criteria parsing and verdicts. Gate: criterion accuracy >= 0.90, 0 unknown->fail. */
import { readFileSync } from 'node:fs';
import { evaluateEligibility, parseCriteria } from '../../src/eligibility';
import type { CgpaRule, Criterion, EligibilityProfileInput, VerdictStatus } from '../../src/eligibility/types';

const MIN_ACCURACY = 0.9;
interface Row {
  id: string;
  text: string;
  criteria: string[];
  evals?: { profile: EligibilityProfileInput; cgpaRule: CgpaRule; expect: Record<string, VerdictStatus> }[];
}

const num = (n: number | undefined): string => (n === undefined || !Number.isFinite(n) ? '-' : String(n));
/** Canonical, offset-free key; the format the corpus labels use. */
function keyOf(c: Criterion): string {
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

export default {
  name: 'eligibility  (test/corpus/drive-criteria.labelled.jsonl)',
  run() {
    const raw = readFileSync(new URL('../../test/corpus/drive-criteria.labelled.jsonl', import.meta.url), 'utf8');
    const rows = raw.split('\n').filter(Boolean).slice(1).map((l) => JSON.parse(l) as Row);
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const r of rows) {
      const got = new Set(parseCriteria(r.text).map(keyOf));
      for (const w of r.criteria) got.has(w) ? tp++ : fn++;
      for (const g of got) if (!r.criteria.includes(g)) fp++;
    }
    const accuracy = tp + fp + fn ? tp / (tp + fp + fn) : 0;

    let verdicts = 0;
    let wrong = 0;
    let unknownToFail = 0;
    for (const r of rows) {
      for (const e of r.evals ?? []) {
        const res = evaluateEligibility(parseCriteria(r.text), e.profile, { cgpaRule: e.cgpaRule });
        for (const [key, want] of Object.entries(e.expect)) {
          verdicts++;
          const got = res.verdicts.find((v) => keyOf(v.criterion) === key)?.status ?? 'missing';
          if (got !== want) wrong++;
          if (want === 'unknown' && got === 'fail') unknownToFail++;
        }
      }
    }
    const ok = rows.length > 0 && verdicts > 0 && accuracy >= MIN_ACCURACY && unknownToFail === 0;
    return {
      ok,
      lines: [
        `${rows.length} notices: criterion accuracy ${(accuracy * 100).toFixed(2)}% (tp ${tp}, spurious ${fp}, missed ${fn}) (>= ${MIN_ACCURACY * 100}%)`,
        `${verdicts} labelled verdicts: ${wrong} wrong; unknown->fail ${unknownToFail} (must be 0)`,
      ],
    };
  },
};
