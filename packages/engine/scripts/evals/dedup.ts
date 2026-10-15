/** engine:eval hook: same-role dedup on the 200 labelled pairs. Gate: 0 false merges, recall >= 0.9. */
import { readFileSync } from 'node:fs';
import { parseDedupPairs, scoreDedupPairs } from '../../src/dedup';

const MIN_RECALL = 0.9;

export default {
  name: 'dedup  (test/corpus/dedup.pairs.jsonl)',
  run() {
    const raw = readFileSync(new URL('../../test/corpus/dedup.pairs.jsonl', import.meta.url), 'utf8');
    const s = scoreDedupPairs(parseDedupPairs(raw));
    const ok = s.falseMerges === 0 && s.recall >= MIN_RECALL;
    return {
      ok,
      lines: [
        `${s.total} pairs: false merges ${s.falseMerges} (must be 0), recall ${(s.recall * 100).toFixed(2)}% (>= ${MIN_RECALL * 100}%), precision ${(s.precision * 100).toFixed(2)}%`,
        ...(s.falseMergeIds.length ? [`false merges: ${s.falseMergeIds.join(', ')}`] : []),
      ],
    };
  },
};
