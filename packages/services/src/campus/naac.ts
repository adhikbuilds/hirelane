import type { ServiceCtx } from '../ctx';
import { parseInput } from '../schema';
import { toCsv } from './csv';
import { NaacExportInput } from './inputs';
import { callIn } from './rpc';
import { orNotFound, resolveCampus, staffReadTx, staffTx } from './tpo';

/**
 * NAAC criterion 5.2.1 shaped columns. [unverified] The headers follow the public description of 5.2.1 (year of placement,
 * student placed, programme graduated from, employer, package at appointment) plus a Verification column of our own. They
 * have NOT been checked against the NAAC manual for the current cycle; do that before a college files with it.
 */
export const NAAC_HEADER = [
  'Year of placement',
  'Name of the student placed',
  'Program graduated from',
  'Name of the employer',
  'Pay package at appointment (LPA)',
  'Verification',
] as const;

interface NaacRow {
  year: number;
  student: string;
  programme: string;
  employer: string;
  packageLpa: number | null;
  verification: 'student_reported' | 'tpo_verified';
}

/**
 * GET preview: how many rows the export would hold, and its file name. No student is named and nothing is written
 * (READ ONLY transaction). The file itself is `exportNaac`, an explicit action.
 */
export async function previewNaac(ctx: ServiceCtx, input: unknown = {}): Promise<{ filename: string; rows: number; header: readonly string[] }> {
  const i = parseInput(NaacExportInput, input);
  const r = await staffReadTx(ctx, async (c) => {
    const campus = await resolveCampus(c, i.campusId);
    return orNotFound(await callIn<{ rows: number } | null>(c, 'tpo_naac_count', [campus, i.passoutYear ?? null]));
  });
  const stamp = ctx.now().toISOString().slice(0, 10);
  return { filename: `naac-5.2.1-${i.passoutYear ?? 'all'}-${stamp}.csv`, rows: r.rows, header: NAAC_HEADER };
}

/**
 * The export, an explicit action (POST): offers by verified members who chose outcomes or full. The database logs one access
 * row per student in the same call, so the student can see the export. Labelled "student-reported" or "TPO-verified". Cells are formula-safe.
 */
export async function exportNaac(ctx: ServiceCtx, input: unknown = {}): Promise<{ filename: string; csv: string; rows: number }> {
  const i = parseInput(NaacExportInput, input);
  const rows = await staffTx(ctx, async (c) => {
    const campus = await resolveCampus(c, i.campusId);
    return orNotFound(await callIn<NaacRow[] | null>(c, 'tpo_naac_rows', [campus, i.passoutYear ?? null]));
  });
  const csv = toCsv(
    NAAC_HEADER,
    rows.map((r) => [r.year, r.student, r.programme, r.employer, r.packageLpa === null ? '' : r.packageLpa, r.verification === 'tpo_verified' ? 'TPO-verified' : 'student-reported']),
  );
  const stamp = ctx.now().toISOString().slice(0, 10);
  return { filename: `naac-5.2.1-${i.passoutYear ?? 'all'}-${stamp}.csv`, csv, rows: rows.length };
}
