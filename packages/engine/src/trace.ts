import { EngineInvariantError } from './errors';
import type { JsonValue } from './types';
import { ENGINE_VERSION } from './version';


export type EvidenceSource =
  | 'description' | 'title' | 'location' | 'department' | 'team'
  | 'employment_raw' | 'workplace_raw' | 'remote_hint' | 'structured' | 'fx' | 'llm';

export interface Evidence {
  source: EvidenceSource;
  /** Into Doc.text (description) or into the named source string; 0,0 for structured/fx. */
  start: number;
  end: number;
  /** Exact slice. In traces, truncated to 160 chars with quoteTruncated=true. */
  quote: string;
  quoteTruncated?: true;
  /** Which locationsRaw[] element. */
  index?: number;
  /** Structured field path, e.g. 'compensation.compensationTiers[0].components[1]'. */
  path?: string;
}

export type StepOp =
  | 'detect' | 'parse' | 'select' | 'reject' | 'convert' | 'round'
  | 'classify' | 'default' | 'identity' | 'validate' | 'merge';

/** The solum CalculationStep (PLAN 3.4). The UI renders these in seq order. */
export interface CalculationStep {
  seq: number;
  ruleId: string;
  op: StepOp;
  label: string;
  inputs: { [k: string]: JsonValue };
  output: JsonValue;
  evidence: Evidence[];
}

export type TraceSubject =
  | 'salary' | 'skills' | 'requirements' | 'level' | 'workplace' | 'employment'
  | 'role_family' | 'countries' | 'visa' | 'title' | 'simhash' | 'dedup' | 'llm_validation';

export interface Trace {
  engineVersion: typeof ENGINE_VERSION;
  subject: TraceSubject;
  outcome: 'value' | 'null' | 'unknown' | 'rejected';
  /** At most 64 steps. Overflow ends with ruleId 'trace.truncated'. */
  steps: CalculationStep[];
}

export const MAX_TRACE_STEPS = 64;
export const QUOTE_MAX = 160;

/** Evidence from an exact slice of `text`. The quote is cut to 160 chars with quoteTruncated; optional keys are omitted, never undefined. */
export function evidence(source: EvidenceSource, text: string, start: number, end: number, extra?: { index?: number; path?: string }): Evidence {
  const full = text.slice(start, end);
  const e: Evidence = { source, start, end, quote: full.length > QUOTE_MAX ? full.slice(0, QUOTE_MAX) : full };
  if (full.length > QUOTE_MAX) e.quoteTruncated = true;
  if (extra?.index !== undefined) e.index = extra.index;
  if (extra?.path !== undefined) e.path = extra.path;
  return e;
}

const SUBJECTS: readonly string[] = ['salary', 'skills', 'requirements', 'level', 'workplace', 'employment', 'role_family', 'countries', 'visa', 'title', 'simhash', 'dedup', 'llm_validation'];
const OUTCOMES: readonly string[] = ['value', 'null', 'unknown', 'rejected'];
const OPS: readonly string[] = ['detect', 'parse', 'select', 'reject', 'convert', 'round', 'classify', 'default', 'identity', 'validate', 'merge'];
const SOURCES: readonly string[] = ['description', 'title', 'location', 'department', 'team', 'employment_raw', 'workplace_raw', 'remote_hint', 'structured', 'fx', 'llm'];

/** True when `x` is a JSON-safe value (no undefined, NaN, Infinity, bigint, Date, functions). */
export function isJsonSafe(x: unknown, depth = 0): x is JsonValue {
  if (depth > 32) return false;
  if (x === null) return true;
  switch (typeof x) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(x);
    case 'object': {
      if (Array.isArray(x)) return x.every((v) => isJsonSafe(v, depth + 1));
      const proto = Object.getPrototypeOf(x) as unknown;
      if (proto !== Object.prototype && proto !== null) return false;
      return Object.values(x as object).every((v) => isJsonSafe(v, depth + 1));
    }
    default:
      return false;
  }
}

const isRec = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function isEvidence(x: unknown): x is Evidence {
  if (!isRec(x)) return false;
  if (typeof x.source !== 'string' || !SOURCES.includes(x.source)) return false;
  if (!Number.isInteger(x.start) || !Number.isInteger(x.end) || (x.start as number) < 0 || (x.end as number) < (x.start as number)) return false;
  if (typeof x.quote !== 'string') return false;
  if ('quoteTruncated' in x && x.quoteTruncated !== true) return false;
  if ('index' in x && !Number.isInteger(x.index)) return false;
  if ('path' in x && typeof x.path !== 'string') return false;
  return true;
}

/** Structural and JSON-safety check, used by the db layer before writing jsonb. */
export function isTrace(x: unknown): x is Trace {
  if (!isRec(x)) return false;
  if (x.engineVersion !== ENGINE_VERSION) return false;
  if (typeof x.subject !== 'string' || !SUBJECTS.includes(x.subject)) return false;
  if (typeof x.outcome !== 'string' || !OUTCOMES.includes(x.outcome)) return false;
  if (!Array.isArray(x.steps) || x.steps.length > MAX_TRACE_STEPS) return false;
  return x.steps.every((s: unknown, i: number) => {
    if (!isRec(s)) return false;
    if (s.seq !== i) return false;
    if (typeof s.ruleId !== 'string' || typeof s.label !== 'string') return false;
    if (typeof s.op !== 'string' || !OPS.includes(s.op)) return false;
    if (!isRec(s.inputs) || !isJsonSafe(s.inputs)) return false;
    if (!('output' in s) || !isJsonSafe(s.output)) return false;
    return Array.isArray(s.evidence) && s.evidence.every(isEvidence);
  });
}

export interface StepInput {
  ruleId: string;
  op: StepOp;
  label: string;
  inputs?: { [k: string]: JsonValue };
  output: JsonValue;
  evidence?: Evidence[];
}

/** Collects steps with contiguous seq numbers, enforces the 64-step cap and rejects non-JSON-safe values. */
export class TraceBuilder {
  private readonly list: CalculationStep[] = [];
  private truncated = false;

  constructor(readonly subject: TraceSubject) {}

  get steps(): readonly CalculationStep[] {
    return this.list;
  }

  step(s: StepInput): void {
    const inputs = s.inputs ?? {};
    if (!isJsonSafe(inputs) || !isJsonSafe(s.output)) {
      throw new EngineInvariantError('trace.not_json_safe', `step ${s.ruleId} carries a value that is not JSON safe`);
    }
    this.push({ ruleId: s.ruleId, op: s.op, label: s.label, inputs, output: s.output, evidence: s.evidence ?? [] });
  }

  /** Copy steps from another trace, re-sequencing them. */
  append(steps: readonly CalculationStep[]): void {
    for (const s of steps) this.push({ ruleId: s.ruleId, op: s.op, label: s.label, inputs: s.inputs, output: s.output, evidence: s.evidence });
  }

  private push(s: Omit<CalculationStep, 'seq'>): void {
    if (this.truncated) return;
    if (this.list.length >= MAX_TRACE_STEPS) {
      // A 65th step was offered: the 64th slot becomes the marker.
      this.truncated = true;
      this.list[MAX_TRACE_STEPS - 1] = { seq: MAX_TRACE_STEPS - 1, ruleId: 'trace.truncated', op: 'detect', label: `Trace truncated after ${MAX_TRACE_STEPS - 1} steps`, inputs: {}, output: null, evidence: [] };
      return;
    }
    this.list.push({ seq: this.list.length, ...s });
  }

  build(outcome: Trace['outcome']): Trace {
    return { engineVersion: ENGINE_VERSION, subject: this.subject, outcome, steps: this.list.map((s) => ({ ...s })) };
  }
}
