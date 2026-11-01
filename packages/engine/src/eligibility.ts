/** Eligibility engine (Slice 1, Amendment B section 8). Pure. Fail blocks; unknown never does. */
export { parseCriteria } from './eligibility/criteria';
export { evaluateEligibility } from './eligibility/evaluate';
export type { EvaluateOptions } from './eligibility/evaluate';
export { applyCgpaRule, invertCgpaRule } from './eligibility/cgpa';
export { canonDegree, canonBranch } from './eligibility/criteria';
export { universityRules, findUniversityRule, toCgpaRule, resolveUniversityRule } from './eligibility/university';
export type { UniversityRule } from './eligibility/university';
