/**
 * engine:eval hook: scam signals. Gate: recall >= 0.95 on scam lines, false positives <= 5% on legit lines.
 * "Flagged" means risk >= medium (a lone urgency phrase is low and never flags).
 */
import { readFileSync } from 'node:fs';
import { JOBTEXT_THRESHOLDS, scoreScamCorpus } from '../../src/jobtext/score';

const pct = (x: number) => (x * 100).toFixed(2) + '%';

export default {
  name: 'scam  (test/corpus/scam.labelled.jsonl)',
  run() {
    const s = scoreScamCorpus(readFileSync(new URL('../../test/corpus/scam.labelled.jsonl', import.meta.url), 'utf8'));
    const ok = s.total >= 50 && s.recall >= JOBTEXT_THRESHOLDS.scamRecall && s.fpRate <= JOBTEXT_THRESHOLDS.scamFalsePositiveRate;
    return {
      ok,
      lines: [
        `${s.total} lines (${s.scam} scam, ${s.legit} legit): recall ${pct(s.recall)} (>= ${pct(JOBTEXT_THRESHOLDS.scamRecall)}), false positives ${pct(s.fpRate)} (<= ${pct(JOBTEXT_THRESHOLDS.scamFalsePositiveRate)}), expected-signal recall ${pct(s.signalRecall)}`,
        ...(s.missed.length ? [`missed: ${s.missed.join(', ')}`] : []),
        ...(s.falsePositives.length ? [`false positives: ${s.falsePositives.join(', ')}`] : []),
      ],
    };
  },
};
