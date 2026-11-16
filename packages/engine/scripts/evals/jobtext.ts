/** engine:eval hook: pasted-job parsing. Gate: title, company and criteria accuracy >= 0.90. */
import { readFileSync } from 'node:fs';
import { JOBTEXT_THRESHOLDS, scorePastedJobs } from '../../src/jobtext/score';

const pct = (x: number) => (x * 100).toFixed(2) + '%';

export default {
  name: 'jobtext  (test/corpus/pasted-jobs.labelled.jsonl)',
  run() {
    const s = scorePastedJobs(readFileSync(new URL('../../test/corpus/pasted-jobs.labelled.jsonl', import.meta.url), 'utf8'));
    const min = JOBTEXT_THRESHOLDS.fieldAccuracy;
    const gated = [s.title, s.company, s.criteria];
    const ok = s.rows >= 60 && gated.every((x) => x >= min);
    const styles = Object.entries(s.byStyle).map(([k, v]) => `${k} ${v}`).join(', ');
    const miss = [...s.misses.title, ...s.misses.company, ...s.misses.criteria].slice(0, 8);
    return {
      ok,
      lines: [
        `${s.rows} pasted jobs (${styles}); gate >= ${pct(min)} on each of title, company, criteria`,
        `title ${pct(s.title)}  company ${pct(s.company)}  criteria ${pct(s.criteria)}  (info: source ${pct(s.source)}, fresher ${pct(s.fresher)}, location ${pct(s.location)})`,
        ...miss.map((m) => '  miss ' + m),
      ],
    };
  },
};
