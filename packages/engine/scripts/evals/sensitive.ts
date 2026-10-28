/** engine:eval hook: sensitive-data detection. Gate: Aadhaar/PAN recall 1.0, 0 false positives, >= 40 negatives. */
import { readFileSync } from 'node:fs';
import { detectSensitive } from '../../src/resume/sensitive';
import type { SensitiveKind } from '../../src/resume/types';

const MIN_NEGATIVES = 40;
type Row = { id: string; text: string; kinds: SensitiveKind[] };
const ID_KINDS = new Set<SensitiveKind>(['aadhaar', 'aadhaar_masked', 'vid', 'pan']);

export default {
  name: 'sensitive  (test/corpus/sensitive.labelled.jsonl)',
  run() {
    const raw = readFileSync(new URL('../../test/corpus/sensitive.labelled.jsonl', import.meta.url), 'utf8');
    const rows = raw.split('\n').filter((l) => l.trim()).slice(1).map((l) => JSON.parse(l) as Row);
    const got = (r: Row) => new Set(detectSensitive(r.text).map((f) => f.kind));
    const wanted = (r: Row) => r.kinds.filter((k) => k === 'aadhaar' || k === 'pan');
    const pos = rows.filter((r) => wanted(r).length > 0);
    let found = 0;
    let expected = 0;
    const missed: string[] = [];
    for (const r of pos) {
      const g = got(r);
      for (const k of wanted(r)) {
        expected++;
        if (g.has(k)) found++;
        else missed.push(`${r.id}:${k}`);
      }
    }
    const recall = expected ? found / expected : 0;
    const neg = rows.filter((r) => r.kinds.length === 0);
    const fpIds = [
      ...neg.filter((r) => got(r).size > 0).map((r) => r.id),
      ...rows.filter((r) => r.kinds.length > 0 && [...got(r)].some((k) => ID_KINDS.has(k) && !r.kinds.includes(k))).map((r) => r.id),
    ];
    const ok = recall === 1 && fpIds.length === 0 && neg.length >= MIN_NEGATIVES && pos.length > 0;
    return {
      ok,
      lines: [
        `Aadhaar/PAN recall ${(recall * 100).toFixed(2)}% (${found}/${expected}, must be 100%)${missed.length ? ' missed: ' + missed.join(', ') : ''}`,
        `false positives ${fpIds.length} (must be 0) over ${neg.length} negatives (>= ${MIN_NEGATIVES})${fpIds.length ? ': ' + fpIds.join(', ') : ''}`,
      ],
    };
  },
};
