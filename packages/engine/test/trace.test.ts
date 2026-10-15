import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, ENRICH_VERSION, DOC_FORMAT_VERSION } from '../src/version';
import { EngineInvariantError } from '../src/errors';
import { TraceBuilder, evidence, isTrace } from '../src/trace';

describe('version constants', () => {
  it('pins the contract values', () => {
    expect(ENGINE_VERSION).toBe('1.0.0');
    expect(ENRICH_VERSION).toBe(1);
    expect(DOC_FORMAT_VERSION).toBe(1);
  });
});

describe('EngineInvariantError', () => {
  it('carries a ruleId and is an Error', () => {
    const e = new EngineInvariantError('salary.overflow', 'too big');
    expect(e).toBeInstanceOf(Error);
    expect(e.ruleId).toBe('salary.overflow');
    expect(e.message).toBe('too big');
    expect(e.name).toBe('EngineInvariantError');
  });
});

describe('evidence()', () => {
  it('slices the quote and omits optional keys instead of setting undefined', () => {
    const ev = evidence('description', 'hello world', 6, 11);
    expect(ev).toStrictEqual({ source: 'description', start: 6, end: 11, quote: 'world' });
    expect(Object.keys(ev)).not.toContain('quoteTruncated');
  });
  it('truncates quotes longer than 160 chars and flags it', () => {
    const long = 'x'.repeat(300);
    const ev = evidence('description', long, 0, 300);
    expect(ev.quote.length).toBe(160);
    expect(ev.quoteTruncated).toBe(true);
    expect(ev.end).toBe(300);
  });
  it('accepts index and path extras only when given', () => {
    const ev = evidence('location', 'Remote', 0, 6, { index: 2 });
    expect(ev.index).toBe(2);
    const sv = evidence('structured', '', 0, 0, { path: 'compensation.min' });
    expect(sv.path).toBe('compensation.min');
    expect(Object.keys(sv)).not.toContain('index');
  });
});

describe('TraceBuilder', () => {
  it('numbers steps contiguously from 0 and builds a valid trace', () => {
    const b = new TraceBuilder('salary');
    b.step({ ruleId: 'a.b.c', op: 'detect', label: 'one', output: 1 });
    b.step({ ruleId: 'a.b.d', op: 'parse', label: 'two', inputs: { x: 'y' }, output: { v: [1, 2] }, evidence: [evidence('description', 'abc', 0, 1)] });
    const t = b.build('value');
    expect(t.steps.map((s) => s.seq)).toEqual([0, 1]);
    expect(t.steps[0]!.inputs).toStrictEqual({});
    expect(t.steps[0]!.evidence).toStrictEqual([]);
    expect(t.engineVersion).toBe(ENGINE_VERSION);
    expect(t.subject).toBe('salary');
    expect(t.outcome).toBe('value');
    expect(isTrace(t)).toBe(true);
    expect(JSON.parse(JSON.stringify(t))).toStrictEqual(t);
  });
  it('caps at 64 steps and ends with trace.truncated', () => {
    const b = new TraceBuilder('salary');
    for (let i = 0; i < 100; i++) b.step({ ruleId: 'r.s.t', op: 'detect', label: `s${i}`, output: i });
    const t = b.build('null');
    expect(t.steps.length).toBe(64);
    expect(t.steps[63]!.ruleId).toBe('trace.truncated');
    expect(t.steps[62]!.label).toBe('s62');
    expect(isTrace(t)).toBe(true);
  });
  it('append() re-sequences steps from another trace', () => {
    const a = new TraceBuilder('salary');
    a.step({ ruleId: 'x.y.z', op: 'parse', label: 'first', output: 1 });
    const first = a.build('value');
    const b = new TraceBuilder('salary');
    b.step({ ruleId: 'p.q.r', op: 'detect', label: 'zero', output: 0 });
    b.append(first.steps);
    const t = b.build('value');
    expect(t.steps.map((s) => s.seq)).toEqual([0, 1]);
    expect(t.steps[1]!.ruleId).toBe('x.y.z');
  });
  it('rejects non-JSON-safe values', () => {
    const b = new TraceBuilder('salary');
    expect(() => b.step({ ruleId: 'a.b.c', op: 'detect', label: 'x', output: Number.NaN })).toThrow(EngineInvariantError);
    expect(() => b.step({ ruleId: 'a.b.c', op: 'detect', label: 'x', output: Infinity })).toThrow(EngineInvariantError);
  });
});

describe('isTrace()', () => {
  const good = () => {
    const b = new TraceBuilder('skills');
    b.step({ ruleId: 'a.b.c', op: 'select', label: 'l', output: null });
    return b.build('unknown');
  };
  it('accepts a good trace', () => expect(isTrace(good())).toBe(true));
  it.each([
    ['null', null],
    ['string', 'x'],
    ['array', []],
    ['missing steps', { engineVersion: '1.0.0', subject: 'salary', outcome: 'value' }],
  ])('rejects %s', (_n, v) => expect(isTrace(v)).toBe(false));
  it('rejects a wrong engine version, subject, outcome or step shape', () => {
    expect(isTrace({ ...good(), engineVersion: '0.0.1' })).toBe(false);
    expect(isTrace({ ...good(), subject: 'bogus' })).toBe(false);
    expect(isTrace({ ...good(), outcome: 'maybe' })).toBe(false);
    const t = good();
    expect(isTrace({ ...t, steps: [{ ...t.steps[0]!, seq: 5 }] })).toBe(false);
    expect(isTrace({ ...t, steps: [{ ...t.steps[0]!, op: 'bogus' }] })).toBe(false);
    expect(isTrace({ ...t, steps: [{ ...t.steps[0]!, evidence: [{ source: 'nope', start: 0, end: 0, quote: '' }] }] })).toBe(false);
    expect(isTrace({ ...t, steps: [{ ...t.steps[0]!, output: undefined }] })).toBe(false);
  });
  it('rejects more than 64 steps', () => {
    const t = good();
    const steps = Array.from({ length: 65 }, (_, i) => ({ ...t.steps[0]!, seq: i }));
    expect(isTrace({ ...t, steps })).toBe(false);
  });
});
