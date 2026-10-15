import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEDUP_MAX_HAMMING,
  DEDUP_MIN_TOKENS,
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
  type DedupKey,
  type DedupPair,
} from '../src/dedup';
import { EngineInvariantError } from '../src/errors';
import { fnv1a64 } from '../src/text';
import { isTrace } from '../src/trace';

const norm = (t: string) => canonicalTitle(t).norm;

describe('canonicalTitle', () => {
  it('lowercases and keeps seniority, numerals and specialisation', () => {
    expect(norm('Software Engineer, Platform (Developer Experience)')).toBe('software engineer platform developer experience');
    expect(norm('Senior Software Engineer')).toBe('senior software engineer');
    expect(norm('Senior Software Engineer')).not.toBe(norm('Software Engineer'));
    expect(norm('Software Engineer II')).toBe('software engineer ii');
    expect(norm('Software Engineer II')).not.toBe(norm('Software Engineer I'));
    expect(norm('Account Executive, Corporate')).toBe('account executive corporate');
  });
  it('strips trailing work-mode and location suffixes only when they resolve', () => {
    expect(norm('Software Engineer (Remote)')).toBe('software engineer');
    expect(norm('Software Engineer - London')).toBe('software engineer');
    expect(norm('Software Engineer – Bengaluru')).toBe('software engineer');
    expect(norm('Software Engineer | US')).toBe('software engineer');
    expect(norm('Software Engineer (Hybrid, London)')).toBe('software engineer');
    expect(norm('Software Engineer, Remote')).toBe('software engineer');
    expect(norm('Software Engineer - Remote (US)')).toBe('software engineer');
    expect(norm('Staff Engineer - Platform')).toBe('staff engineer platform');
    expect(norm('Engineer (Payments)')).toBe('engineer payments');
    expect(norm('Engineer - Growth')).toBe('engineer growth');
  });
  it('strips requisition ids', () => {
    expect(norm('Data Analyst (R12345)')).toBe('data analyst');
    expect(norm('Data Analyst [2026]')).toBe('data analyst');
    expect(norm('Data Analyst #4521')).toBe('data analyst');
    expect(norm('Data Analyst REQ-9981')).toBe('data analyst');
    expect(norm('Data Analyst (REQ-12-A)')).toBe('data analyst');
    expect(norm('Data Analyst (Remote) (R100)')).toBe('data analyst');
    expect(norm('(R12345) Data Analyst')).toBe('data analyst');
  });
  it('expands abbreviations', () => {
    expect(norm('Sr. SWE')).toBe('senior software engineer');
    expect(norm('Jr Eng')).toBe('junior engineer');
    expect(norm('Sr Engr Mgr')).toBe('senior engineer manager');
    expect(norm('Sales & Marketing Manager')).toBe('sales and marketing manager');
    expect(norm('Eng Mgr')).toBe('engineer manager');
  });
  it('keeps + # . inside tokens', () => {
    expect(norm('C++ Developer')).toBe('c++ developer');
    expect(norm('C# Engineer')).toBe('c# engineer');
    expect(norm('.NET Developer')).toBe('.net developer');
    expect(norm('Node.js Engineer')).toBe('node.js engineer');
    expect(norm('Front-end / Back-end Developer')).toBe('front end back end developer');
  });
  it('collapses whitespace, punctuation and unicode forms', () => {
    expect(norm('  Product   Manager,  Growth ')).toBe('product manager growth');
    expect(norm('Ｓｅｎｉｏｒ Engineer')).toBe('senior engineer');
    expect(norm('Engineer (Remote）')).toBe('engineer');
    expect(norm('')).toBe('');
    expect(norm('...')).toBe('');
    expect(norm('Ingénieur Logiciel')).toBe('ingénieur logiciel');
  });
  it('is the same for reposts that differ only in suffixes', () => {
    const a = norm('Senior Software Engineer (Remote)');
    expect(norm('Sr. Software Engineer - London')).toBe(a);
    expect(norm('Senior Software Engineer [2026]')).toBe(a);
  });
  it('returns evidence into the original title for stripped suffixes', () => {
    const t = 'Software Engineer – Bengaluru';
    const r = canonicalTitle(t);
    expect(r.stripped).toHaveLength(1);
    const e = r.stripped[0]!;
    expect(e.source).toBe('title');
    expect(t.slice(e.start, e.end)).toBe(e.quote);
    expect(e.quote).toBe('– Bengaluru');
  });
  it('maps evidence back through NFKC changes', () => {
    const t = 'Engineer （Remote）';
    const r = canonicalTitle(t);
    expect(r.norm).toBe('engineer');
    const e = r.stripped[0]!;
    expect(t.slice(e.start, e.end)).toBe(e.quote);
  });
  it('produces a valid trace', () => {
    const r = canonicalTitle('Engineer (Remote)');
    expect(isTrace(r.trace)).toBe(true);
    expect(r.trace.subject).toBe('title');
    expect(r.trace.steps.map((s) => s.ruleId)).toEqual(['title.strip.location', 'title.norm']);
    expect(r.tokens).toEqual(['engineer']);
    expect(canonicalTitle('').trace.outcome).toBe('null');
  });
  it('does not strip place words that are part of the role', () => {
    expect(norm('Paris Fashion Manager')).toBe('paris fashion manager');
  });
});

describe('simhash64', () => {
  const text = Array.from({ length: 60 }, (_, i) => `word${i % 17} term${i % 7}`).join(' ');
  it('formats hex and signed pg consistently', () => {
    const h = simhash64(text);
    expect(h.hex).toMatch(/^[0-9a-f]{16}$/);
    expect(BigInt.asUintN(64, BigInt(h.pg))).toBe(BigInt(`0x${h.hex}`));
    expect(simhashFromPg(h.pg)).toEqual(h);
  });
  it('is deterministic and case/punctuation insensitive', () => {
    expect(simhash64(text)).toEqual(simhash64(text));
    expect(simhash64('Hello, World! Foo bar baz')).toEqual(simhash64('hello world foo bar baz'));
  });
  it('tokenises [a-z0-9+#]+ only', () => {
    expect(simhashTokens('C++ and C# in Node.js, über 3x')).toEqual(['c++', 'and', 'c#', 'in', 'node', 'js', 'ber', '3x']);
    expect(countTokens('a b  c')).toBe(3);
  });
  it('handles empty, one-token and two-token inputs', () => {
    expect(simhash64('').hex).toBe('0000000000000000');
    expect(simhash64('hello').hex).toMatch(/^[0-9a-f]{16}$/);
    expect(simhash64('hello world').hex).toMatch(/^[0-9a-f]{16}$/);
  });
  it('moves little for a small edit and a lot for a different text', () => {
    const base = Array.from({ length: 300 }, (_, i) => `w${(i * 7919) % 211}`).join(' ');
    const edited = base.replace('w0 ', '');
    const other = Array.from({ length: 300 }, (_, i) => `x${(i * 104729) % 997}`).join(' ');
    expect(hamming(simhash64(base), simhash64(edited))).toBeLessThanOrEqual(DEDUP_MAX_HAMMING);
    expect(hamming(simhash64(base), simhash64(other))).toBeGreaterThan(10);
  });
  it('drops boilerplate blocks by fnv1a64 of the trimmed line', () => {
    const boiler = 'We are an equal opportunity employer and value diversity at our company in every way possible';
    const a = `Build payments systems at scale\n${boiler}`;
    const b = `Design embedded firmware for sensors\n${boiler}`;
    const ex = new Set([fnv1a64(boiler)]);
    const plain = hamming(simhash64(a), simhash64(b));
    const cleaned = hamming(simhash64(a, { excludeBlockHashes: ex }), simhash64(b, { excludeBlockHashes: ex }));
    expect(simhash64(a, { excludeBlockHashes: ex })).toEqual(simhash64('Build payments systems at scale'));
    expect(cleaned).toBeGreaterThanOrEqual(plain);
    expect(simhash64(a, { excludeBlockHashes: new Set() })).toEqual(simhash64(a));
  });
});

describe('hamming and pg round trip', () => {
  it('counts differing bits', () => {
    expect(hamming({ hex: '0000000000000000', pg: '0' }, { hex: 'ffffffffffffffff', pg: '-1' })).toBe(64);
    expect(hamming({ hex: '0000000000000001', pg: '1' }, { hex: '0000000000000003', pg: '3' })).toBe(1);
    expect(hamming({ hex: 'abcdef0123456789', pg: '0' }, { hex: 'abcdef0123456789', pg: '0' })).toBe(0);
  });
  it('round-trips the two-complement edges', () => {
    expect(simhashFromPg('-1').hex).toBe('ffffffffffffffff');
    expect(simhashFromPg('0').hex).toBe('0000000000000000');
    expect(simhashFromPg('9223372036854775807').hex).toBe('7fffffffffffffff');
    expect(simhashFromPg('-9223372036854775808').hex).toBe('8000000000000000');
    expect(simhashFromPg('-9223372036854775808').pg).toBe('-9223372036854775808');
    expect(simhashFromPg('9223372036854775807').pg).toBe('9223372036854775807');
  });
  it('rejects non-int64 input', () => {
    for (const bad of ['', 'abc', '1.5', '9223372036854775808', '-9223372036854775809', '12345678901234567890']) {
      expect(() => simhashFromPg(bad), bad).toThrow(EngineInvariantError);
    }
  });
});

describe('dedupMatch', () => {
  const sh = simhash64(Array.from({ length: 80 }, (_, i) => `t${i}`).join(' '));
  const key = (over: Partial<DedupKey> = {}): DedupKey => ({ companyId: 'acme', titleNorm: 'software engineer', simhash: sh, tokenCount: 200, ...over });
  const flip = (n: number) => ({ hex: (BigInt(`0x${sh.hex}`) ^ ((1n << BigInt(n)) - 1n)).toString(16).padStart(16, '0'), pg: '0' });
  it('matches identical keys', () => {
    const d = dedupMatch(key(), key());
    expect(d).toMatchObject({ match: true, distance: 0, reason: 'match' });
    expect(isTrace(d.trace)).toBe(true);
    expect(d.trace.subject).toBe('dedup');
  });
  it('matches up to the threshold and not beyond', () => {
    expect(dedupMatch(key(), key({ simhash: flip(DEDUP_MAX_HAMMING) })).match).toBe(true);
    const over = dedupMatch(key(), key({ simhash: flip(DEDUP_MAX_HAMMING + 1) }));
    expect(over).toMatchObject({ match: false, distance: DEDUP_MAX_HAMMING + 1, reason: 'distance_exceeds' });
    expect(over.trace.outcome).toBe('rejected');
  });
  it('reports company_differs before anything else', () => {
    expect(dedupMatch(key(), key({ companyId: 'other', titleNorm: 'x', tokenCount: 1 }))).toMatchObject({ match: false, distance: null, reason: 'company_differs' });
  });
  it('reports title_differs', () => {
    expect(dedupMatch(key(), key({ titleNorm: 'senior software engineer' }))).toMatchObject({ match: false, distance: null, reason: 'title_differs' });
  });
  it('never merges short descriptions, even identical ones', () => {
    for (const n of [0, 1, DEDUP_MIN_TOKENS - 1]) {
      expect(dedupMatch(key({ tokenCount: n }), key())).toMatchObject({ match: false, reason: 'insufficient_text', distance: null });
      expect(dedupMatch(key(), key({ tokenCount: n }))).toMatchObject({ match: false, reason: 'insufficient_text' });
    }
    expect(dedupMatch(key({ tokenCount: DEDUP_MIN_TOKENS }), key({ tokenCount: DEDUP_MIN_TOKENS })).match).toBe(true);
  });
});

describe('pickPrimary and isoToEpochMs', () => {
  it('picks the earliest firstSeenAt', () => {
    const p = pickPrimary([
      { postingId: 'b', firstSeenAt: '2026-10-02T00:00:00Z' },
      { postingId: 'a', firstSeenAt: '2026-10-03T00:00:00Z' },
      { postingId: 'c', firstSeenAt: '2026-10-01T23:59:59.999Z' },
    ]);
    expect(p.postingId).toBe('c');
  });
  it('breaks ties with the smallest postingId', () => {
    const p = pickPrimary([
      { postingId: 'z', firstSeenAt: '2026-10-01T00:00:00Z' },
      { postingId: 'm', firstSeenAt: '2026-10-01T00:00:00.000Z' },
      { postingId: 'q', firstSeenAt: '2026-10-01T00:00:00Z' },
    ]);
    expect(p.postingId).toBe('m');
  });
  it('compares instants, not strings, across offsets', () => {
    const p = pickPrimary([
      { postingId: 'a', firstSeenAt: '2026-10-01T12:00:00+05:30' }, // 06:30Z
      { postingId: 'b', firstSeenAt: '2026-10-01T07:00:00Z' },
      { postingId: 'c', firstSeenAt: '2026-10-01T01:00:00-06:00' }, // 07:00Z
    ]);
    expect(p.postingId).toBe('a');
  });
  it('returns the only member and rejects an empty cluster', () => {
    expect(pickPrimary([{ postingId: 'x', firstSeenAt: '2026-01-01' }]).postingId).toBe('x');
    expect(() => pickPrimary([])).toThrow(EngineInvariantError);
  });
  it('parses ISO strings to epoch milliseconds', () => {
    expect(isoToEpochMs('1970-01-01T00:00:00Z')).toBe(0);
    expect(isoToEpochMs('1970-01-02')).toBe(86400000);
    expect(isoToEpochMs('2000-03-01T00:00:00Z')).toBe(951868800000);
    expect(isoToEpochMs('2024-02-29T12:00:00.5Z')).toBe(1709208000500);
    expect(isoToEpochMs('2026-10-16 02:00:00+02:00')).toBe(isoToEpochMs('2026-10-16T00:00:00Z'));
    expect(isoToEpochMs('1969-12-31T23:59:59Z')).toBe(-1000);
    expect(isoToEpochMs('2026-10-16T00:00:00-0330')).toBe(isoToEpochMs('2026-10-16T03:30:00Z'));
  });
  it('rejects malformed timestamps', () => {
    for (const bad of ['', 'yesterday', '2026-13-01', '2026-00-10', '2026-01-32']) {
      expect(() => isoToEpochMs(bad), bad).toThrow(EngineInvariantError);
    }
  });
});

describe('scoreDedupPairs and corpus parsing', () => {
  const side = (title: string, text: string, company = 'acme') => ({ company, title, text });
  const long = Array.from({ length: 80 }, (_, i) => `lorem${i}`).join(' ');
  it('scores true/false merges and misses', () => {
    const pairs: DedupPair[] = [
      { id: 'tp', label: 'merge', a: side('Engineer', long), b: side('Engineer (Remote)', long) },
      { id: 'fn', label: 'merge', a: side('Engineer', long), b: side('Engineer', long.replace(/lorem/g, 'other')) },
      { id: 'tn', label: 'distinct', a: side('Engineer', long), b: side('Senior Engineer', long) },
      { id: 'fp', label: 'distinct', a: side('Engineer', long), b: side('Engineer', long) },
    ];
    const s = scoreDedupPairs(pairs);
    expect(s).toMatchObject({ total: 4, tp: 1, fn: 1, tn: 1, fp: 1, falseMerges: 1, recall: 0.5, precision: 0.5 });
    expect(s.falseMergeIds).toEqual(['fp']);
    expect(s.missedIds).toEqual(['fn']);
    expect(s.reasons).toMatchObject({ match: 2, title_differs: 1, distance_exceeds: 1 });
  });
  it('handles empty input and unnamed pairs', () => {
    expect(scoreDedupPairs([])).toMatchObject({ total: 0, recall: 1, precision: 1, falseMerges: 0 });
    const s = scoreDedupPairs([{ label: 'distinct', a: side('A', long), b: side('A', long) }]);
    expect(s.falseMergeIds).toEqual(['pair-0']);
  });
  it('builds keys with excluded blocks', () => {
    const boiler = 'equal opportunity employer statement that is long enough to matter here';
    const text = `${long}\n${boiler}`;
    const k = dedupKeyFor(side('Engineer', text), { excludeBlockHashes: new Set([fnv1a64(boiler)]) });
    expect(k.tokenCount).toBe(80);
    expect(k.titleNorm).toBe('engineer');
  });
  it('skips the header and blank lines and rejects bad lines', () => {
    const line = JSON.stringify({ id: 'x', label: 'merge', a: side('A', 'a'), b: side('A', 'a') });
    expect(parseDedupPairs(`${JSON.stringify({ _meta: {} })}\n\n${line}\n`)).toHaveLength(1);
    expect(() => parseDedupPairs('{"label":"maybe","a":{},"b":{}}')).toThrow(EngineInvariantError);
    expect(() => parseDedupPairs('{"label":"merge"}')).toThrow(EngineInvariantError);
  });
});

describe('labelled corpus (test/corpus/dedup.pairs.jsonl)', () => {
  const raw = readFileSync(new URL('./corpus/dedup.pairs.jsonl', import.meta.url), 'utf8');
  const pairs = parseDedupPairs(raw);
  it('has a meta header and 200 labelled pairs', () => {
    const header = JSON.parse(raw.split('\n')[0]!) as { _meta: { pairs: number; labelledOn: string; labelledBy: string } };
    expect(header._meta.pairs).toBe(200);
    expect(header._meta.labelledOn).toBe('2026-10-16');
    expect(header._meta.labelledBy).toBeTruthy();
    expect(pairs).toHaveLength(200);
    expect(new Set(pairs.map((p) => p.id)).size).toBe(200);
  });
  it('covers every pair kind with both labels', () => {
    const kinds = new Map<string, Set<string>>();
    for (const p of pairs) kinds.set(p.kind!, (kinds.get(p.kind!) ?? new Set()).add(p.label));
    expect(kinds.size).toBeGreaterThanOrEqual(10);
    expect([...kinds.values()].some((s) => s.has('merge'))).toBe(true);
    expect([...kinds.values()].some((s) => s.has('distinct'))).toBe(true);
    expect(pairs.filter((p) => p.label === 'merge').length).toBeGreaterThanOrEqual(80);
    expect(pairs.filter((p) => p.label === 'distinct').length).toBeGreaterThanOrEqual(80);
  });
  it('gives 0 false merges and recall >= 0.9', () => {
    const s = scoreDedupPairs(pairs);
    expect(s.falseMergeIds).toEqual([]);
    expect(s.falseMerges).toBe(0);
    expect(s.recall).toBeGreaterThanOrEqual(0.9);
  });
  it('keeps every labelled-distinct pair at least 3 bits beyond the threshold', () => {
    let min = 64;
    for (const p of pairs) {
      if (p.label !== 'distinct') continue;
      const a = dedupKeyFor(p.a);
      const b = dedupKeyFor(p.b);
      if (a.companyId !== b.companyId || a.titleNorm !== b.titleNorm || a.tokenCount < DEDUP_MIN_TOKENS || b.tokenCount < DEDUP_MIN_TOKENS) continue;
      min = Math.min(min, hamming(a.simhash, b.simhash));
    }
    expect(min).toBeGreaterThanOrEqual(DEDUP_MAX_HAMMING + 3);
  });
  it('blocks every identical-short and cross-company pair with the right reason', () => {
    for (const p of pairs.filter((x) => x.kind === 'insufficient_text')) {
      expect(dedupMatch(dedupKeyFor(p.a), dedupKeyFor(p.b)).reason).toBe('insufficient_text');
    }
    for (const p of pairs.filter((x) => x.kind === 'company_differs')) {
      expect(dedupMatch(dedupKeyFor(p.a), dedupKeyFor(p.b)).reason).toBe('company_differs');
    }
    for (const p of pairs.filter((x) => x.kind === 'seniority_differs')) {
      expect(dedupMatch(dedupKeyFor(p.a), dedupKeyFor(p.b)).reason).toBe('title_differs');
    }
  });
});
