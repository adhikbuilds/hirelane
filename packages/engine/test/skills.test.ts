import { describe, expect, it } from 'vitest';
import data from '../data/skills.json';
import { EngineInvariantError } from '../src/errors';
import {
  adjacency,
  compileSkills,
  defaultSkillIndex,
  extractSkills,
  hasSkill,
  skillCategory,
  skillIdsInRange,
  skillLabel,
  skillOccurrences,
  type SkillDef,
} from '../src/skills';
import { docFromText, toDoc } from '../src/text';
import { isTrace } from '../src/trace';

const defs = (data as unknown as { skills: SkillDef[] }).skills;
const ids = (text: string, title?: string) => extractSkills(docFromText(text), undefined, title).ids;
const idsHtml = (html: string) => extractSkills(toDoc(html)).ids;

describe('data/skills.json', () => {
  it('has at least 600 skills with unique ids', () => {
    expect(defs.length).toBeGreaterThanOrEqual(600);
    expect(new Set(defs.map((d) => d.id)).size).toBe(defs.length);
  });
  it('has no duplicate alias (case-insensitive) across skills', () => {
    const seen = new Map<string, string>();
    for (const d of defs) for (const a of d.aliases) {
      const k = a.toLowerCase();
      expect(seen.get(k), `${a} in ${d.id}`).toBeUndefined();
      seen.set(k, d.id);
    }
  });
  it('has symmetric adjacency with no dangling ids', () => {
    const byId = new Map(defs.map((d) => [d.id, d]));
    for (const d of defs) for (const a of d.adjacent) {
      expect(byId.has(a), `${d.id} -> ${a}`).toBe(true);
      expect(byId.get(a)!.adjacent.includes(d.id), `${a} <- ${d.id}`).toBe(true);
    }
  });
  it('covers every category and the ambiguous tokens', () => {
    const cats = new Set(defs.map((d) => d.category));
    for (const c of ['language', 'framework', 'database', 'cloud', 'tool', 'practice', 'domain', 'soft'] as const) {
      expect(cats.has(c), c).toBe(true);
    }
    for (const id of ['go', 'r', 'c', 'swift', 'rust']) {
      expect(defs.find((d) => d.id === id)?.requiresContext, id).toBe(true);
    }
  });
  it('compiles', () => {
    expect(defaultSkillIndex().size).toBe(defs.length);
    expect(defaultSkillIndex()).toBe(defaultSkillIndex());
  });
});

describe('compileSkills validation', () => {
  const base: SkillDef = { id: 'a', label: 'A', aliases: ['alpha'], category: 'tool', adjacent: [] };
  it('throws on a duplicate alias', () => {
    expect(() => compileSkills([base, { ...base, id: 'b', aliases: ['ALPHA'] }])).toThrow(EngineInvariantError);
  });
  it('throws on a duplicate id', () => {
    expect(() => compileSkills([base, { ...base, aliases: ['x'] }])).toThrow(/duplicate skill id/);
  });
  it('throws on dangling adjacency', () => {
    expect(() => compileSkills([{ ...base, adjacent: ['zz'] }])).toThrow(/unknown skill/);
  });
  it('throws on asymmetric adjacency', () => {
    expect(() => compileSkills([{ ...base, adjacent: ['b'] }, { ...base, id: 'b', aliases: ['beta'] }])).toThrow(/reverse/);
  });
  it('throws on self adjacency', () => {
    expect(() => compileSkills([{ ...base, adjacent: ['a'] }])).toThrow(/itself/);
  });
  it('rejects a foreign index object', () => {
    expect(() => adjacency({ version: 'x', size: 0 }, 'a', 'b')).toThrow(EngineInvariantError);
  });
  it('gives a stable version for the same definitions', () => {
    expect(compileSkills([base]).version).toBe(compileSkills([base]).version);
    expect(compileSkills([base]).version).not.toBe(compileSkills([{ ...base, aliases: ['alpha', 'a1'] }]).version);
  });
});

describe('alias matching', () => {
  it('finds plain skills case-insensitively', () => {
    expect(ids('We use PYTHON and postgres on aws.')).toEqual(['aws', 'postgresql', 'python']);
  });
  it('resolves aliases to the canonical id', () => {
    expect(ids('Experience with k8s, Golang and JS')).toEqual(['go', 'javascript', 'kubernetes']);
  });
  it('requires word boundaries', () => {
    expect(ids('pythonic javascripty')).toEqual([]);
    expect(ids('Reactive programming')).toEqual([]);
  });
  it('prefers the longest alias', () => {
    expect(ids('Built apps with React Native and React.')).toEqual(['react', 'react-native']);
    expect(ids('Ruby on Rails')).toEqual(['ruby-on-rails']);
  });
  it('handles symbol-bearing skills', () => {
    expect(ids('Strong C++ and C# skills, plus .NET and Node.js')).toEqual(['cpp', 'csharp', 'dotnet', 'nodejs']);
    expect(ids('Wrote F# and Objective-C')).toEqual(['fsharp', 'objective-c']);
  });
  it('does not read C++ as C', () => {
    const x = extractSkills(docFromText('We write C++ daily.'));
    expect(x.ids).toEqual(['cpp']);
  });
  it('does not match inside file names or member access', () => {
    expect(ids('open main.py and config.rb')).toEqual([]);
    expect(ids('call Java.util.List')).toEqual([]);
  });
  it('matches multi-word aliases', () => {
    expect(ids('machine learning, data warehousing and ci/cd')).toEqual(['continuous-integration', 'data-warehousing', 'machine-learning']);
  });
  it('is not fooled by case folding of non-ASCII text', () => {
    const t = 'İstanbul office. We use Python.';
    const d = docFromText(t);
    const x = extractSkills(d);
    expect(x.ids).toEqual(['python']);
    expect(x.hits[0]!.evidence[0]!.quote).toBe('Python');
    expect(t.slice(x.hits[0]!.evidence[0]!.start, x.hits[0]!.evidence[0]!.end)).toBe('Python');
  });
  it('treats case-sensitive skills exactly', () => {
    expect(ids('We love react, redux')).toEqual(['react', 'redux']); // lowercaseOk, list context
    expect(ids('Must react quickly to issues')).toEqual([]); // lowercase verb
    expect(ids('Build with React and TypeScript')).toContain('react');
    expect(ids('pandas, numpy')).toEqual(['numpy', 'pandas']);
    expect(ids('Flask, Django')).toEqual(['django', 'flask']);
  });
  it('returns nothing for empty text', () => {
    const x = extractSkills(docFromText(''));
    expect(x.ids).toEqual([]);
    expect(x.hits).toEqual([]);
    expect(x.trace.outcome).toBe('null');
  });
});

describe('ambiguous tokens', () => {
  it('counts Go in a skills list', () => {
    expect(ids('Python, Go, or Java')).toContain('go');
    expect(ids('Python, Go, or Java')).toEqual(['go', 'java', 'python']);
  });
  it('counts Golang anywhere', () => {
    const x = extractSkills(docFromText('Experience with Golang is valuable.'));
    expect(x.ids).toEqual(['go']);
    expect(x.hits[0]!.ruleId).toBe('skills.context.golang');
  });
  it('never counts go-to-market, "Go to", "on the go" or a sentence-initial Go', () => {
    expect(ids('Own the go-to-market plan.')).not.toContain('go');
    expect(ids('Go to market with Python tooling.')).not.toContain('go');
    expect(ids('Always on the go.')).toEqual([]);
    expect(ids('We ship fast.\nGo beyond the brief.')).toEqual([]);
    expect(ids('Please go ahead and apply. Go for it.')).toEqual([]);
  });
  it('never counts the R in R&D', () => {
    expect(ids('Work in R&D with our R&D team.')).toEqual([]);
    expect(idsHtml('<p>Join our R&amp;D group</p>')).toEqual([]);
  });
  it('counts R only in a list or parenthetical', () => {
    expect(ids('Statistics tools (R, Python) required')).toEqual(expect.arrayContaining(['python', 'r']));
    expect(ids('Fluent in Python, R and SQL')).toEqual(['python', 'r', 'sql']);
    expect(ids('Plan R before launch')).toEqual([]);
  });
  it('requires context for C, Swift, Rust, Spark and Excel', () => {
    expect(ids('Swift is a great bird. Rust never sleeps. Excel at your job.')).toEqual([]);
    expect(ids('Languages: Swift, Kotlin and Rust')).toEqual(['kotlin', 'rust', 'swift']);
    expect(ids('Knowledge of C, C++ and Java')).toEqual(['c', 'cpp', 'java']);
    expect(ids('Spark Networks hired us')).toEqual([]);
    expect(ids('Hadoop, Spark and Hive')).toEqual(expect.arrayContaining(['apache-spark', 'apache-hadoop']));
    expect(ids('Advanced Excel, SQL')).toContain('microsoft-excel');
  });
  it('counts strong aliases of context skills on their own', () => {
    expect(ids('Experience with PySpark pipelines')).toEqual(['apache-spark']);
    expect(ids('Apache Spark jobs')).toEqual(['apache-spark']);
  });
  it('counts a context token inside a parenthetical list of other skills', () => {
    const x = extractSkills(docFromText('Backend languages (e.g. Python or Go)'));
    expect(x.ids).toContain('go');
  });
  it('records why an ambiguous token was rejected', () => {
    const x = extractSkills(docFromText('Own the go-to-market plan. R&D matters. Go beyond.'));
    const rejects = x.trace.steps.filter((s) => s.op === 'reject');
    expect(rejects.length).toBeGreaterThanOrEqual(1);
    expect(rejects.every((s) => s.ruleId === 'skills.context.rejected' && s.evidence.length === 1)).toBe(true);
  });
  it('lets a list start at the beginning of a bullet', () => {
    expect(ids('Go, Python, Java')).toEqual(['go', 'java', 'python']);
  });
});

describe('hits, lists and evidence', () => {
  it('flags inSkillsList for comma lists of at least two other skills', () => {
    const x = extractSkills(docFromText('Python, Django, Postgres, Redis and more'));
    expect(x.hits.every((h) => h.inSkillsList)).toBe(true);
    const y = extractSkills(docFromText('We love Python. Also Docker.'));
    expect(y.hits.every((h) => !h.inSkillsList)).toBe(true);
  });
  it('keeps only the first five evidence spans but counts them all', () => {
    const x = extractSkills(docFromText(Array.from({ length: 8 }, () => 'Python rocks').join('\n')));
    const h = x.hits[0]!;
    expect(h.count).toBe(8);
    expect(h.evidence).toHaveLength(5);
    expect(h.evidence.map((e) => e.start)).toEqual([...h.evidence.map((e) => e.start)].sort((a, b) => a - b));
  });
  it('quotes exactly what the span covers', () => {
    const d = docFromText('Needs React and TypeScript');
    for (const h of extractSkills(d).hits) for (const e of h.evidence) {
      expect(d.text.slice(e.start, e.end)).toBe(e.quote);
      expect(e.source).toBe('description');
    }
  });
  it('reads skills from the title with title-source evidence', () => {
    const x = extractSkills(docFromText('Build systems.'), undefined, 'Senior Rust Engineer (Kubernetes)');
    expect(x.ids).toEqual(['kubernetes']);
    expect(x.hits[0]!.evidence[0]).toMatchObject({ source: 'title', quote: 'Kubernetes' });
  });
  it('sorts ids and produces a valid trace', () => {
    const x = extractSkills(docFromText('Terraform, AWS, Python'));
    expect(x.ids).toEqual([...x.ids].sort());
    expect(isTrace(x.trace)).toBe(true);
    expect(x.trace.subject).toBe('skills');
    expect(x.trace.outcome).toBe('value');
    expect(JSON.parse(JSON.stringify(x))).toEqual(x);
  });
  it('is deterministic', () => {
    const d = docFromText('Python, Go, SQL; Kubernetes (Helm, Istio)');
    expect(JSON.stringify(extractSkills(d))).toBe(JSON.stringify(extractSkills(d)));
  });
  it('caps the trace at 64 steps', () => {
    const text = Array.from({ length: 120 }, () => 'Go to the go-to-market plan').join('\n');
    const x = extractSkills(docFromText(text));
    expect(x.trace.steps.length).toBeLessThanOrEqual(64);
    expect(isTrace(x.trace)).toBe(true);
  });
});

describe('occurrences and helpers', () => {
  it('restricts occurrences to a span', () => {
    const d = docFromText('Python is required\nGo, Rust and Zig are a plus');
    const occ = skillOccurrences(d);
    const first = d.blocks[0]!;
    expect(skillIdsInRange(occ, first.start, first.end)).toEqual(['python']);
    const second = d.blocks[1]!;
    expect(skillIdsInRange(occ, second.start, second.end)).toEqual(['go', 'rust', 'zig']);
  });
  it('exposes index lookups', () => {
    const idx = defaultSkillIndex();
    expect(hasSkill(idx, 'python')).toBe(true);
    expect(hasSkill(idx, 'nope')).toBe(false);
    expect(skillLabel(idx, 'python')).toBe('Python');
    expect(skillLabel(idx, 'nope')).toBeNull();
    expect(skillCategory(idx, 'python')).toBe('language');
  });
});

describe('adjacency', () => {
  const idx = defaultSkillIndex();
  it('returns same, adjacent or none', () => {
    expect(adjacency(idx, 'python', 'python')).toBe('same');
    expect(adjacency(idx, 'python', 'pandas')).toBe('adjacent');
    expect(adjacency(idx, 'pandas', 'python')).toBe('adjacent');
    expect(adjacency(idx, 'python', 'photoshop')).toBe('none');
    expect(adjacency(idx, 'python', 'unknown-skill')).toBe('none');
  });
  it('treats close tools as adjacent', () => {
    expect(adjacency(idx, 'postgresql', 'mysql')).toBe('adjacent');
    expect(adjacency(idx, 'aws', 'google-cloud')).toBe('adjacent');
    expect(adjacency(idx, 'react', 'vue')).toBe('adjacent');
  });
});

describe('real fixture phrasing', () => {
  it('does not extract r from the Ashby R&amp;D sentence', () => {
    const d = toDoc('<p>Our R&amp;D organization partners with go-to-market teams.</p><ul><li>Python, SQL</li></ul>');
    expect(d.text).toContain('R&D');
    const got = extractSkills(d).ids;
    expect(got).toEqual(expect.arrayContaining(['python', 'sql']));
    expect(got).not.toContain('r');
    expect(got).not.toContain('go');
  });
});
