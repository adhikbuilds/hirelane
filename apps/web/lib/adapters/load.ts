import { redirect, notFound } from "next/navigation";
import {
  cohortStats,
  driveCounts,
  getMe,
  getMyCampus,
  listApplications,
  listCohorts,
  listDrives,
  listInbox,
  listMyDrives,
  listOutcomes,
  listResumes,
  tpoMe,
  type Cohort,
  type ServiceCtx,
} from "@hirelane/services";
import { accountsEnabled } from "@/lib/auth/flags";
import { withPageCtx } from "@/lib/api/action";
import type { CampusOverview, OfferRow, ProgrammeRow } from "@/lib/sample/campus";
import type { DriveItem, TrackerItem } from "@/lib/sample/loop";
import type { HomeData } from "@/lib/sample/home";
import { campusIsEmpty, toCampusOverview, toOfferRows, toProgrammeRows, type CampusInput, type DriveRow, type OutcomeRow, type Stats } from "./campus";
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

/** Console overview. Dev-only for now: CampusDash hard-codes its weekly chart, programme split and Act list. */
export function loadCampusOverview(): Promise<Screen<{ college: string; overview: CampusOverview }>> {
  return resolveScreen(env, {
    prodReady: false,
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
 * Console Students: totals by programme. Dev-only: eligible and applied have no source (the table prints "under 10"),
 * a withheld cell also prints "under 10", and StudentsPage hard-codes "Batch of 2026" in its subtitle.
 */
export function loadCampusStudents(): Promise<Screen<{ college: string; rows: ProgrammeRow[] }>> {
  return resolveScreen(env, {
    prodReady: false,
    read: async (ctx) => {
      const base = await staffCampus(ctx);
      if (!base) return { ...FORBIDDEN, data: null as never };
      const stats = await statsFor(ctx, base.cohorts);
      return { data: { college: base.campusName, rows: toProgrammeRows({ cohorts: base.cohorts, stats }) }, empty: base.cohorts.length === 0 };
    },
  });
}

/** Console Outcomes. Reading the list logs each student returned, so this is the only loader that does it. Dev-only: OutcomesPage hard-codes its placed total. */
export function loadCampusOutcomes(): Promise<Screen<{ college: string; offers: OfferRow[]; outgoing: number }>> {
  return resolveScreen(env, {
    prodReady: false,
    read: async (ctx) => {
      const base = await staffCampus(ctx);
      if (!base) return { ...FORBIDDEN, data: null as never };
      const { outcomes } = await listOutcomes(ctx, { campusId: base.campusId });
      const offers = toOfferRows(outcomes as OutcomeRow[]);
      return { data: { college: base.campusName, offers, outgoing: base.cohorts.reduce((a, c) => a + c.rosterSize, 0) }, empty: offers.length === 0 && base.cohorts.length === 0 };
    },
  });
}
