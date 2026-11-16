import { describe, expect, it } from 'vitest';
import { summarizeRoster } from '../src/campus/roster-preview';
import { importRoster, MIN_ROSTER_ROWS } from '../src/campus';

const csv = (rows: string[], header = 'Name,Email,Placed'): Buffer => Buffer.from([header, ...rows].join('\r\n') + '\r\n');
const people = (n: number, domain = 'college.example.test'): string[] => Array.from({ length: n }, (_, i) => `Student ${i},s${i}@${domain},${i % 4 === 0 ? 'Yes' : ''}`);

describe('roster preview counts', () => {
  it('counts rows, valid emails and duplicates, and says what it used', () => {
    const p = summarizeRoster(csv([...people(12), 'Dup,S3@College.example.test,', 'Bad,not-an-email,', 'Blank,,']));
    expect(p).toMatchObject({ rowsTotal: 15, validEmails: 13, invalidEmails: 2, duplicates: 1, uniqueEmails: 12, columns: { email: 'Email', placed: 'Placed' }, headers: ['Name', 'Email', 'Placed'], belowMinimum: false, canStage: true, domainCheck: 'on_import' });
  });

  it('a repeated address differing only in case or spaces is a duplicate', () => {
    const p = summarizeRoster(csv(['A,a@x.example.test,', 'B, A@X.example.test ,', 'C,c@x.example.test,']));
    expect(p).toMatchObject({ validEmails: 3, duplicates: 1, uniqueEmails: 2 });
  });

  it('counts placed only among different addresses, and null when there is no placed column', () => {
    expect(summarizeRoster(csv(people(12))).placed).toBe(3);
    expect(summarizeRoster(Buffer.from('email\r\n' + people(12).map((r) => r.split(',')[1]).join('\r\n'))).placed).toBeNull();
    expect(summarizeRoster(Buffer.from('email\r\na@x.example.test\r\n')).columns).toEqual({ email: 'email', placed: null });
  });

  it('flags a file under the minimum of 10 different addresses and cannot stage it', () => {
    expect(MIN_ROSTER_ROWS).toBe(10);
    const nine = summarizeRoster(csv(people(9)));
    expect(nine).toMatchObject({ uniqueEmails: 9, belowMinimum: true, canStage: false });
    // twelve rows but only nine different addresses: still under
    expect(summarizeRoster(csv([...people(9), ...people(3)])).canStage).toBe(false);
    expect(summarizeRoster(csv(people(10))).canStage).toBe(true);
  });

  it('never carries an address, a name or a cell of the file in the answer', () => {
    const p = summarizeRoster(csv([...people(11), 'Secret Name,secret.person@college.example.test,Yes']));
    const json = JSON.stringify(p);
    expect(json).not.toMatch(/secret|@|Student \d/i);
  });

  it('uses the same checks as the import: no email column, empty, too big, too many rows', () => {
    expect(() => summarizeRoster(Buffer.from('name,roll\r\nA,1\r\n'))).toThrow(expect.objectContaining({ code: 'missing_email_column', status: 400 }));
    expect(() => summarizeRoster(Buffer.alloc(0))).toThrow(expect.objectContaining({ code: 'empty_file', status: 400 }));
    expect(() => summarizeRoster(Buffer.alloc(1024 * 1024 + 1, 97))).toThrow(expect.objectContaining({ code: 'file_too_large', status: 413 }));
    expect(() => summarizeRoster(Buffer.from('email\r\n' + 'a@x.example.test\r\n'.repeat(20_001)))).toThrow(expect.objectContaining({ code: 'too_many_rows', status: 413 }));
    expect(() => summarizeRoster(Buffer.from('email\r\n"unterminated'))).toThrow(expect.objectContaining({ code: 'bad_csv' }));
  });

  it('a formula in a cell is only counted, never evaluated or echoed', () => {
    const p = summarizeRoster(csv(['=HYPERLINK("http://evil.example.test"),=cmd|x@y.example.test,', ...people(10)]));
    expect(JSON.stringify(p)).not.toMatch(/evil|cmd|HYPERLINK/);
  });

  it('maps columns the person chose: a "College Email" column, or a file whose "Status" is not a placed flag', () => {
    const file = csv(people(12), 'Name,College Email,Placement Round');
    expect(() => summarizeRoster(file)).toThrow(expect.objectContaining({ code: 'missing_email_column' }));
    const p = summarizeRoster(file, { email: 'college email', placed: 'Placement Round' });
    expect(p).toMatchObject({ validEmails: 12, columns: { email: 'College Email', placed: 'Placement Round' }, headers: ['Name', 'College Email', 'Placement Round'] });
    // placed: null overrides a header that merely looks like a placed column
    expect(summarizeRoster(csv(people(12), 'Name,Email,Status'), { placed: null }).placed).toBeNull();
    expect(() => summarizeRoster(file, { email: 'College Email', placed: 'Nope' })).toThrow(expect.objectContaining({ code: 'missing_placed_column' }));
  });

  it('is the same reading as the import: the import is still exported', () => {
    expect(typeof importRoster).toBe('function');
  });
});
