/**
 * Small CSV reader and writer, no dependency. Reading is for the roster (email + placed). Writing is for the NAAC export
 * and is formula-injection safe: a cell whose first visible character is = + - @ (or starts with TAB or CR) is prefixed
 * with a single quote, then the cell is quoted when needed.
 */

export interface ParsedCsv {
  header: string[];
  rows: string[][];
}

export class CsvError extends Error {
  constructor(readonly code: 'too_many_rows' | 'unterminated_quote' | 'empty') {
    super(code);
    this.name = 'CsvError';
  }
}

/** RFC 4180: quoted fields, "" for a quote, CRLF or LF, optional BOM. Blank lines are skipped. */
export function parseCsv(text: string, opts: { maxRows?: number } = {}): ParsedCsv {
  const maxRows = opts.maxRows ?? 20_000;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const all: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let sawAny = false;
  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    if (!(row.length === 1 && row[0] === '')) {
      all.push(row);
      if (all.length > maxRows + 1) throw new CsvError('too_many_rows');
    }
    row = [];
    sawAny = false;
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '' && !sawAny) {
      quoted = true;
      sawAny = true;
    } else if (ch === ',') {
      endCell();
      sawAny = false;
    } else if (ch === '\n') endRow();
    else if (ch === '\r') {
      if (src[i + 1] === '\n') i++;
      endRow();
    } else {
      cell += ch;
      sawAny = true;
    }
  }
  if (quoted) throw new CsvError('unterminated_quote');
  if (cell !== '' || row.length > 0) endRow();
  const header = all.shift();
  if (!header) throw new CsvError('empty');
  return { header: header.map((h) => h.trim()), rows: all };
}

/** Neutralises spreadsheet formulas. Numbers the caller formats themselves go through String() first. */
export function safeCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /^[\s]*[=+\-@]/.test(s) || /^[\t\r]/.test(s) ? `'${s}` : s;
}

export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const cell = (v: unknown): string => {
    const s = safeCell(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
