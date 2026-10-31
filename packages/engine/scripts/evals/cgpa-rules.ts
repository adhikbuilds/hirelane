/**
 * engine:eval hook: per-university CGPA rule table (PRD E5).
 * Gates: >= 25 rows; each has formula, source_url, checked_on; each converts its own example; no verified row without a
 * fetched check; an unverified rule is used 0 times without confirmation; no rule means unknown.
 */
import { applyCgpaRule } from '../../src/eligibility/cgpa';
import { evaluateEligibility, parseCriteria } from '../../src/eligibility';
import { toCgpaRule, universityRules } from '../../src/eligibility/university';

const MIN_ROWS = 25;

export default {
  name: 'cgpa-rules  (data/cgpa-rules.json)',
  run() {
    const rows = universityRules();
    const problems: string[] = [];
    for (const r of rows) {
      if (!r.formula || !/^https:\/\//.test(r.source_url) || !/^\d{4}-\d{2}-\d{2}$/.test(r.checked_on)) problems.push(`${r.id}: missing formula, source_url or checked_on`);
      const got = applyCgpaRule(r.example.cgpa, toCgpaRule(r));
      if (got === null || Math.abs(got - r.example.pct) > 0.01) problems.push(`${r.id}: example does not convert`);
      if (r.verified && !r.check_method.startsWith('fetched')) problems.push(`${r.id}: verified without a fetched check`);
    }
    const crit = parseCriteria('Minimum 40% aggregate in graduation');
    let used = 0;
    let unknownOk = 0;
    for (const r of rows) {
      const prof = { grad_score: 8, grad_scale: 10 as const, confirmed: true as const };
      const v = evaluateEligibility(crit, prof, { cgpaRule: null, universityRule: r }).verdicts[0]!.status;
      if (!r.verified && v !== 'unknown') used++;
      if (!r.verified && v === 'unknown') unknownOk++;
      if (r.verified && v === 'unknown') problems.push(`${r.id}: verified rule not used`);
      const c = evaluateEligibility(crit, prof, { cgpaRule: null, universityRule: r, universityRuleConfirmed: true }).verdicts[0]!.status;
      if (c === 'unknown') problems.push(`${r.id}: confirmed rule not used`);
    }
    const none = evaluateEligibility(crit, { grad_score: 8, grad_scale: 10, confirmed: true }, { cgpaRule: null }).verdicts[0]!.status;
    if (none !== 'unknown') problems.push('no rule did not give unknown');
    const unverified = rows.filter((r) => !r.verified).length;
    const ok = rows.length >= MIN_ROWS && problems.length === 0 && used === 0;
    return {
      ok,
      lines: [
        `${rows.length} universities (gate >= ${MIN_ROWS}); verified ${rows.length - unverified}, unverified ${unverified} (need student or campus confirmation)`,
        `unverified rules used without confirmation ${used} (must be 0); unknown without rule ${unknownOk}/${unverified}; problems ${problems.length}`,
        ...problems.slice(0, 8).map((p) => '  ' + p),
      ],
    };
  },
};
