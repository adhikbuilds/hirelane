import type { ServiceCtx } from '../ctx';
import { ServiceError } from '../errors';
import { parseInput } from '../schema';
import { domainOf, mailboxHmac, normalizeMailbox } from './codes';
import { CsvError, parseCsv } from './csv';
import { RosterImportInput } from './inputs';
import { callIn } from './rpc';
import { orNotFound, staffTx } from './tpo';

export const MAX_ROSTER_BYTES = 1024 * 1024;
export const MAX_ROSTER_ROWS = 20_000;

const EMAIL_HEADER = /^(e-?mail(?:[ _-]?(?:id|address))?|mail(?:[ _-]?id)?)$/i;
const PLACED_HEADER = /^(placed|is[ _-]?placed|placement|placement[ _-]?status|status)$/i;
const PLACED_VALUE = /^(1|y|yes|t|true|placed)$/i;

export interface RosterResult {
  rowsTotal: number;
  rowsValid: number;
  rowsRejected: number;
}

/** Fewest valid rows an import may carry: a smaller file is a probe for one student (the same k as every published count). */
export const MIN_ROSTER_ROWS = 10;

/**
 * Cohort CSV import (C7). Reads an export with an email column and an optional placed column, normalises each address,
 * keeps only its keyed hash and the placed flag, and hands the hashes to the database. The CSV text, the plain addresses and
 * everything else in the file (names, roll numbers) are dropped here and never stored or logged. cohort_imports keeps counts.
 * Only rows on the campus's registered domains are kept, a file with fewer than 10 valid rows is refused, one import per cohort
 * per 24 hours, and the result carries no match count. An import only stages the roster: members change when the nightly
 * snapshot applies it.
 * Parsed inline with byte and row caps (the HLD sketches a worker; a 1 MB cap makes that unnecessary for now).
 */
export async function importRoster(ctx: ServiceCtx, input: unknown, bytes: Buffer): Promise<RosterResult> {
  const { cohortId } = parseInput(RosterImportInput, input);
  if (bytes.length === 0) throw new ServiceError('empty_file', 400);
  if (bytes.length > MAX_ROSTER_BYTES) throw new ServiceError('file_too_large', 413);
  let parsed;
  try {
    parsed = parseCsv(bytes.toString('utf8'), { maxRows: MAX_ROSTER_ROWS });
  } catch (e) {
    if (e instanceof CsvError) throw new ServiceError(e.code === 'too_many_rows' ? 'too_many_rows' : 'bad_csv', e.code === 'too_many_rows' ? 413 : 400);
    throw e;
  }
  const emailAt = parsed.header.findIndex((h) => EMAIL_HEADER.test(h));
  if (emailAt < 0) throw new ServiceError('missing_email_column', 400);
  const placedAt = parsed.header.findIndex((h) => PLACED_HEADER.test(h));

  const byMailbox = new Map<string, { placed: boolean; d: string }>();
  let rejected = 0;
  for (const row of parsed.rows) {
    const mail = normalizeMailbox(row[emailAt] ?? '');
    if (!mail) {
      rejected++;
      continue;
    }
    byMailbox.set(await mailboxHmac(ctx.keys, mail), { placed: placedAt >= 0 ? PLACED_VALUE.test((row[placedAt] ?? '').trim()) : false, d: domainOf(mail) });
  }
  if (byMailbox.size === 0) throw new ServiceError('no_valid_rows', 400);
  // The domain travels with the hash so the database can keep only rows on the campus's registered domains (the hash alone
  // cannot be checked). It is not stored.
  const rows = [...byMailbox].map(([h, v]) => ({ h, d: v.d, placed: v.placed }));
  return staffTx(ctx, async (c) => {
    const r = orNotFound(await callIn<(RosterResult & { status: 'imported' }) | { status: 'too_few' | 'rate_limited' } | null>(c, 'tpo_import_roster', [cohortId, JSON.stringify(rows), parsed.rows.length, rejected]));
    if (r.status === 'too_few') throw new ServiceError('too_few_rows', 400);
    if (r.status !== 'imported') throw new ServiceError('import_rate_limited', 429);
    return { rowsTotal: r.rowsTotal, rowsValid: r.rowsValid, rowsRejected: r.rowsRejected };
  });
}
