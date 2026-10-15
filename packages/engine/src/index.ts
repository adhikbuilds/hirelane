export const x=1

// --- foundation, salary and requirements (task 2.2, 2.3, 2.5)
export { ENGINE_VERSION, ENRICH_VERSION, DOC_FORMAT_VERSION } from './version';
export type { Ats, CountryCode, JsonValue } from './types';
export { EngineInvariantError } from './errors';
export { isTrace, isJsonSafe, evidence, TraceBuilder, MAX_TRACE_STEPS } from './trace';
export type { Trace, CalculationStep, Evidence, EvidenceSource, StepOp, TraceSubject, StepInput } from './trace';
export { toDoc, docFromText, fnv1a64, decodeEntities } from './text';
export type { Doc, Block, BlockKind } from './text';
export { CURRENCY_EXPONENT, CURRENCY_SYMBOL, isIso4217 } from './currency';
export type { Iso4217 } from './currency';
export { defaultFxSnapshot, convertMinor, parseRate, validateFx } from './fx';
export type { FxSnapshot, FxConversion } from './fx';
export {
  ANNUAL_FACTOR,
  SALARY_LLM_BELOW,
  parseSalary,
  parseSalaryTraced,
  normalizeSalary,
  salaryCues,
  formatSalary,
  formatMoney,
} from './salary';
export type { PayPeriod, StructuredComp, SalaryContext, SalaryParse, SalaryTraced, NormalizedSalary, AnnualPair, CurrencyRule, SalaryFormatInput } from './salary';
export { extractRequirements, parseYearsMin, classifyHeading } from './requirements';
export type { ReqKind, ReqCategory, SectionKind, Section, Requirement, RequirementsResult, SkillAnnotator } from './requirements';

// --- skills, places, classifiers and dedup (task 2.4, 2.6, dedup part of 2.1/2.2)
export {
  adjacency,
  compileSkills,
  defaultSkillIndex,
  extractSkills,
  hasSkill,
  skillCategory,
  skillIdsInRange,
  skillLabel,
  skillOccurrences,
} from './skills';
export type { SkillCategory, SkillDef, SkillIndex, SkillHit, SkillExtraction, SkillOccurrence } from './skills';
export { REGION_MEMBERS, defaultPlaceIndex, isKnownPlace, normPlace, resolveCountries } from './places';
export type { PlaceIndex, Region, LocationResolution, CountryResolution } from './places';
export {
  LEVELS,
  ROLE_FAMILIES,
  classifyEmployment,
  classifyLevel,
  classifyRoleFamily,
  classifyWorkplace,
  detectVisa,
  levelDistance,
  toPublicLevel,
} from './classify';
export type { ClassifyInput, Classified, Level, Workplace, Employment, RoleFamily, Visa } from './classify';
export {
  DEDUP_MAX_HAMMING,
  DEDUP_MIN_TOKENS,
  SHINGLE_SIZE,
  canonicalTitle,
  countTokens,
  dedupKeyFor,
  dedupMatch,
  hamming,
  isoToEpochMs,
  parseDedupPairs,
  pickPrimary,
  scoreDedupPairs,
  simhash64,
  simhashFromPg,
  simhashTokens,
} from './dedup';
export type { CanonicalTitle, ClusterMember, DedupDecision, DedupKey, DedupPair, DedupPairSide, DedupScore, Simhash } from './dedup';
