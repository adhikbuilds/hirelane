/**
 * engine:eval hook: per-university CGPA rule table (PRD E5).
 * Gates: >= 25 rows; each has formula, source_url, checked_on; each converts its own example; no verified row without a
 * fetched check; an unverified rule is used 0 times without confirmation; no rule means unknown.
 * v2 (2026-10-31): a scheme-keyed row (VTU) must be unknown without a scheme, and usable for every scheme it names; a disputed
 * row (Mumbai) must be unknown even when confirmed. Neither is a "confirmed rule not used" problem.
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
      if (r.variants) {
        if (toCgpaRule(r) !== null) problems.push(`${r.id}: scheme-keyed row converts without a scheme`);
        for (const v of r.variants) {
          const g = applyCgpaRule(v.example.cgpa, { kind: 'linear', a: v.a, b: v.b });
          if (g === null || Math.abs(g - v.example.pct) > 0.01) problems.push(`${r.id}/${v.id}: example does not convert`);
        }
      } else if (r.disputed) {
        if (toCgpaRule(r) !== null) problems.push(`${r.id}: disputed row converts`);
      } else {
        const got = applyCgpaRule(r.example.cgpa, toCgpaRule(r));
        if (got === null || Math.abs(got - r.example.pct) > 0.01) problems.push(`${r.id}: example does not convert`);
      }
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
      if (r.verified && v === 'unknown' && !r.disputed && !r.variants) problems.push(`${r.id}: verified rule not used`);
      const c = evaluateEligibility(crit, prof, { cgpaRule: null, universityRule: r, universityRuleConfirmed: true }).verdicts[0]!.status;
      if (r.disputed || r.variants) {
        // Confirming cannot supply a scheme or revive a disputed rule.
        if (c !== 'unknown') problems.push(`${r.id}: ${r.disputed ? 'disputed' : 'scheme-keyed'} rule gave a verdict without what it needs`);
        for (const v of r.variants ?? []) {
          for (const scheme of v.schemes) {
            const cs = evaluateEligibility(crit, prof, { cgpaRule: null, universityRule: r, universityRuleConfirmed: true, universityScheme: scheme }).verdicts[0]!.status;
            if (cs === 'unknown') problems.push(`${r.id}: scheme ${scheme} not used`);
          }
        }
      } else if (c === 'unknown') problems.push(`${r.id}: confirmed rule not used`);
    }
    const none = evaluateEligibility(crit, { grad_score: 8, grad_scale: 10, confirmed: true }, { cgpaRule: null }).verdicts[0]!.status;
    if (none !== 'unknown') problems.push('no rule did not give unknown');
    const schemeKeyed = rows.filter((r) => r.variants).length;
    const disputed = rows.filter((r) => r.disputed).length;
    const unverified = rows.filter((r) => !r.verified).length;
    const ok = rows.length >= MIN_ROWS && problems.length === 0 && used === 0;
    return {
      ok,
      lines: [
        `${rows.length} universities (gate >= ${MIN_ROWS}); verified ${rows.length - unverified}, unverified ${unverified} (need student or campus confirmation)`,
        `scheme-keyed ${schemeKeyed} (unknown without a scheme), disputed ${disputed} (unknown even when confirmed)`,
        `unverified rules used without confirmation ${used} (must be 0); unknown without rule ${unknownOk}/${unverified}; problems ${problems.length}`,
        ...problems.slice(0, 8).map((p) => '  ' + p),
      ],
    };
  },
};
