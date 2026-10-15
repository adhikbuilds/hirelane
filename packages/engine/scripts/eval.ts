/**
 * engine:eval. Scores the deterministic engine on the labelled corpora and exits non-zero below the
 * Phase 2 thresholds. Other lanes register evaluators in `scripts/evals/*.ts` (default export
 * `{ name, run(): { lines: string[]; ok: boolean } }`); they are picked up automatically.
 */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRequirementsCorpus, loadSalaryCorpus, scoreRequirements, scoreSalary, THRESHOLDS } from './score';

const pct = (x: number) => (x * 100).toFixed(2) + '%';
const mark = (ok: boolean) => (ok ? 'PASS' : 'FAIL');
let allOk = true;

const sal = loadSalaryCorpus();
const s = scoreSalary(sal.rows);
const salOk = s.precision >= THRESHOLDS.salaryPrecision && s.recall >= THRESHOLDS.salaryRecall && s.periodCurrencyAccuracy >= THRESHOLDS.salaryPeriodCurrency;
allOk &&= salOk;
console.log(`salary  (${s.rows} snippets, ${s.expectedPositives} stated; labelled ${sal.header.labelledAt} by ${sal.header.labelledBy})`);
console.log(`  precision ${pct(s.precision)}  (>= ${pct(THRESHOLDS.salaryPrecision)})  ${mark(s.precision >= THRESHOLDS.salaryPrecision)}`);
console.log(`  recall    ${pct(s.recall)}  (>= ${pct(THRESHOLDS.salaryRecall)})  ${mark(s.recall >= THRESHOLDS.salaryRecall)}`);
console.log(`  period+currency accuracy ${pct(s.periodCurrencyAccuracy)}  (>= ${pct(THRESHOLDS.salaryPeriodCurrency)})  ${mark(s.periodCurrencyAccuracy >= THRESHOLDS.salaryPeriodCurrency)}`);
for (const m of s.misses.slice(0, 10)) console.log(`    ${m.kind} ${m.id}: ${m.text} -> ${JSON.stringify(m.got)} (expected ${JSON.stringify(m.expected && { min: m.expected.minMinor, max: m.expected.maxMinor, cur: m.expected.currency, per: m.expected.period, kind: m.expected.kind })})`);

const req = loadRequirementsCorpus();
const r = scoreRequirements(req.rows);
const reqOk = r.f1 >= THRESHOLDS.requirementsF1;
allOk &&= reqOk;
console.log(`requirements  (${r.postings} postings, ${r.expected} labelled items; labelled ${req.header.labelledAt} by ${req.header.labelledBy})`);
console.log(`  micro F1 ${pct(r.f1)}  (>= ${pct(THRESHOLDS.requirementsF1)})  ${mark(reqOk)}   P ${pct(r.precision)}  R ${pct(r.recall)}   must F1 ${pct(r.mustF1)}  nice F1 ${pct(r.niceF1)}`);
for (const m of r.misses.slice(0, 10)) console.log(`    ${m.kind} ${m.id}: ${m.item}`);

const evalsDir = join(dirname(fileURLToPath(import.meta.url)), 'evals');
let files: string[] = [];
try {
  files = readdirSync(evalsDir).filter((f) => f.endsWith('.ts')).sort();
} catch {
  files = [];
}
for (const f of files) {
  const mod = (await import(join(evalsDir, f))) as { default: { name: string; run: () => { lines: string[]; ok: boolean } | Promise<{ lines: string[]; ok: boolean }> } };
  const res = await mod.default.run();
  allOk &&= res.ok;
  console.log(`${mod.default.name}  ${mark(res.ok)}`);
  for (const l of res.lines) console.log('  ' + l);
}

console.log(allOk ? '\nengine:eval PASS' : '\nengine:eval FAIL');
process.exit(allOk ? 0 : 1);
