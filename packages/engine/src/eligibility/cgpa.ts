/** CGPA to percentage conversion. The only source is a campus rule (campuses.cgpa_rule); no rule means no conversion. */
import type { CgpaRule } from './types';

const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** pct = a * cgpa + b, clamped to [0, 100]. null when there is no rule or any input is unusable. */
export function applyCgpaRule(cgpa: number, rule: CgpaRule | undefined): number | null {
  if (!rule || rule.kind !== 'linear' || !fin(cgpa) || !fin(rule.a) || !fin(rule.b)) return null;
  const pct = rule.a * cgpa + rule.b;
  return Math.min(100, Math.max(0, pct));
}

/** Inverse of applyCgpaRule, for a percentage student against a CGPA notice. Needs a > 0. */
export function invertCgpaRule(pct: number, rule: CgpaRule | undefined): number | null {
  if (!rule || rule.kind !== 'linear' || !fin(pct) || !fin(rule.a) || !fin(rule.b) || rule.a <= 0) return null;
  return (pct - rule.b) / rule.a;
}
