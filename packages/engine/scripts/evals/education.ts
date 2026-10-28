/** engine:eval hook: education field accuracy on the labelled snippets and full resumes. Gate: >= 0.90 each. */
import { readFileSync } from 'node:fs';
import { parseEducation } from '../../src/resume/education';
import { normalizeResumeText } from '../../src/resume/sections';
import type { Backlogs, EducationEntry } from '../../src/resume/types';

const MIN_ACCURACY = 0.9;
type Row = { id: string; text: string; education: Omit<EducationEntry, 'evidence'>[]; backlogs: Backlogs; lateralEntry: boolean };

function load(name: string): Row[] {
  const raw = readFileSync(new URL(`../../test/corpus/${name}`, import.meta.url), 'utf8');
  return raw.split('\n').filter((l) => l.trim()).slice(1).map((l) => JSON.parse(l) as Row);
}

function score(rows: Row[]) {
  let ok = 0;
  let total = 0;
  const misses: string[] = [];
  const cmp = (id: string, field: string, got: unknown, want: unknown) => {
    total++;
    if (JSON.stringify(got) === JSON.stringify(want)) ok++;
    else misses.push(`${id} ${field}`);
  };
  for (const r of rows) {
    const res = parseEducation(normalizeResumeText(r.text));
    for (const want of r.education) {
      const got = res.entries.find((e) => e.level === want.level);
      for (const f of ['board', 'score', 'startYear', 'passoutYear', 'degree', 'branch', 'confidence'] as const) cmp(r.id, `${want.level}.${f}`, got ? got[f] : '<missing>', want[f]);
    }
    for (const e of res.entries) {
      if (!r.education.some((w) => w.level === e.level)) {
        total++;
        misses.push(`${r.id} extra entry ${e.level}`);
      }
    }
    cmp(r.id, 'backlogs.active', res.backlogs.active, r.backlogs.active);
    cmp(r.id, 'backlogs.history', res.backlogs.history, r.backlogs.history);
    cmp(r.id, 'lateralEntry', res.lateralEntry, r.lateralEntry);
  }
  return { rows: rows.length, ok, total, accuracy: total ? ok / total : 0, misses };
}

export default {
  name: 'education  (test/corpus/education.labelled.jsonl, resumes.synthetic.jsonl)',
  run() {
    let allOk = true;
    const lines: string[] = [];
    for (const file of ['education.labelled.jsonl', 'resumes.synthetic.jsonl']) {
      const s = score(load(file));
      const ok = s.rows > 0 && s.accuracy >= MIN_ACCURACY;
      allOk &&= ok;
      lines.push(`${file}: ${s.rows} rows, field accuracy ${(s.accuracy * 100).toFixed(2)}% (${s.ok}/${s.total}) (>= ${MIN_ACCURACY * 100}%)  ${ok ? 'PASS' : 'FAIL'}`);
      for (const m of s.misses.slice(0, 10)) lines.push(`  miss ${m}`);
    }
    return { ok: allOk, lines };
  },
};
