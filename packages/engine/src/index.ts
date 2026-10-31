
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
  isSalaryStated,
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

// --- A4 fresher flag and A8 worthwhile gate
export { assessFresher, FRESHER_MAX_LOWER_YEARS, FRESHER_MAX_UPPER_YEARS, SENIOR_MIN_YEARS } from './fresher';
export type { FresherInput, FresherRequirement, FresherResult } from './fresher';
export { isWorthwhile, WORTHWHILE_MIN_MUST_RATIO, WORTHWHILE_MAX_CHECK_AGE_DAYS } from './worthwhile';
export type { WorthwhileInput, WorthwhileCondition, WorthwhileResult } from './worthwhile';

// --- campus: resume parsing, sensitive-data detection, eligibility (Slices 1 and 2)
export { detectSections, normalizeResumeText } from './resume/sections';
export type { SectionKind as ResumeSectionKind } from './resume/sections';
export { parseEducation, parseBacklogs, normalizeBranch } from './resume/education';
export type { EducationParse } from './resume/education';
export { verhoeffValid, verhoeffCheckDigit } from './resume/verhoeff';
export { detectSensitive, maskSensitive } from './resume/sensitive';
export { assessTextLayer } from './resume/text-layer';
export { parseCriteria, evaluateEligibility, applyCgpaRule, invertCgpaRule, canonDegree, canonBranch, universityRules, findUniversityRule, toCgpaRule } from './eligibility';
export type { EvaluateOptions, UniversityRule } from './eligibility';
export type { LevelVerdict, VerdictLevel } from './eligibility/types';
export { normalizeDate, normalizeDateRange, normalizeMarks, parseScoreText, validateScore, PCT_MISMATCH_TOLERANCE } from './resume/normalize';
export type { YearMonth, DateRange, Marks, ParsedScore, ScoreKind, ScoreFlag, ScoreFlagCode, ScoreValidation, ValidateContext } from './resume/normalize';
export type { Criterion, CriterionLevel, EligibilityProfileInput, CgpaRule, VerdictStatus, CriterionVerdict, EligibilityResult } from './eligibility/types';
export type { ExtractMeta } from './resume/types';
export { assessHealth, checkFileName } from './resume/health';
export type { HealthInput, HealthReport, FileNameProblem, FileNameResult } from './resume/health';

// --- campus: paste-a-job (S5) and scam signals (C6)
export { parsePastedJob, scoreForProfile, sourceHintFromUrl } from './jobtext';
export type { ParsedJob, ParseOptions, SourceHint, JobField, FieldEvidence, ProfileFit, ScoreOptions, JobScore } from './jobtext';
export { detectScamSignals, FREE_MAIL_DOMAINS, URL_SHORTENER_HOSTS, FRESHER_UNREALISTIC_ANNUAL_INR, LOW_SKILL_UNREALISTIC_ANNUAL_INR } from './scam';
export type { ScamSignalId, ScamSeverity, ScamRisk, ScamSignal, ScamResult, ScamOptions } from './scam';

// --- application answers without an LLM (decision 1, 2026-10-29)
export { classifyQuestion, answerFrom, answerQuestion, ANSWER_KEYS } from './answers';
export type { Answer, AnswerBankEntry, AnswerEvidence, AnswerInputs, AnswerKey, AnswerOptions, AnswerProfile, AnswerSet, Classification, CompanyFacts, AnswerEvidenceSource, QuestionKey, ResumeFacts } from './answers';

// --- layout-aware PDF text (RP1)
export { reconstructText, legacyText, MAX_PAGE_WIDTH, MAX_ITEMS_PER_PAGE } from './resume/layout';
export type { TextItem, PageItems, LayoutResult, Heading } from './resume/layout';
export { findMarks } from './resume/normalize';
export type { MarksHit } from './resume/normalize';
