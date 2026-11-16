import { redirect, notFound } from "next/navigation";
import {
  cohortStats,
  driveCounts,
  driveInbox,
  getMe,
  getMyCampus,
  listApplications,
  listCohorts,
  listDrives,
  listInbox,
  listMyDrives,
  listOutcomes,
  listStaff,
  listResumes,
  tpoMe,
  type Cohort,
  type ServiceCtx,
  universityFor,
} from "@hirelane/services";
import { accountsEnabled } from "@/lib/auth/flags";
import { withPageCtx } from "@/lib/api/action";
import type { CampusOverview, OfferRow, ProgrammeRow } from "@/lib/sample/campus";
import type { DriveItem, TrackerItem } from "@/lib/sample/loop";
import type { HomeData } from "@/lib/sample/home";
import { toDriveInbox, type DriveInboxData } from "./campus-drives";
import { campusIsEmpty, metricTotal, toCampusOverview, toOfferRows, toProgrammeRows, type CampusInput, type DriveRow, type OutcomeRow, type Stats } from "./campus";
import { toDriveItems } from "./drives";
import { firstNameOf, homeIsEmpty, toHomeData } from "./home";
import { isDevEnv, resolveScreen, type Screen, type ScreenEnv } from "./screen";
import { toTrackerItems } from "./tracker";

const env: ScreenEnv<ServiceCtx> = {
  dev: isDevEnv(),
  accountsOn: () => accountsEnabled(),
  ctx: () => withPageCtx(async (ctx) => ctx),
  redirect: (to) => redirect(to),
  notFound: () => notFound(),
  log: (line) => console.warn(line),
};

const initialOf = (name: string | null): string => (name?.trim()[0] ?? "?").toUpperCase();

/** Student Home: HomeData for HomeA. There is no picks service yet, so the deck is empty on a real student. */
export function loadHome(now: () => Date = () => new Date()): Promise<Screen<{ home: HomeData }>> {
  return resolveScreen(env, {
    read: async (ctx) => {
      const [me, mine, resumes, drives, applications, inbox] = await Promise.all([getMe(ctx), getMyCampus(ctx), listResumes(ctx), listMyDrives(ctx), listApplications(ctx), listInbox(ctx)]);
      const rest = { membership: mine.membership, resumes, drives: drives.drives, applications: applications.applications, inbox: inbox.messages };
      return { data: { home: toHomeData({ me, now: now(), ...rest }) }, empty: homeIsEmpty(rest) };
    },
  });
}

/** Student Drives tab. A student with no campus membership has no drives; production shows the empty list. */
export function loadDrives(now: () => Date = () => new Date()): Promise<Screen<{ initial: string; drives: DriveItem[] }>> {
  return resolveScreen(env, {
    read: async (ctx) => {
      const [me, mine] = await Promise.all([getMe(ctx), listMyDrives(ctx)]);
      return { data: { initial: initialOf(firstNameOf(me)), drives: toDriveItems(mine.drives, now()) }, empty: mine.drives.length === 0 };
    },
  });
}

/** Student Tracker. */
export function loadTracker(now: () => Date = () => new Date()): Promise<Screen<{ initial: string; items: TrackerItem[] }>> {
  return resolveScreen(env, {
    read: async (ctx) => {
      const [me, apps] = await Promise.all([getMe(ctx), listApplications(ctx)]);
      return { data: { initial: initialOf(firstNameOf(me)), items: toTrackerItems(apps.applications, now()) }, empty: apps.applications.length === 0 };
    },
  });
}

interface CampusBase {
  campusId: string;
  campusName: string;
  cohorts: Cohort[];
}

/** The campus this staff member runs, or null for anyone else (a student, a stranger): they get the same 404 as the services give. */
async function staffCampus(ctx: ServiceCtx): Promise<CampusBase | null> {
  const { campuses } = await tpoMe(ctx);
  const campus = campuses[0];
  if (!campus) return null;
  const { cohorts } = await listCohorts(ctx, { campusId: campus.campusId });
  return { campusId: campus.campusId, campusName: campus.campusName, cohorts };
}

const statsFor = async (ctx: ServiceCtx, cohorts: Cohort[]): Promise<Record<string, Stats>> =>
  Object.fromEntries(await Promise.all(cohorts.map(async (c) => [c.id, (await cohortStats(ctx, { cohortId: c.id })) as Stats] as const)));

const FORBIDDEN = { forbidden: true, empty: true } as const;

/** Console overview. Production-ready: CampusDash prints only what the snapshot holds (no weekly chart, programme split or Act list is invented). */
export function loadCampusOverview(): Promise<Screen<{ college: string; overview: CampusOverview }>> {
  return resolveScreen(env, {
    read: async (ctx) => {
      const base = await staffCampus(ctx);
      if (!base) return { ...FORBIDDEN, data: null as never };
      const [stats, listed] = await Promise.all([statsFor(ctx, base.cohorts), listDrives(ctx, { campusId: base.campusId })]);
      const drives = listed.drives as DriveRow[];
      const counts = Object.fromEntries(await Promise.all(drives.map(async (d) => [d.id, (await driveCounts(ctx, { id: d.id })) as Stats] as const)));
      const input: CampusInput = { campusName: base.campusName, cohorts: base.cohorts, stats, drives, counts };
      return { data: { college: base.campusName, overview: toCampusOverview(input) }, empty: campusIsEmpty(input) };
    },
  });
}

/**
 * Console Students: totals by programme. Eligible and applied have no source, so the table leaves them out; a withheld
 * cell prints "hidden". Also the cohorts the roster import can target.
 */
export function loadCampusStudents(): Promise<Screen<{ college: string; rows: ProgrammeRow[]; cohorts: { id: string; label: string }[] }>> {
  return resolveScreen(env, {
    read: async (ctx) => {
      const base = await staffCampus(ctx);
      if (!base) return { ...FORBIDDEN, data: null as never };
      const stats = await statsFor(ctx, base.cohorts);
      return { data: { college: base.campusName, rows: toProgrammeRows({ cohorts: base.cohorts, stats }), cohorts: base.cohorts.map((c) => ({ id: c.id, label: `${c.programme} (${c.passoutYear})` })) }, empty: base.cohorts.length === 0 };
    },
  });
}

export interface OutcomesData {
  college: string;
  offers: OfferRow[];
  outgoing: number;
  higherStudies: number;
  /** Placed on campus, from the roster snapshot. Null when that cell is hidden (under 10): never printed as 0. */
  placedOnRoster: number | null;
  verified: number;
  waiting: number;
}

/**
 * Console Outcomes. A page view names nobody and writes nothing: it reads the unnamed list (listOutcomes). Names come from
 * the explicit POST /api/v1/tpo/outcomes/reveal call, which logs each student returned.
 */
export function loadCampusOutcomes(): Promise<Screen<OutcomesData>> {
  return resolveScreen(env, {
    read: async (ctx) => {
      const base = await staffCampus(ctx);
      if (!base) return { ...FORBIDDEN, data: null as never };
      const [{ outcomes }, stats] = await Promise.all([listOutcomes(ctx, { campusId: base.campusId }), statsFor(ctx, base.cohorts)]);
      const rows = outcomes as OutcomeRow[];
      const offers = toOfferRows(rows);
      const data: OutcomesData = {
        college: base.campusName,
        offers,
        outgoing: base.cohorts.reduce((a, c) => a + c.rosterSize, 0),
        higherStudies: rows.filter((r) => (r.kind as string) === "higher_studies").length,
        placedOnRoster: metricTotal(base.cohorts, stats, "placed_on_roster"),
        verified: offers.filter((o) => o.status === "verified").length,
        waiting: offers.filter((o) => o.status === "waiting").length,
      };
      return { data, empty: rows.length === 0 && base.cohorts.length === 0 };
    },
  });
}

export interface SettingsData {
  college: string;
  /** The university rule on file for this college's name, or null: students who only give a CGPA then show as "can't check". */
  universityRule: string | null;
  staff: { id: string; role: "owner" | "staff"; claimed: boolean }[];
}

/** Console Settings: what the services hold (the university rule matched by name, the staff seats). The join code is stored hashed and is not shown. */
export function loadCampusSettings(): Promise<Screen<SettingsData>> {
  return resolveScreen(env, {
    read: async (ctx) => {
      const base = await staffCampus(ctx);
      if (!base) return { ...FORBIDDEN, data: null as never };
      const { staff } = await listStaff(ctx, { campusId: base.campusId });
      return { data: { college: base.campusName, universityRule: universityFor(base.campusName)?.short ?? null, staff: staff.map((m) => ({ id: m.id, role: m.role, claimed: m.claimed })) }, empty: false };
    },
  });
}

/**
 * Console drive inbox (A-4 and A-5): every drive of the campus with its status (draft, live, closed), deadline, rounds,
 * documents, scam flags (staff only) and reach (qualify plus could-not-check, k >= 10, hidden figures stay hidden).
 * Production-ready: it reads only the drive services and invents nothing. A student or a stranger gets the standard 404.
 */
export function loadCampusDrives(now: () => Date = () => new Date()): Promise<Screen<DriveInboxData>> {
  return resolveScreen(env, {
    read: async (ctx) => {
      const base = await staffCampus(ctx);
      if (!base) return { ...FORBIDDEN, data: null as never };
      const { drives } = await driveInbox(ctx, { campusId: base.campusId });
      return { data: toDriveInbox({ campusName: base.campusName, cohorts: base.cohorts, drives, now: now() }), empty: drives.length === 0 };
    },
  });
}
