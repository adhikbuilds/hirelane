import { detectScamSignals, parseCriteria, type Criterion } from '@hirelane/engine';
import type { ServiceCtx } from '../ctx';
import { notFound } from '../errors';
import { parseInput } from '../schema';
import { istDay, isRealDay } from './ist';
import { CampusIdInput, CampusScopeInput, PublishDriveInput } from './inputs';
import { callIn } from './rpc';
import { orNotFound, resolveCampus, staffReadTx, staffTx, type StaffMembership } from './tpo';

/**
 * The console drive inbox (P0-5). A drive is made in steps and the steps are the states:
 *
 *   1. parse     previewDrive    reads the pasted notice with the engine: rules, deadline, scam flags. Nothing is saved.
 *   2. count     saveDriveDraft  saves a DRAFT (students cannot see it). The nightly job evaluates it like any published drive,
 *                                so driveReach then shows how many qualify and how many could not be checked, k >= 10.
 *   3. publish   announceDrive   draft -> live: students can see it and are told by the notification sweep.
 *
 * closeDrive ends a drive. Scam flags are for staff: they are returned here and by the staff list, and on no student route.
 */

export type DriveStatus = 'draft' | 'live' | 'closed';

export interface DriveReach {
  /** pending: no nightly snapshot has counted this drive yet. ready: it has. */
  state: 'pending' | 'ready';
  /** The snapshot day the figures are from. */
  day: string | null;
  /** Students who meet every rule we could read (rounded to 5). null when hidden. */
  qualify: number | null;
  /** Students whose profile is missing something a rule needs, so we could not check (rounded to 5). null when hidden. */
  couldntCheck: number | null;
  /** True when either figure is hidden: under 10, or hidden to stop it being rebuilt by subtraction. A hidden figure is never shown as 0. */
  hidden: boolean;
}

export interface DriveParse {
  criteria: Criterion[];
  /** One plain line per rule read from the notice. */
  rules: string[];
  scam: { risk: 'none' | 'low' | 'medium' | 'high'; flags: { id: string; severity: string; quote: string; source: string }[] };
  /** The closing date the notice states, as YYYY-MM-DD, or null. A suggestion: the TPO confirms it. */
  suggestedDeadline: string | null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DEADLINE_RE = /\b(?:apply\s+(?:by|before)|by|before|until|till|closes?(?:\s+on)?|last\s+date(?:\s+to\s+apply)?(?:\s+is)?|deadline(?:\s+is)?)\s*[:\-]?\s*(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s*(\d{4}))?/i;

/** The closing date a notice states ("apply by 6 Nov", "last date: 31st October 2026"), or null. Rules only. A date with no year is the next such date from today. */
export function suggestDeadline(notice: string, now: Date): string | null {
  const m = DEADLINE_RE.exec(notice);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS.indexOf(m[2]!.toLowerCase());
  if (month < 0) return null;
  const today = istDay(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  const at = (y: number) => `${y}-${pad(month + 1)}-${pad(day)}`;
  if (m[3]) {
    const s = at(Number(m[3]));
    return isRealDay(s) ? s : null;
  }
  const y = Number(today.slice(0, 4));
  let s = at(y);
  if (isRealDay(s) && s < today) s = at(y + 1);
  return isRealDay(s) ? s : null;
}

const describe = (c: Criterion): string => {
  switch (c.type) {
    case 'min_score':
      return `At least ${c.pct}%${c.cgpa ? ` (${c.cgpa} CGPA)` : ''} in ${c.levels.join(', ')}${c.throughout ? ', throughout' : ''}`;
    case 'no_active_backlogs':
      return 'No active backlogs';
    case 'max_backlog_history':
      return `At most ${c.n} past backlogs`;
    case 'passout_years':
      return `Passout year ${c.years.join(' or ')}`;
    case 'degrees':
      return `Degree: ${c.list.join(', ')}`;
    case 'branches':
      return `Branch: ${c.list.join(', ')}`;
    case 'max_gap_years':
      return `A gap of at most ${c.n} years`;
  }
};

/** Parse a notice with the engine: criteria, scam signals, a suggested deadline. Pure, 0 LLM calls, the link is never fetched. */
export function parseDriveNotice(noticeText: string, link: string | null, now: Date): DriveParse {
  const criteria = parseCriteria(noticeText);
  const scam = detectScamSignals(noticeText, { url: link });
  return {
    criteria,
    rules: criteria.map(describe),
    scam: { risk: scam.risk, flags: scam.signals.map((s) => ({ id: s.id, severity: s.severity, quote: s.quote.slice(0, 200), source: s.source })) },
    suggestedDeadline: suggestDeadline(noticeText, now),
  };
}

type CountsRow = { day: string | null; metrics: { metric: string; value: number | null; suppressed: boolean }[] };

/** The reach of a drive from the nightly counts. Hidden figures stay hidden: never 0, never summed, never derived. */
export function toReach(counts: CountsRow): DriveReach {
  if (!counts.day) return { state: 'pending', day: null, qualify: null, couldntCheck: null, hidden: false };
  const cell = (m: string): number | null => {
    const c = counts.metrics.find((x) => x.metric === m);
    return !c || c.suppressed || c.value === null ? null : c.value;
  };
  const qualify = cell('drive_eligible');
  const couldntCheck = cell('drive_unknown');
  return { state: 'ready', day: counts.day, qualify, couldntCheck, hidden: qualify === null || couldntCheck === null };
}

const reachOf = async (c: Parameters<Parameters<typeof staffReadTx>[1]>[0], id: string): Promise<DriveReach> =>
  toReach(orNotFound(await callIn<CountsRow | null>(c, 'tpo_drive_counts', [id])));

/** The cohort must belong to a campus the caller staffs; anyone else gets the standard 404. */
async function assertCohort(c: Parameters<Parameters<typeof staffReadTx>[1]>[0], cohortId: string): Promise<void> {
  const campuses = await callIn<StaffMembership[]>(c, 'tpo_memberships');
  for (const m of campuses) {
    const cohorts = await callIn<{ id: string }[] | null>(c, 'tpo_list_cohorts', [m.campusId]);
    if (cohorts?.some((h) => h.id === cohortId)) return;
  }
  throw notFound();
}

/** Step 1. Parse only; nothing is saved and nothing is counted. Staff of the cohort's campus only. */
export async function previewDrive(ctx: ServiceCtx, input: unknown): Promise<DriveParse & { step: 'parsed'; title: string; cohortId: string }> {
  const i = parseInput(PublishDriveInput, input);
  await staffReadTx(ctx, (c) => assertCohort(c, i.cohortId));
  return { step: 'parsed', title: i.title, cohortId: i.cohortId, ...parseDriveNotice(i.noticeText, i.link ?? null, ctx.now()) };
}

const createDrive = async (ctx: ServiceCtx, input: unknown, announce: boolean) => {
  const i = parseInput(PublishDriveInput, input);
  const parse = parseDriveNotice(i.noticeText, i.link ?? null, ctx.now());
  const id = await staffTx(ctx, async (c) =>
    orNotFound(
      await callIn<string | null>(c, 'tpo_create_drive', [
        i.cohortId,
        i.title,
        i.link ?? null,
        i.noticeText,
        JSON.stringify(parse.criteria),
        JSON.stringify(parse.scam.flags),
        parse.scam.risk,
        i.deadline ?? null,
        i.rounds || null,
        i.documents || null,
        announce,
      ]),
    ),
  );
  return { id, parse };
};

/** Step 2. Save a draft. The count appears after the next nightly snapshot (driveReach says pending until then). */
export async function saveDriveDraft(ctx: ServiceCtx, input: unknown): Promise<{ id: string; status: 'draft'; step: 'counting'; reach: DriveReach } & DriveParse> {
  const { id, parse } = await createDrive(ctx, input, false);
  return { id, status: 'draft', step: 'counting', reach: { state: 'pending', day: null, qualify: null, couldntCheck: null, hidden: false }, ...parse };
}

/** Publish in one go (no draft step): the older route, now with the deadline, rounds and documents. */
export async function publishDriveNow(ctx: ServiceCtx, input: unknown): Promise<{ id: string; status: 'live' } & DriveParse> {
  const { id, parse } = await createDrive(ctx, input, true);
  return { id, status: 'live', ...parse };
}

/** Qualify + could not check for one drive, from the nightly snapshot, with k >= 10 and the differencing guard applied by the database. */
export async function driveReach(ctx: ServiceCtx, input: unknown): Promise<DriveReach> {
  const { id } = parseInput(CampusIdInput, input);
  return staffReadTx(ctx, (c) => reachOf(c, id));
}

/** Step 3. Draft to live. 404 for a drive that is not a draft of a campus the caller staffs. */
export async function announceDrive(ctx: ServiceCtx, input: unknown): Promise<{ id: string; status: 'live' }> {
  const { id } = parseInput(CampusIdInput, input);
  const ok = await staffTx(ctx, async (c) => orNotFound(await callIn<boolean | null>(c, 'tpo_announce_drive', [id])));
  if (!ok) throw notFound();
  return { id, status: 'live' };
}

/** End a drive. Students stop seeing it. 404 when it is already closed or is not the caller's. */
export async function closeDrive(ctx: ServiceCtx, input: unknown): Promise<{ id: string; status: 'closed' }> {
  const { id } = parseInput(CampusIdInput, input);
  const ok = await staffTx(ctx, async (c) => orNotFound(await callIn<boolean | null>(c, 'tpo_close_drive', [id])));
  if (!ok) throw notFound();
  return { id, status: 'closed' };
}

export interface InboxDrive {
  id: string;
  cohortId: string;
  title: string;
  link: string | null;
  status: DriveStatus;
  /** Where the drive is in parse -> count -> publish. */
  step: 'counting' | 'ready_to_publish' | 'live' | 'closed';
  deadline: string | null;
  rounds: string | null;
  documents: string | null;
  criteria: Criterion[];
  rules: string[];
  /** Staff only. */
  scam: DriveParse['scam'];
  reach: DriveReach;
  publishedAt: string;
  announcedAt: string | null;
}

/** Everything the console drive inbox shows, in one read-only pass: each drive of the campus with its status, deadline and reach. */
export async function driveInbox(ctx: ServiceCtx, input: unknown = {}): Promise<{ drives: InboxDrive[] }> {
  const { campusId } = parseInput(CampusScopeInput, input);
  return staffReadTx(ctx, async (c) => {
    const id = await resolveCampus(c, campusId);
    const rows = orNotFound(
      await callIn<
        {
          id: string;
          cohortId: string;
          title: string;
          link: string | null;
          status: DriveStatus;
          deadline: string | null;
          rounds: string | null;
          documents: string | null;
          scamRisk: DriveParse['scam']['risk'];
          scamFlags: DriveParse['scam']['flags'];
          criteria: Criterion[];
          publishedAt: string;
          announcedAt: string | null;
        }[] | null
      >(c, 'tpo_list_drives', [id]),
    );
    const drives: InboxDrive[] = [];
    for (const d of rows) {
      const reach = await reachOf(c, d.id);
      drives.push({
        id: d.id,
        cohortId: d.cohortId,
        title: d.title,
        link: d.link,
        status: d.status,
        step: d.status === 'closed' ? 'closed' : d.status === 'live' ? 'live' : reach.state === 'ready' ? 'ready_to_publish' : 'counting',
        deadline: d.deadline,
        rounds: d.rounds,
        documents: d.documents,
        criteria: d.criteria,
        rules: (Array.isArray(d.criteria) ? d.criteria : []).map(describe),
        scam: { risk: d.scamRisk, flags: d.scamFlags },
        reach,
        publishedAt: d.publishedAt,
        announcedAt: d.announcedAt,
      });
    }
    return { drives };
  });
}
