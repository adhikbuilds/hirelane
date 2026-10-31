import type { ServiceCtx } from '../ctx';
import { notFound } from '../errors';
import { parseInput } from '../schema';
import { normalizeMailbox } from './codes';
import { RosterImportInput } from './inputs';
import { isPlacedValue, MIN_ROSTER_ROWS, readRosterCsv, type RosterColumns } from './roster';
import { callIn } from './rpc';
import { staffReadTx, type StaffMembership } from './tpo';

/** What a roster file holds, counted before anything is staged. No address and no cell of the file is in it. */
export interface RosterPreview {
  /** Data rows (the header is not one). */
  rowsTotal: number;
  /** Rows whose email column holds a well-formed address (a repeated address counts each time it appears). */
  validEmails: number;
  /** Rows whose email cell is empty or not an address. */
  invalidEmails: number;
  /** Rows that repeat an address already seen earlier in the file. They add nothing on import. */
  duplicates: number;
  /** Different addresses. This is the figure the import's "at least 10" is about. */
  uniqueEmails: number;
  /** The headers that were used, so the screen can say "using column 'College Email'". null when there is no placed column. */
  columns: { email: string; placed: string | null };
  /** Every header in the file, so the screen can offer them for mapping. Header names only. */
  headers: string[];
  /** How many of the unique addresses are marked placed; null when the file has no placed column. */
  placed: number | null;
  /** The import refuses fewer than 10 different valid addresses (a small file would single out a student). */
  belowMinimum: boolean;
  /** True when an import of this file would be accepted by the checks that can be run without the database. */
  canStage: boolean;
  /** Only addresses on the campus's registered domains are kept, and the file is checked for that on import. */
  domainCheck: 'on_import';
}

/** The pure part: counts over a parsed file. */
export function summarizeRoster(bytes: Buffer, columns: RosterColumns = {}): RosterPreview {
  const { parsed, emailAt, placedAt } = readRosterCsv(bytes, columns);
  const seen = new Map<string, boolean>();
  let valid = 0;
  let invalid = 0;
  let duplicates = 0;
  for (const row of parsed.rows) {
    const mail = normalizeMailbox(row[emailAt] ?? '');
    if (!mail) {
      invalid++;
      continue;
    }
    valid++;
    if (seen.has(mail)) {
      duplicates++;
      // The import keeps the last row's placed flag for an address that repeats; the count follows the same rule.
      if (placedAt >= 0) seen.set(mail, isPlacedValue(row[placedAt]));
      continue;
    }
    seen.set(mail, placedAt >= 0 ? isPlacedValue(row[placedAt]) : false);
  }
  const unique = seen.size;
  const belowMinimum = unique < MIN_ROSTER_ROWS;
  return {
    rowsTotal: parsed.rows.length,
    validEmails: valid,
    invalidEmails: invalid,
    duplicates,
    uniqueEmails: unique,
    columns: { email: parsed.header[emailAt]!, placed: placedAt >= 0 ? parsed.header[placedAt]! : null },
    headers: parsed.header,
    placed: placedAt >= 0 ? [...seen.values()].filter(Boolean).length : null,
    belowMinimum,
    canStage: !belowMinimum,
    domainCheck: 'on_import',
  };
}

/**
 * Roster import, step one for the console screen: the same reading as the import (same caps, same columns), with counts
 * returned and nothing written. Staff of the cohort's campus only; anyone else gets the same 404 as everywhere in the TPO
 * side. The file is read in memory and dropped; the response holds counts and header names, never an address.
 */
export async function previewRoster(ctx: ServiceCtx, input: unknown, bytes: Buffer): Promise<RosterPreview> {
  const { cohortId, emailColumn, placedColumn } = parseInput(RosterImportInput, input);
  await staffReadTx(ctx, async (c) => {
    const campuses = await callIn<StaffMembership[]>(c, 'tpo_memberships');
    for (const m of campuses) {
      const cohorts = await callIn<{ id: string }[] | null>(c, 'tpo_list_cohorts', [m.campusId]);
      if (cohorts?.some((h) => h.id === cohortId)) return;
    }
    throw notFound();
  });
  return summarizeRoster(bytes, { ...(emailColumn ? { email: emailColumn } : {}), ...(placedColumn !== undefined ? { placed: placedColumn } : {}) });
}
