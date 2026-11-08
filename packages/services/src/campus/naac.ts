import type { ServiceCtx } from '../ctx';
import { parseInput } from '../schema';
import { toCsv } from './csv';
import { NaacExportInput } from './inputs';
import { callIn } from './rpc';
import { orNotFound, resolveCampus, staffReadTx, staffTx } from './tpo';

/**
 * Which NAAC manual this file follows. Affiliated colleges (Revised Accreditation Framework, Jan 2023): criterion 5.2.1 is
 * "placement of outgoing students and students progressing to higher education", so one file holds both parts. The universities
 * manual lists placement separately as 5.2.2 and is NOT what this file follows.
 */
export const NAAC_MANUAL =
  'Follows the NAAC manual for affiliated colleges (RAF 2023): criterion 5.2.1 combines placement of outgoing students and students progressing to higher education. The universities manual lists placement separately as 5.2.2 and is not followed here';

/**
 * Placement part of 5.2.1. [unverified] The columns follow the public description of the template (year, student placed,
 * programme graduated from, employer with contact details, pay package at appointment) plus a Verification column of our own.
 * They have NOT been checked against the official data template for the current cycle; do that before a college files with it.
 */
export const NAAC_HEADER = [
  'Year',
  'Name of the student placed',
  'Program graduated from',
  'Name of the employer',
  'Employer contact details',
  'Pay package at appointment (LPA)',
  'Verification',
] as const;

/** Higher-education part of 5.2.1 (students progressing to higher education). Same caveat as NAAC_HEADER. */
export const NAAC_HIGHER_ED_HEADER = ['Name of the student', 'Program graduated from', 'Name of the institution joined', 'Name of the programme admitted to', 'Verification'] as const;

export interface NaacRow {
  /** Academic year of the cohort's passout: "2025-26" for the class of 2026. Null (a blank cell) when unknown, never 0. */
  year: string | null;
  student: string;
  programme: string;
  employer: string;
  /** Only when the student shared it. null otherwise: the cell stays blank. */
  employerContact: string | null;
  packageLpa: number | null;
  verification: 'student_reported' | 'tpo_verified';
}

export interface NaacHigherEdRow {
  student: string;
  programme: string;
  institution: string;
  admittedTo: string;
  verification: 'student_reported' | 'tpo_verified';
}

/** "2025-26": the two years must be consecutive, so "2025-27" and "0" are junk. */
const ACADEMIC_YEAR = /^(\d{4})-(\d{2})$/;
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function academicYear(v: unknown): string | null {
  const m = typeof v === 'string' ? ACADEMIC_YEAR.exec(v) : null;
  return m && (Number(m[1]) + 1) % 100 === Number(m[2]) ? (v as string) : null;
}
const ver = (v: unknown): 'student_reported' | 'tpo_verified' => (v === 'tpo_verified' ? 'tpo_verified' : 'student_reported');

/**
 * What the database function returned, as the two parts. The function today returns a plain array of offers (no contact, no
 * higher education); an object `{ placements, higherEd }` carries both. Anything else reads as empty. The consent filter
 * (verified members at share level outcomes or full) is applied in the database, never here.
 */
export function readNaacPayload(raw: unknown): { placements: NaacRow[]; higherEd: NaacHigherEdRow[] } {
  const placementsIn = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.placements) ? raw.placements : [];
  const higherIn = isObj(raw) && Array.isArray(raw.higherEd) ? raw.higherEd : [];
  const placements = placementsIn.filter(isObj).map((r) => {
    const contact = text(r.employerContact).trim();
    return {
      year: academicYear(r.year),
      student: text(r.student),
      programme: text(r.programme),
      employer: text(r.employer),
      employerContact: contact === '' ? null : contact,
      packageLpa: typeof r.packageLpa === 'number' ? r.packageLpa : null,
      verification: ver(r.verification),
    };
  });
  const higherEd = higherIn.filter(isObj).map((r) => ({ student: text(r.student), programme: text(r.programme), institution: text(r.institution), admittedTo: text(r.admittedTo), verification: ver(r.verification) }));
  return { placements, higherEd };
}

const label = (v: 'student_reported' | 'tpo_verified') => (v === 'tpo_verified' ? 'TPO-verified' : 'student-reported');

/**
 * The README that goes with the CSV: which manual it follows, what is unverified, and what each part and column means. Fixed
 * text, never student data. It is NOT part of the CSV: a "# " row in a CSV breaks a spreadsheet import and a filing upload.
 */
export function buildNaacReadme(): string {
  return [
    'NAAC criterion 5.2.1: README for the CSV that came with it',
    '',
    NAAC_MANUAL,
    '',
    'The columns follow the public description of the template and have not been checked against the official data template for the current cycle. Check them before a college files with it.',
    'Part A: placement of outgoing students. One row per offer reported by a verified student who chose to share outcomes.',
    'Part B: students progressing to higher education. One row per record reported by a verified student who chose to share outcomes. It can be empty.',
    'Year is the academic year of the cohort passout (the class of 2026 is 2025-26). It is blank when the cohort has none.',
    'Employer contact details are blank unless the student shared it.',
    'Verification says whether the row is student-reported or TPO-verified.',
    'Only students who joined with a verified college email and chose to share outcomes appear. Each one can see in their own account that this export was made.',
    '',
  ].join('\r\n');
}

/**
 * The CSV: Part A (placement) then, after a blank line, Part B (higher education), each with its own header row. Data only: the
 * notes are in `buildNaacReadme`. Every cell is formula-safe.
 */
export function buildNaacCsv(placements: readonly NaacRow[], higherEd: readonly NaacHigherEdRow[]): string {
  return [
    toCsv(
      NAAC_HEADER,
      placements.map((r) => [r.year ?? '', r.student, r.programme, r.employer, (r.employerContact ?? '').trim(), r.packageLpa === null ? '' : r.packageLpa, label(r.verification)]),
    ),
    '\r\n',
    toCsv(
      NAAC_HIGHER_ED_HEADER,
      higherEd.map((r) => [r.student, r.programme, r.institution, r.admittedTo, label(r.verification)]),
    ),
  ].join('');
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
 * The export, an explicit action (POST): offers and higher-education records by verified members who chose outcomes or full. The database logs one access
 * row per student in the same call, so the student can see the export. Labelled "student-reported" or "TPO-verified". Cells are formula-safe.
 */
export async function exportNaac(ctx: ServiceCtx, input: unknown = {}): Promise<{ filename: string; csv: string; readme: string; rows: number }> {
  const i = parseInput(NaacExportInput, input);
  const rows = await staffTx(ctx, async (c) => {
    const campus = await resolveCampus(c, i.campusId);
    return orNotFound(await callIn<unknown>(c, 'tpo_naac_rows', [campus, i.passoutYear ?? null]));
  });
  const { placements, higherEd } = readNaacPayload(rows);
  const csv = buildNaacCsv(placements, higherEd);
  const stamp = ctx.now().toISOString().slice(0, 10);
  return { filename: `naac-5.2.1-${i.passoutYear ?? 'all'}-${stamp}.csv`, csv, readme: buildNaacReadme(), rows: placements.length + higherEd.length };
}
