import { describe, expect, it } from 'vitest';
import { CsvError, parseCsv, safeCell, toCsv } from '../src/campus/csv';

describe('parseCsv', () => {
  it('reads a header and rows, CRLF or LF, with a BOM', () => {
    const r = parseCsv('﻿email,placed\r\na@x.edu,yes\nb@x.edu,no\n');
    expect(r.header).toEqual(['email', 'placed']);
    expect(r.rows).toEqual([['a@x.edu', 'yes'], ['b@x.edu', 'no']]);
  });

  it('handles quoted fields with commas, quotes and newlines', () => {
    const r = parseCsv('name,note\n"Rao, A","said ""hi""\nthere"\n');
    expect(r.rows).toEqual([['Rao, A', 'said "hi"\nthere']]);
  });

  it('skips blank lines and keeps empty cells', () => {
    expect(parseCsv('a,b,c\n\n1,,3\n\n').rows).toEqual([['1', '', '3']]);
  });

  it('errors on an unterminated quote, an empty file, and too many rows', () => {
    expect(() => parseCsv('a,b\n"x,y\n')).toThrow(CsvError);
    expect(() => parseCsv('')).toThrow(CsvError);
    expect(() => parseCsv('\n\n')).toThrow(CsvError);
    const big = 'e\n' + 'a@x.edu\n'.repeat(30);
    expect(() => parseCsv(big, { maxRows: 10 })).toThrowError(expect.objectContaining({ code: 'too_many_rows' }));
    expect(parseCsv(big, { maxRows: 30 }).rows).toHaveLength(30);
  });

  it('does not treat a quote in the middle of a field as a quoted field', () => {
    expect(parseCsv('a\nab"c\n').rows).toEqual([['ab"c']]);
  });
});

describe('CSV injection safety', () => {
  it.each(['=1+1', '+SUM(A1)', '-2+3', '@SUM(1)', '\tcmd', '\rcmd', '  =1+1', '=HYPERLINK("http://x.test","a")', '-1'])('prefixes %j', (v) => {
    expect(safeCell(v)).toBe(`'${v}`);
  });

  it.each(['Asha Rao', '6.5', '', 'a=b', 'x-y', 'email@x.edu', "'already"])('leaves %j alone', (v) => {
    expect(safeCell(v)).toBe(v);
  });

  it('treats null and undefined as empty and numbers as text', () => {
    expect(safeCell(null)).toBe('');
    expect(safeCell(undefined)).toBe('');
    expect(safeCell(4.5)).toBe('4.5');
  });

  it('quotes cells with commas, quotes and newlines, after neutralising formulas', () => {
    const out = toCsv(['a', 'b'], [['=cmd|"/c calc"!A0', 'x,y'], ['line1\nline2', 'say "hi"']]);
    expect(out).toBe('a,b\r\n"\'=cmd|""/c calc""!A0","x,y"\r\n"line1\nline2","say ""hi"""\r\n');
  });

  it('a hostile name can never start a formula in the written file', () => {
    const rows = ['=1+1', '+1', '-1', '@x', '\t=1', ' =1'].map((n) => [n]);
    const lines = toCsv(['name'], rows).split('\r\n').slice(1, -1);
    for (const l of lines) expect(/^"?[=+\-@\t]/.test(l)).toBe(false);
  });

  it('round trips through parseCsv with only the quote prefix added', () => {
    const rows = [['Rao, A', 'B.Tech'], ['=evil', 'MBA']];
    const back = parseCsv(toCsv(['n', 'p'], rows));
    expect(back.rows).toEqual([['Rao, A', 'B.Tech'], ["'=evil", 'MBA']]);
  });
});
