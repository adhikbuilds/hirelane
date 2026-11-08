import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/campus/csv';
import { buildNaacCsv, buildNaacReadme, NAAC_HEADER, NAAC_HIGHER_ED_HEADER, NAAC_MANUAL, readNaacPayload, type NaacRow } from '../src/campus/naac';

const split = (csv: string) => {
  const lines = csv.split('\r\n').filter((l) => l !== '');
  // A comment line is one CSV cell (quoted when it has a comma) whose text starts with "# ".
  const isComment = (l: string) => /^"?# /.test(l);
  const text = (l: string) => (l.startsWith('"') ? l.slice(1, -1).replace(/""/g, '"') : l);
  return { comments: lines.filter(isComment).map(text), data: lines.filter((l) => !isComment(l)) };
};
/** Part A only: the data lines before the Part B header. */
const partA = (csv: string) => {
  const d = split(csv).data;
  return d.slice(0, d.findIndex((l) => l.startsWith(NAAC_HIGHER_ED_HEADER[0]))).join('\r\n');
};
const placed = (o: Partial<NaacRow> = {}): NaacRow => ({ year: '2025-26', student: 'Asha Rao', programme: 'B.Tech CSE', employer: 'Acme Test Co', employerContact: null, packageLpa: 6.25, verification: 'student_reported', ...o });

describe('NAAC 5.2.1 header', () => {
  it('placement columns: Year first, employer contact after the employer', () => {
    expect([...NAAC_HEADER]).toEqual(['Year', 'Name of the student placed', 'Program graduated from', 'Name of the employer', 'Employer contact details', 'Pay package at appointment (LPA)', 'Verification']);
  });
  it('higher-education columns: student, programme graduated from, institution joined, programme admitted to', () => {
    expect([...NAAC_HIGHER_ED_HEADER]).toEqual(['Name of the student', 'Program graduated from', 'Name of the institution joined', 'Name of the programme admitted to', 'Verification']);
  });
  it('names the manual: affiliated colleges RAF 2023, where 5.2.1 combines placement and higher education', () => {
    expect(NAAC_MANUAL).toMatch(/affiliated colleges/i);
    expect(NAAC_MANUAL).toMatch(/RAF 2023/);
    expect(NAAC_MANUAL).toMatch(/5\.2\.1/);
    expect(NAAC_MANUAL).toMatch(/placement/i);
    expect(NAAC_MANUAL).toMatch(/higher education/i);
  });
});

describe('buildNaacCsv', () => {
  it('the CSV holds data only: no "# " comment row anywhere, the first line is the Part A header', () => {
    const csv = buildNaacCsv([placed()], []);
    expect(split(csv).comments).toEqual([]);
    expect(csv.split('\r\n')[0]).toBe(NAAC_HEADER.join(','));
    expect(csv).not.toMatch(/(^|\r\n)"?# /);
  });
  it('the notes live in a separate README: manual, unverified template, contact rule, both parts, Year meaning', () => {
    const readme = buildNaacReadme();
    expect(readme).toContain(NAAC_MANUAL);
    expect(readme).toMatch(/not been checked against the official data template/i);
    expect(readme).toMatch(/blank unless the student shared it/i);
    expect(readme).toMatch(/Part A/);
    expect(readme).toMatch(/Part B/);
    expect(readme).toMatch(/academic year/i);
    expect(readme).toMatch(/2025-26/);
  });
  it('writes the placement part with Year and a contact only when the student shared it', () => {
    const csv = buildNaacCsv([placed({ employerContact: 'hr@acme.example.test, +91 90000 00000' }), placed({ student: 'Ben', employerContact: null }), placed({ student: 'Cy', employerContact: '   ' })], []);
    const rows = parseCsv(partA(csv));
    expect(rows.header).toEqual([...NAAC_HEADER]);
    expect(rows.rows).toHaveLength(3);
    expect(rows.rows[0]).toEqual(['2025-26', 'Asha Rao', 'B.Tech CSE', 'Acme Test Co', 'hr@acme.example.test, +91 90000 00000', '6.25', 'student-reported']);
    expect(rows.rows[1]![4]).toBe('');
    expect(rows.rows[2]![4]).toBe('');
  });
  it('a missing package is blank and a TPO-verified row is labelled', () => {
    const rows = parseCsv(partA(buildNaacCsv([placed({ packageLpa: null, verification: 'tpo_verified' })], [])));
    expect(rows.rows[0]![5]).toBe('');
    expect(rows.rows[0]![6]).toBe('TPO-verified');
  });
  it('writes a higher-education section with its own header', () => {
    const he = [{ student: 'Dev Nair', programme: 'B.Tech ECE', institution: 'Test Institute of Science', admittedTo: 'M.Tech VLSI', verification: 'student_reported' as const }];
    const { data } = split(buildNaacCsv([placed()], he));
    const at = data.findIndex((l) => l.startsWith(NAAC_HIGHER_ED_HEADER[0]));
    expect(at).toBeGreaterThan(1);
    const part = parseCsv(data.slice(at).join('\r\n'));
    expect(part.header).toEqual([...NAAC_HIGHER_ED_HEADER]);
    expect(part.rows).toEqual([['Dev Nair', 'B.Tech ECE', 'Test Institute of Science', 'M.Tech VLSI', 'student-reported']]);
  });
  it('with no higher-education records the section is still there, header only', () => {
    const { data } = split(buildNaacCsv([placed()], []));
    expect(data.at(-1)).toBe(NAAC_HIGHER_ED_HEADER.join(','));
  });
  it('a missing year is blank, never 0', () => {
    const rows = parseCsv(partA(buildNaacCsv([placed({ year: null })], [])));
    expect(rows.rows[0]![0]).toBe('');
  });
  it('with no rows at all both headers still print', () => {
    const { data } = split(buildNaacCsv([], []));
    expect(data).toEqual([NAAC_HEADER.join(','), NAAC_HIGHER_ED_HEADER.join(',')]);
  });
  it('neutralises formulas in every cell of both parts, including the contact', () => {
    const csv = buildNaacCsv(
      [placed({ student: '=HYPERLINK("http://evil.example.test","x")', employer: "+cmd|' /C calc'!A0", employerContact: '@SUM(1+1)' })],
      [{ student: '-2+3', programme: '=1+1', institution: '+x', admittedTo: '@y', verification: 'student_reported' as const }],
    );
    for (const line of split(csv).data.slice(1)) expect(line).not.toMatch(/^"?[=+\-@]/);
    expect(csv).toContain(`'@SUM(1+1)`);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example.test"",""x"")"`);
    expect(csv).toContain(`'-2+3`);
  });
  it('quotes and newlines in a cell cannot break the row or fake a comment line', () => {
    const csv = buildNaacCsv([placed({ student: 'A "B"\n# fake', employerContact: 'x,y' })], []);
    const rows = parseCsv(partA(csv));
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]![1]).toBe('A "B"\n# fake');
  });
  it('handles 10k rows', () => {
    const many = Array.from({ length: 10_000 }, (_, i) => placed({ student: `S${i}` }));
    const csv = buildNaacCsv(many, []);
    expect(split(csv).data).toHaveLength(10_000 + 2);
  });
});

describe('readNaacPayload (what the database function returns)', () => {
  it('a plain array of offers (the current function) is placements only, with no contact and no higher education', () => {
    const p = readNaacPayload([{ year: '2025-26', student: 'A', programme: 'P', employer: 'E', packageLpa: 1, verification: 'student_reported' }]);
    expect(p.placements).toHaveLength(1);
    expect(p.placements[0]!.employerContact).toBeNull();
    expect(p.higherEd).toEqual([]);
  });
  it('an object carries both parts', () => {
    const p = readNaacPayload({ placements: [placed({ employerContact: 'hr@x.example.test' })], higherEd: [{ student: 'B', programme: 'P', institution: 'I', admittedTo: 'M', verification: 'tpo_verified' }] });
    expect(p.placements[0]!.employerContact).toBe('hr@x.example.test');
    expect(p.higherEd).toHaveLength(1);
  });
  it('null, junk and non-array parts read as empty, never throw', () => {
    for (const bad of [null, undefined, 7, 'x', {}, { placements: 'no', higherEd: 3 }]) {
      const p = readNaacPayload(bad);
      expect(p, String(bad)).toEqual({ placements: [], higherEd: [] });
    }
  });
  it('the year is the academic year as the database wrote it; a number, junk or nothing reads as blank, not 0', () => {
    const p = readNaacPayload({ placements: [{ year: '2025-26' }, { year: 2026 }, { year: '0' }, { year: '2025-2026' }, {}, { year: null }] });
    expect(p.placements.map((r) => r.year)).toEqual(['2025-26', null, null, null, null, null]);
  });
  it('drops rows that are not objects and coerces missing text to blank', () => {
    const p = readNaacPayload({ placements: [null, 3, { year: '2025-26', employer: 'E' }], higherEd: [null, { student: 'S' }] });
    expect(p.placements).toHaveLength(1);
    expect(p.placements[0]).toMatchObject({ student: '', programme: '', packageLpa: null, employerContact: null });
    expect(p.higherEd).toHaveLength(1);
    expect(p.higherEd[0]).toMatchObject({ student: 'S', institution: '', admittedTo: '' });
  });
});
