import { describe, expect, it } from 'vitest';
import rulesJson from '../data/cgpa-rules.json';
import { applyCgpaRule } from '../src/eligibility/cgpa';
import { evaluateEligibility, parseCriteria } from '../src/eligibility';
import { findUniversityRule, resolveUniversityRule, toCgpaRule, universityRules } from '../src/eligibility/university';

describe('cgpa-rules.json', () => {
  const rows = universityRules();
  it('has at least 25 universities, ids unique, none assumed from another university', () => {
    expect(rows.length).toBeGreaterThanOrEqual(25);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    for (const r of rows) expect(r.note, r.id).not.toMatch(/assumed to follow/i);
  });
  it('names the universities the PRD asks for', () => {
    for (const id of ['aktu', 'rgpv', 'vtu', 'mumbai', 'sppu', 'anna', 'jntuh', 'gtu', 'makaut', 'cbse']) expect(rows.some((r) => r.id === id), id).toBe(true);
  });
  it('every row carries formula, source_url, checked_on and a boolean verified', () => {
    for (const r of rows) {
      expect(r.formula.length, r.id).toBeGreaterThan(5);
      expect(r.source_url, r.id).toMatch(/^https:\/\//);
      expect(r.checked_on, r.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof r.verified, r.id).toBe('boolean');
      expect(r.check_method.length, r.id).toBeGreaterThan(0);
    }
  });
  it('every row converts its own example (conversion test per row)', () => {
    for (const r of rows) {
      if (r.variants) {
        // A scheme-keyed row has no single formula: each variant converts its own example.
        expect(toCgpaRule(r), r.id).toBeNull();
        for (const v of r.variants) expect(applyCgpaRule(v.example.cgpa, { kind: 'linear', a: v.a, b: v.b }), `${r.id}/${v.id}`).toBeCloseTo(v.example.pct, 2);
      } else if (r.disputed) {
        // A disputed row is never converted; the historical formula is kept for the record only.
        expect(toCgpaRule(r), r.id).toBeNull();
        expect(applyCgpaRule(r.example.cgpa, { kind: 'linear', a: r.a as number, b: r.b as number }), r.id).toBeCloseTo(r.example.pct, 2);
      } else expect(applyCgpaRule(r.example.cgpa, toCgpaRule(r)), r.id).toBeCloseTo(r.example.pct, 2);
    }
  });
  it('the printed formula matches a and b', () => {
    for (const r of rows.filter((x) => x.a !== null && x.b !== null)) {
      const a = r.a as number;
      const b = r.b as number;
      const nums = [...r.formula.matchAll(/\d+(?:\.\d+)?/g)].map((m) => parseFloat(m[0]));
      if (b === 0) expect(nums, r.id).toContain(a);
      else if (a === 10 && b < 0) expect(nums, r.id).toContain(-b / 10);
      else expect(nums, r.id).toEqual(expect.arrayContaining([a, b]));
    }
    for (const v of rows.flatMap((x) => x.variants ?? [])) {
      const nums = [...v.formula.matchAll(/\d+(?:\.\d+)?/g)].map((m) => parseFloat(m[0]));
      if (v.b === 0) expect(nums, v.id).toContain(v.a);
      else expect(nums, v.id).toContain(-v.b / v.a);
    }
  });
  it('no row is marked verified without a fetched check', () => {
    for (const r of rows) if (r.verified) expect(r.check_method, r.id).toMatch(/^fetched/);
  });
  it('the file has not drifted from the typed view', () => {
    expect(rows.length).toBe((rulesJson as { rules: unknown[] }).rules.length);
  });
});

describe('findUniversityRule', () => {
  it('matches id, name and alias, ignoring case, dots and punctuation', () => {
    expect(findUniversityRule('RGPV')?.id).toBe('rgpv');
    expect(findUniversityRule('  Visvesvaraya Technological University ')?.id).toBe('vtu');
    expect(findUniversityRule('Dr. A.P.J. Abdul Kalam Technical University')?.id).toBe('aktu');
    expect(findUniversityRule('Mumbai University')?.id).toBe('mumbai');
    expect(findUniversityRule('jntu-hyderabad')?.id).toBe('jntuh');
  });
  it('finds a rule inside a longer college line', () => {
    expect(findUniversityRule('ABC Institute of Technology, affiliated to VTU, Belagavi')?.id).toBe('vtu');
  });
  it('a place name inside a longer line is not a university', () => {
    expect(findUniversityRule('Nirma University, Ahmedabad, Gujarat')).toBeNull();
    expect(findUniversityRule('XYZ Deemed University, Mumbai')).toBeNull();
    expect(findUniversityRule('Some College, Pondicherry')).toBeNull();
  });
  it('returns null for nothing, unknown names and non-strings', () => {
    for (const q of ['', '   ', 'Hogwarts University', null, undefined, 7 as unknown as string]) expect(findUniversityRule(q as string)).toBeNull();
  });
  it('short aliases need an exact match, so "mu" does not hit inside words', () => {
    expect(findUniversityRule('community college')).toBeNull();
    expect(findUniversityRule('MU')?.id).toBe('mumbai');
  });
});

describe('toCgpaRule', () => {
  it('returns the linear campus-style rule', () => {
    expect(toCgpaRule(findUniversityRule('rgpv')!)).toEqual({ kind: 'linear', a: 9.5, b: 0 });
    expect(toCgpaRule(findUniversityRule('vtu')!, { scheme: '2018' })).toEqual({ kind: 'linear', a: 10, b: -7.5 });
    expect(toCgpaRule(findUniversityRule('vtu')!, { scheme: '2022' })).toEqual({ kind: 'linear', a: 10, b: 0 });
  });
  it('returns null when the rule needs a scheme that is not given, or is disputed', () => {
    expect(toCgpaRule(findUniversityRule('vtu')!)).toBeNull();
    expect(toCgpaRule(findUniversityRule('mumbai')!)).toBeNull();
  });
});

const GRAD = { confirmed: true as const, grad_score: 8, grad_scale: 10 as const };
const crit = parseCriteria('Minimum 60% aggregate in graduation');
const verdict = (rule: string, extra: Partial<NonNullable<Parameters<typeof evaluateEligibility>[2]>> = {}) =>
  evaluateEligibility(crit, GRAD, { cgpaRule: null, universityRule: findUniversityRule(rule), universityRuleConfirmed: true, ...extra }).verdicts[0]!;

describe('VTU: the formula depends on the scheme', () => {
  const vtu = findUniversityRule('vtu')!;
  it('has two variants keyed by scheme and admission year, with the 2015/2017/2018 and 2021/2022 schemes split', () => {
    expect(vtu.a).toBeNull();
    expect(vtu.b).toBeNull();
    const byId = Object.fromEntries((vtu.variants ?? []).map((v) => [v.id, v]));
    expect(byId['2015-2018']).toMatchObject({ schemes: ['2015', '2017', '2018'], a: 10, b: -7.5 });
    expect(byId['2021-2022']).toMatchObject({ schemes: ['2021', '2022'], a: 10, b: 0 });
    expect(vtu.verified).toBe(false);
    expect(vtu.source_urls?.length).toBeGreaterThanOrEqual(2);
  });
  it('the 2018 scheme uses (CGPA - 0.75) x 10; the 2021 and 2022 schemes use CGPA x 10', () => {
    expect(resolveUniversityRule(vtu, { scheme: '2018' })).toMatchObject({ ok: true, rule: { a: 10, b: -7.5 } });
    expect(resolveUniversityRule(vtu, { scheme: '2017' })).toMatchObject({ ok: true, rule: { a: 10, b: -7.5 } });
    expect(resolveUniversityRule(vtu, { scheme: '2015' })).toMatchObject({ ok: true, rule: { a: 10, b: -7.5 } });
    expect(resolveUniversityRule(vtu, { scheme: '2021' })).toMatchObject({ ok: true, rule: { a: 10, b: 0 } });
    expect(resolveUniversityRule(vtu, { scheme: '2022' })).toMatchObject({ ok: true, rule: { a: 10, b: 0 } });
  });
  it('reads a scheme typed as "2022 scheme" or "VTU 2018"', () => {
    expect(resolveUniversityRule(vtu, { scheme: '2022 scheme' })).toMatchObject({ ok: true, rule: { b: 0 } });
    expect(resolveUniversityRule(vtu, { scheme: 'VTU 2018' })).toMatchObject({ ok: true, rule: { b: -7.5 } });
  });
  it('2026 passout (admitted 2022, 2022 scheme): 8.0 CGPA is 80.0%, not 72.5%', () => {
    const v = verdict('vtu', { cgpaRule: null, admissionYear: 2022 });
    expect(v.status).toBe('pass');
    expect(v.reason).toBe("8.0 CGPA = 80.0% by VTU's rule, needs 60%: you meet it");
    const scheme = verdict('vtu', { cgpaRule: null, universityScheme: '2022' });
    expect(scheme.reason).toBe(v.reason);
  });
  it('2026 passout with a cutoff between 72.5 and 80: the old formula would fail, the 2022 scheme passes', () => {
    const c = parseCriteria('Minimum 75% aggregate in graduation');
    const prof = { ...GRAD, passout_year: 2026 };
    const base = { cgpaRule: null, universityRule: vtu, universityRuleConfirmed: true };
    expect(evaluateEligibility(c, prof, { ...base, universityScheme: '2022' }).verdicts[0]!.status).toBe('pass');
    expect(evaluateEligibility(c, prof, { ...base, universityScheme: '2018' }).verdicts[0]!.status).toBe('fail');
  });
  it('a 2018-scheme student: 8.0 CGPA = 72.5%', () => {
    expect(verdict('vtu', { cgpaRule: null, universityScheme: '2018' }).reason).toBe("8.0 CGPA = 72.5% by VTU's rule, needs 60%: you meet it");
  });
  it('no scheme and no admission year: UNKNOWN, asks which scheme, never guesses (even when confirmed)', () => {
    const v = verdict('vtu');
    expect(v.status).toBe('unknown');
    expect(v.reason).toContain("We couldn't check: which VTU scheme are you on?");
    expect(v.reason).not.toMatch(/72\.5|80\.0/);
    for (const bad of ['', '   ', 'new scheme', '2019', '2099', null, undefined]) {
      expect(verdict('vtu', { cgpaRule: null, universityScheme: bad as string }).status, String(bad)).toBe('unknown');
    }
  });
  it('an admission year the table does not map is UNKNOWN, not nearest-year', () => {
    for (const y of [2016, 2019, 2020, 2023, 2024, 1900, Number.NaN]) expect(verdict('vtu', { cgpaRule: null, admissionYear: y }).status, String(y)).toBe('unknown');
  });
  it('admission year maps to its scheme, and a scheme that contradicts the admission year is UNKNOWN', () => {
    expect(resolveUniversityRule(vtu, { admissionYear: 2018 })).toMatchObject({ ok: true, rule: { b: -7.5 } });
    expect(resolveUniversityRule(vtu, { admissionYear: 2021 })).toMatchObject({ ok: true, rule: { b: 0 } });
    expect(resolveUniversityRule(vtu, { scheme: '2022', admissionYear: 2018 })).toMatchObject({ ok: false });
    expect(resolveUniversityRule(vtu, { scheme: '2022', admissionYear: 2022 })).toMatchObject({ ok: true, rule: { b: 0 } });
  });
  it('the row is unverified, so an unconfirmed VTU rule is still UNKNOWN even with a scheme', () => {
    const v = evaluateEligibility(crit, GRAD, { cgpaRule: null, universityRule: vtu, universityScheme: '2022' }).verdicts[0]!;
    expect(v.status).toBe('unknown');
    expect(v.reason).toContain('not confirmed');
  });
  it('a campus rule no longer overrides the VTU table: with no scheme the verdict is unknown (review finding, HIGH)', () => {
    const r = evaluateEligibility(crit, GRAD, { cgpaRule: { kind: 'linear', a: 9, b: 0 }, universityRule: vtu }).verdicts[0]!;
    expect(r.status).toBe('unknown');
    expect(r.reason).toContain('which VTU scheme');
  });
});

describe('AKTU: (CGPA - 0.75) x 10, unverified, third-party consensus', () => {
  const aktu = findUniversityRule('aktu')!;
  it('records the formula, sources and check method', () => {
    expect(toCgpaRule(aktu)).toEqual({ kind: 'linear', a: 10, b: -7.5 });
    expect(aktu.verified).toBe(false);
    expect(aktu.check_method).toBe('third_party_consensus_ordinance_cited');
    expect(aktu.source_urls).toEqual(expect.arrayContaining(['https://knwdle.com/tools/aktu-cgpa-to-percentage-calculator', 'https://academic.exammint.in/tools/aktu-cgpa-to-percentage-calculator/']));
    expect(aktu.example).toEqual({ cgpa: 8, pct: 72.5 });
    expect(aktu.note).toMatch(/2018-19/);
  });
  it('8.0 CGPA = 72.5% once confirmed; unknown until then', () => {
    expect(verdict('aktu').reason).toBe("8.0 CGPA = 72.5% by AKTU's rule, needs 60%: you meet it");
    const un = evaluateEligibility(crit, GRAD, { cgpaRule: null, universityRule: aktu }).verdicts[0]!;
    expect(un.status).toBe('unknown');
  });
});

describe('Mumbai: disputed, unknown until verified', () => {
  const mu = findUniversityRule('mumbai')!;
  it('is marked disputed with the circular that may have repealed it', () => {
    expect(mu.disputed).toMatchObject({ since: '2026-01-01' });
    expect(mu.disputed?.reason).toMatch(/Exam\/Result\/803 of 2026/);
    expect(mu.verified).toBe(false);
  });
  it('is UNKNOWN with "Use the percentage on your marksheet", even when the student confirmed the rule', () => {
    const v = verdict('mumbai');
    expect(v.status).toBe('unknown');
    expect(v.reason).toContain('Use the percentage on your marksheet');
    expect(v.reason).not.toMatch(/67\.8/);
  });
  it('a verified flag cannot un-dispute it', () => {
    const forced = { ...mu, verified: true };
    const v = evaluateEligibility(crit, GRAD, { cgpaRule: null, universityRule: forced }).verdicts[0]!;
    expect(v.status).toBe('unknown');
  });
  it('the percentage on the marksheet still works (direct)', () => {
    const v = evaluateEligibility(crit, { ...GRAD, grad_conversion: 'direct', grad_pct_equiv: 66 }, { cgpaRule: null, universityRule: mu, universityRuleConfirmed: true }).verdicts[0]!;
    expect(v.status).toBe('pass');
  });
  it('a campus rule no longer overrides a disputed university row: unknown (review finding, HIGH)', () => {
    const v = evaluateEligibility(crit, GRAD, { cgpaRule: { kind: 'linear', a: 10, b: 0 }, universityRule: mu }).verdicts[0]!;
    expect(v.status).toBe('unknown');
  });
});

describe('Anna University: official source recorded, unverified', () => {
  const anna = findUniversityRule('anna')!;
  it('cites the official PDF, its Lr.No., scope and the failed fetch', () => {
    expect(anna.source_url).toBe('https://acoe.annauniv.edu/download_forms/student_forms/CGPA_TO_PERCENTAGE_CONVERSION.pdf');
    expect(anna.source_kind).toBe('official_pdf');
    expect(anna.source_document).toBe('Lr.No. 3452/AU/CAC/CGPA2020 dated 29.12.2020');
    expect(anna.scope).toEqual(['R-2015', 'R-2018', 'R-2019']);
    expect(anna.verified).toBe(false);
    expect(anna.check_method).toMatch(/timed_out/);
    expect(anna.note).toMatch(/R2021/);
    expect(toCgpaRule(anna)).toEqual({ kind: 'linear', a: 10, b: 0 });
  });
});

describe('JNTUH: sources recorded', () => {
  const j = findUniversityRule('jntuh')!;
  it('cites clause 11.2 of the B.Tech regulations and both third-party URLs, still unverified', () => {
    expect(j.source_urls).toEqual(expect.arrayContaining(['https://scholarkit.org/tools/cgpa-calculator/jntu/', 'https://mycgpatopercentage.in/jntuh-cgpa-to-percentage']));
    expect(j.note).toMatch(/11\.2/);
    expect(j.note).toMatch(/R16/);
    expect(j.verified).toBe(false);
    expect(toCgpaRule(j)).toEqual({ kind: 'linear', a: 10, b: -5 });
  });
});

describe('rows with extra evidence carry well-formed fields', () => {
  it('source_urls are https, variants are non-empty and cover distinct schemes', () => {
    for (const r of universityRules()) {
      for (const u of r.source_urls ?? []) expect(u, r.id).toMatch(/^https:\/\//);
      if (r.variants) {
        expect(r.variants.length, r.id).toBeGreaterThan(1);
        const all = r.variants.flatMap((v) => v.schemes);
        expect(new Set(all).size, r.id).toBe(all.length);
      }
    }
  });
});
