import { runPicksEval, summarize } from './eval';

const { ok, lines } = summarize(runPicksEval());
for (const l of lines) console.log(l);
if (!ok) {
  console.error('picks:eval FAILED');
  process.exit(1);
}
console.log('picks:eval passed');
