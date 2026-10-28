/**
 * Task 2.4: skill extraction. Rule-only and deterministic.
 *
 * Aliases are matched with a character trie (one case-folded, one exact) and leftmost-longest
 * resolution. Boundaries are word-character based, with extra checks for `C++`, `.NET`, `file.py`.
 * Skills flagged `requiresContext` (Go, R, C, Swift, Rust, Spark, Excel ...) only count through the
 * context rules: a skills list, an unambiguous alias such as `Golang`, or a parenthetical tech list.
 */
import skillsData from '../data/skills.json';
import { EngineInvariantError } from './errors';
import { evidence } from './internal/tracer';
import type { Doc } from './text';
import { TraceBuilder } from './trace';
import type { Evidence, Trace } from './trace';

export type SkillCategory = 'language' | 'framework' | 'database' | 'cloud' | 'tool' | 'practice' | 'domain' | 'soft';

export interface SkillDef {
  id: string;
  label: string;
  aliases: string[];
  category: SkillCategory;
  adjacent: string[];
  caseSensitive?: boolean;
  requiresContext?: boolean;
  tokenChars?: string;
  /** Aliases of a requiresContext skill that are unambiguous on their own (`golang`, `pyspark`). */
  strongAliases?: string[];
  /** For caseSensitive skills: also match the all-lowercase form (`react`, `pandas`). */
  lowercaseOk?: boolean;
  /** The lowercase form is an English word too ("react to"), so it counts only through the context rules. */
  lowercaseNeedsContext?: boolean;
}

export interface SkillIndex {
  readonly version: string;
  readonly size: number;
}

export interface SkillHit {
  id: string;
  ruleId: 'skills.alias' | 'skills.context.list' | 'skills.context.golang' | 'skills.context.paren';
  inSkillsList: boolean;
  evidence: Evidence[];
  count: number;
}

export interface SkillExtraction {
  hits: SkillHit[];
  ids: string[];
  trace: Trace;
}

/** One counted occurrence. Exported for requirements (restrict to a span) and LLM re-validation. */
export interface SkillOccurrence {
  id: string;
  ruleId: SkillHit['ruleId'];
  inSkillsList: boolean;
  source: 'description' | 'title';
  start: number;
  end: number;
}

interface Entry {
  id: string;
  ambiguous: boolean;
  strong: boolean;
}

interface TNode {
  next: Map<string, TNode>;
  out: Entry[] | null;
}

const newNode = (): TNode => ({ next: new Map(), out: null });

class CompiledSkillIndex implements SkillIndex {
  readonly adj = new Map<string, Set<string>>();
  readonly byId = new Map<string, SkillDef>();
  readonly ciRoot = newNode();
  readonly csRoot = newNode();
  constructor(
    readonly version: string,
    readonly size: number,
  ) {}
}

function invariant(ruleId: string, message: string): never {
  throw new EngineInvariantError(ruleId, message);
}

const foldChar = (c: string): string => {
  const l = c.toLowerCase();
  return l.length === 1 ? l : c;
};
/** Length-preserving case fold (offsets must stay valid). */
function fold(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) out += foldChar(s[i] as string);
  return out;
}

function hash32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function insert(root: TNode, key: string, entry: Entry): void {
  let node = root;
  for (let i = 0; i < key.length; i++) {
    const c = key[i] as string;
    let n = node.next.get(c);
    if (!n) {
      n = newNode();
      node.next.set(c, n);
    }
    node = n;
  }
  if (!node.out) node.out = [];
  if (!node.out.some((e) => e.id === entry.id)) node.out.push(entry);
}

function csVariants(alias: string, lowercaseOk: boolean): { text: string; lower: boolean }[] {
  const cap = alias.charAt(0).toUpperCase() + alias.slice(1);
  const set = new Set<string>([cap, alias.toUpperCase()]);
  if (alias !== alias.toLowerCase()) set.add(alias);
  const lower = alias.toLowerCase();
  const out = [...set].filter((t) => t !== lower).map((text) => ({ text, lower: false }));
  if (lowercaseOk || set.has(lower)) out.push({ text: lower, lower: true });
  return out;
}

export function compileSkills(defs: readonly SkillDef[]): SkillIndex {
  const idx = new CompiledSkillIndex(`sk-${hash32(JSON.stringify(defs))}`, defs.length);
  const aliasOwner = new Map<string, string>();
  for (const d of defs) {
    if (idx.byId.has(d.id)) invariant('skills.compile.duplicate_id', `duplicate skill id ${d.id}`);
    idx.byId.set(d.id, d);
    idx.adj.set(d.id, new Set());
  }
  for (const d of defs) {
    const strong = new Set((d.strongAliases ?? []).map((a) => a.toLowerCase()));
    for (const alias of d.aliases) {
      const key = alias.toLowerCase();
      const owner = aliasOwner.get(key);
      if (owner !== undefined && owner !== d.id) {
        invariant('skills.compile.duplicate_alias', `alias "${alias}" is used by ${owner} and ${d.id}`);
      }
      aliasOwner.set(key, d.id);
      const ambiguous = d.requiresContext === true && !strong.has(key) && !alias.includes(' ');
      const entry: Entry = { id: d.id, ambiguous, strong: !ambiguous };
      const caseExact = d.caseSensitive === true && !strong.has(key) && !alias.includes(' ');
      if (caseExact) {
        for (const v of csVariants(alias, d.lowercaseOk === true)) {
          const e: Entry = v.lower && d.lowercaseNeedsContext === true ? { ...entry, ambiguous: true, strong: false } : entry;
          insert(idx.csRoot, v.text, e);
        }
      } else {
        insert(idx.ciRoot, fold(alias), entry);
      }
    }
  }
  for (const d of defs) {
    for (const a of d.adjacent) {
      if (!idx.byId.has(a)) invariant('skills.compile.dangling_adjacency', `${d.id} lists unknown skill ${a}`);
      if (a === d.id) invariant('skills.compile.self_adjacency', `${d.id} is adjacent to itself`);
      const other = idx.byId.get(a) as SkillDef;
      if (!other.adjacent.includes(d.id)) {
        invariant('skills.compile.asymmetric_adjacency', `${d.id} lists ${a} but not the reverse`);
      }
      (idx.adj.get(d.id) as Set<string>).add(a);
    }
  }
  return idx;
}

let memo: SkillIndex | null = null;
export function defaultSkillIndex(): SkillIndex {
  if (!memo) memo = compileSkills((skillsData as unknown as { skills: SkillDef[] }).skills);
  return memo;
}

function asCompiled(index: SkillIndex): CompiledSkillIndex {
  if (!(index instanceof CompiledSkillIndex)) invariant('skills.index.invalid', 'index was not built by compileSkills');
  return index;
}

export function adjacency(index: SkillIndex, a: string, b: string): 'same' | 'adjacent' | 'none' {
  if (a === b) return 'same';
  const set = asCompiled(index).adj.get(a);
  return set !== undefined && set.has(b) ? 'adjacent' : 'none';
}

/** Skill ids defined in the index, document order of the data file. Used by LLM re-validation. */
export function hasSkill(index: SkillIndex, id: string): boolean {
  return asCompiled(index).byId.has(id);
}

export function skillLabel(index: SkillIndex, id: string): string | null {
  return asCompiled(index).byId.get(id)?.label ?? null;
}

export function skillCategory(index: SkillIndex, id: string): SkillCategory | null {
  return asCompiled(index).byId.get(id)?.category ?? null;
}

// ---------------------------------------------------------------------------------------------
// Scanning

const WORD = /[\p{L}\p{N}_]/u;
const isWord = (c: string | undefined): boolean => c !== undefined && c !== '' && WORD.test(c);

interface Cand {
  start: number;
  end: number;
  entry: Entry;
}

function startOk(text: string, i: number): boolean {
  const p = text[i - 1];
  if (i === 0 || p === undefined) return true;
  if (isWord(p)) return false;
  // "file.py", "e.g.python": a dot glued to a preceding word.
  if (p === '.' && i >= 2 && isWord(text[i - 2])) return false;
  return true;
}

function endOk(text: string, j: number, alias: string): boolean {
  const n = text[j];
  if (n === undefined) return true;
  if (isWord(n)) return false;
  const last = alias[alias.length - 1] as string;
  // "C" must not match inside "C++" / "C#" when those are not the matched alias.
  if ((n === '+' || n === '#') && isWord(last)) return false;
  // "Java.util", "Go.mod": a dot followed by a word is a member access, not the end of the token.
  if (n === '.' && isWord(text[j + 1]) && isWord(last)) return false;
  return true;
}

function scan(text: string, idx: CompiledSkillIndex): Cand[] {
  const folded = fold(text);
  const out: Cand[] = [];
  for (let i = 0; i < text.length; i++) {
    if (!startOk(text, i)) continue;
    let best: Cand | null = null;
    for (const [root, src] of [
      [idx.ciRoot, folded],
      [idx.csRoot, text],
    ] as const) {
      let node: TNode | undefined = root;
      for (let j = i; j < src.length && node; j++) {
        node = node.next.get(src[j] as string);
        if (node?.out && endOk(text, j + 1, text.slice(i, j + 1))) {
          const e = node.out[0] as Entry;
          if (!best || j + 1 > best.end) best = { start: i, end: j + 1, entry: e };
        }
      }
    }
    if (best) {
      out.push(best);
      i = best.end - 1;
    }
  }
  return out;
}

const LIST_SEP = /^\s*(?:,\s*(?:(?:and|or)\s+|&\s*)?|\/|\||;|•|·|\+|&|\s(?:and|or)\s|\s*\/\s*|\s+&\s+)\s*$/i;
const OR_AND_SEP = /^\s+(?:and|or)\s+$/i;

function isSep(between: string): boolean {
  return between.length <= 12 && (LIST_SEP.test(between) || OR_AND_SEP.test(between));
}

interface BlockRange {
  start: number;
  end: number;
}

function blockFinder(doc: Doc | null, text: string): (offset: number) => BlockRange {
  const blocks = doc?.blocks ?? [];
  const whole: BlockRange = { start: 0, end: text.length };
  return (offset) => {
    let lo = 0;
    let hi = blocks.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const b = blocks[mid] as { start: number; end: number };
      if (offset < b.start) hi = mid - 1;
      else if (offset >= b.end) lo = mid + 1;
      else return b;
    }
    if (blocks.length === 0) return whole;
    // Outside any block (separator gap): fall back to the surrounding line.
    const ls = text.lastIndexOf('\n', offset - 1) + 1;
    const le = text.indexOf('\n', offset);
    return { start: ls, end: le === -1 ? text.length : le };
  };
}

const LIST_START_WORD = /^\s*(?:and|or)\b/i;

function sentenceInitial(text: string, i: number, blockStart: number): boolean {
  let k = i - 1;
  while (k >= blockStart && /[\s\-*•·–—>]/.test(text[k] as string)) k--;
  if (k < blockStart) return true;
  return /[.!?:]/.test(text[k] as string);
}

function followedByListSep(text: string, j: number): boolean {
  let k = j;
  while (k < text.length && (text[k] === ' ' || text[k] === '\t')) k++;
  const c = text[k];
  if (c === undefined) return false;
  if (',/|;&+•·'.includes(c)) return true;
  return LIST_START_WORD.test(text.slice(j, j + 8));
}

interface Scanned {
  occs: SkillOccurrence[];
  rejects: { start: number; end: number; id: string; reason: string }[];
}

function resolve(
  text: string,
  doc: Doc | null,
  idx: CompiledSkillIndex,
  source: 'description' | 'title',
): Scanned {
  const cands = scan(text, idx);
  const blockOf = blockFinder(doc, text);
  // Runs of candidates joined by list separators inside one block.
  const runOf: number[] = [];
  let run = -1;
  for (let k = 0; k < cands.length; k++) {
    const c = cands[k] as Cand;
    const prev = k > 0 ? (cands[k - 1] as Cand) : null;
    let joined = false;
    if (prev) {
      const bp = blockOf(prev.start);
      const bc = blockOf(c.start);
      joined = bp.start === bc.start && isSep(text.slice(prev.end, c.start));
    }
    if (!joined) run++;
    runOf.push(run);
  }
  const strongInRun = new Map<number, number>();
  const sizeOfRun = new Map<number, number>();
  cands.forEach((c, k) => {
    sizeOfRun.set(runOf[k] as number, (sizeOfRun.get(runOf[k] as number) ?? 0) + 1);
    if (!c.entry.ambiguous) strongInRun.set(runOf[k] as number, (strongInRun.get(runOf[k] as number) ?? 0) + 1);
  });

  const occs: SkillOccurrence[] = [];
  const rejects: Scanned['rejects'] = [];
  cands.forEach((c, k) => {
    const others = (strongInRun.get(runOf[k] as number) ?? 0) - (c.entry.ambiguous ? 0 : 1);
    const inList = others >= 2;
    if (!c.entry.ambiguous) {
      const def = idx.byId.get(c.entry.id) as SkillDef;
      const ruleId: SkillHit['ruleId'] = def.requiresContext ? 'skills.context.golang' : 'skills.alias';
      occs.push({ id: c.entry.id, ruleId, inSkillsList: inList, source, start: c.start, end: c.end });
      return;
    }
    const b = blockOf(c.start);
    const before = text[c.start - 1];
    const after = text[c.end];
    const reject = (reason: string) => rejects.push({ start: c.start, end: c.end, id: c.entry.id, reason });
    if (after === '&' || before === '&') return reject('adjacent to "&" (as in R&D)');
    if (after === '-' && isWord(text[c.end + 1])) return reject('hyphenated compound (as in go-to-market)');
    if (before === '-' && isWord(text[c.start - 2])) return reject('hyphenated compound');
    {
      // "Unity Catalog", "Spark Networks", "Notion Agents": part of a capitalised proper noun.
      const m = /^ +[A-Z][a-z]/.exec(text.slice(c.end, c.end + 4));
      const nextCand = cands[k + 1];
      if (m && !(nextCand && nextCand.start === c.end + m[0].length - 2)) {
        return reject('part of a capitalised proper noun');
      }
    }
    if (sentenceInitial(text, c.start, b.start) && !followedByListSep(text, c.end)) {
      return reject('sentence-initial word, not a list item');
    }
    const inRun = (sizeOfRun.get(runOf[k] as number) ?? 1) - 1;
    if (others >= 1 || inRun >= 2) {
      occs.push({ id: c.entry.id, ruleId: 'skills.context.list', inSkillsList: inList, source, start: c.start, end: c.end });
      return;
    }
    const open = text.lastIndexOf('(', c.start);
    if (open >= b.start && text.indexOf(')', open) >= c.end && text.indexOf(')', open) < b.end) {
      const close = text.indexOf(')', open);
      const nested = text.lastIndexOf('(', c.start) === open && !text.slice(open, c.start).includes(')');
      if (nested) {
        const inside = cands.some(
          (o, q) => q !== k && !o.entry.ambiguous && o.start > open && o.end <= close,
        );
        if (inside) {
          occs.push({ id: c.entry.id, ruleId: 'skills.context.paren', inSkillsList: false, source, start: c.start, end: c.end });
          return;
        }
      }
    }
    reject('ambiguous word with no skills-list or parenthetical context');
  });
  return { occs, rejects };
}

// ---------------------------------------------------------------------------------------------
// Incidental topic mentions on non-technical roles

/** Titles of roles where a security word in the description is a topic, not the candidate's skill. */
const NON_TECH_TITLE_RE =
  /\b(?:legal|counsel|attorneys?|lawyers?|paralegals?|solicitors?|recruiters?|recruiting|talent acquisition|human resources|hr|payroll|accountants?|accounting|bookkeeper|marketing|copywriter|account executives?|sales development|customer success)\b/i;

function securityCluster(idx: CompiledSkillIndex): ReadonlySet<string> {
  return new Set<string>(['cybersecurity', ...(idx.adj.get('cybersecurity') ?? [])]);
}

/**
 * On a non-technical title, a security-cluster skill found only in the description prose (not in a skills
 * list, not in the title) is dropped: "Associate Legal ... information security reviews" is not a
 * cybersecurity role.
 */
function dropIncidental(
  occs: SkillOccurrence[],
  idx: CompiledSkillIndex,
  title: string | undefined,
): { kept: SkillOccurrence[]; dropped: SkillOccurrence[] } {
  if (!title || !NON_TECH_TITLE_RE.test(title)) return { kept: occs, dropped: [] };
  const cluster = securityCluster(idx);
  const titleHasSecurity = occs.some((o) => o.source === 'title' && cluster.has(o.id));
  if (titleHasSecurity) return { kept: occs, dropped: [] };
  const kept: SkillOccurrence[] = [];
  const dropped: SkillOccurrence[] = [];
  for (const o of occs) {
    if (o.source === 'description' && !o.inSkillsList && cluster.has(o.id)) dropped.push(o);
    else kept.push(o);
  }
  return { kept, dropped };
}

/** Every counted occurrence in document order (description first, then the title). */
export function skillOccurrences(doc: Doc, index: SkillIndex = defaultSkillIndex(), title?: string): SkillOccurrence[] {
  const idx = asCompiled(index);
  const d = resolve(doc.text, doc, idx, 'description').occs;
  const t = title ? resolve(title, null, idx, 'title').occs : [];
  return dropIncidental([...d, ...t], idx, title).kept;
}

/** Sorted unique ids of occurrences inside [start, end) of the description. */
export function skillIdsInRange(occs: readonly SkillOccurrence[], start: number, end: number): string[] {
  const set = new Set<string>();
  for (const o of occs) if (o.source === 'description' && o.start >= start && o.end <= end) set.add(o.id);
  return [...set].sort();
}

export function extractSkills(doc: Doc, index: SkillIndex = defaultSkillIndex(), title?: string): SkillExtraction {
  const idx = asCompiled(index);
  const tb = new TraceBuilder('skills');
  const d = resolve(doc.text, doc, idx, 'description');
  const t = title ? resolve(title, null, idx, 'title') : { occs: [] as SkillOccurrence[], rejects: [] };
  const filtered = dropIncidental([...d.occs, ...t.occs], idx, title);
  const rejected: { src: 'description' | 'title'; r: Scanned['rejects'][number] }[] = [
    ...filtered.dropped.map((o) => ({
      src: 'description' as const,
      r: { start: o.start, end: o.end, id: o.id, reason: 'incidental topic on a non-technical (legal/HR/finance/sales) title' },
    })),
    ...d.rejects.map((r) => ({ src: 'description' as const, r })),
    ...t.rejects.map((r) => ({ src: 'title' as const, r })),
  ];

  const byId = new Map<string, SkillHit>();
  for (const o of filtered.kept) {
    const text = o.source === 'title' ? (title as string) : doc.text;
    let hit = byId.get(o.id);
    if (!hit) {
      hit = { id: o.id, ruleId: o.ruleId, inSkillsList: false, evidence: [], count: 0 };
      byId.set(o.id, hit);
    }
    hit.count++;
    if (o.inSkillsList) hit.inSkillsList = true;
    if (hit.evidence.length < 5) hit.evidence.push(evidence(o.source, text, o.start, o.end));
  }
  const hits = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const h of hits) {
    const def = idx.byId.get(h.id) as SkillDef;
    tb.step({
      ruleId: h.ruleId,
      op: 'detect',
      label: `${def.label} found ${h.count} time${h.count === 1 ? '' : 's'}${h.inSkillsList ? ' (in a skills list)' : ''}`,
      inputs: { skill: h.id, count: h.count, inSkillsList: h.inSkillsList },
      output: h.id,
      evidence: h.evidence,
    });
  }
  for (const { src, r } of rejected) {
    const text = src === 'title' ? (title as string) : doc.text;
    const def = idx.byId.get(r.id) as SkillDef;
    tb.step({
      ruleId: 'skills.context.rejected',
      op: 'reject',
      label: `"${text.slice(r.start, r.end)}" not counted as ${def.label}: ${r.reason}`,
      inputs: { skill: r.id, reason: r.reason },
      output: null,
      evidence: [evidence(src, text, r.start, r.end)],
    });
  }
  const ids = hits.map((h) => h.id);
  if (ids.length === 0) {
    tb.step({ ruleId: 'skills.none', op: 'default', label: 'No skills found', output: [] });
  }
  return { hits, ids, trace: tb.build(ids.length > 0 ? 'value' : 'null') };
}
