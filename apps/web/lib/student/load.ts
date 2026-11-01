import { notFound, redirect } from "next/navigation";
import { applyMode } from "@hirelane/agent";
import { getApplication, getApplySettings, getMe, getMyCampus, getPicks, isServiceError, listApplications, listInbox, listMyDrives, listMyOutcomes, listResumes, type ServiceCtx } from "@hirelane/services";
import { withPageCtx } from "@/lib/api/action";
import { accountsEnabled } from "@/lib/auth/flags";
import { firstNameOf } from "@/lib/adapters/home";
import { isDevEnv, resolveScreen, type Screen, type ScreenEnv } from "@/lib/adapters/screen";
import { picksToCards, toDriveViews, toFinishView, toHomeView, toReceipt, toTrackerView } from "./map";
import type { CardData, DrivesData, FinishView, HomeView, MessageView, ReceiptView, TrackerView } from "./types";

/**
 * Loaders for the student app. Each one reads only the signed-in student's own data through the services, hands it to a
 * pure mapper (map.ts) and lets resolveScreen decide between real data and, in development only, the labelled sample.
 */
const env: ScreenEnv<ServiceCtx> = {
  dev: isDevEnv(),
  accountsOn: () => accountsEnabled(),
  ctx: () => withPageCtx(async (ctx) => ctx),
  redirect: (to) => redirect(to),
  notFound: () => notFound(),
  log: (line) => console.warn(line),
};

/** The tab badge and the avatar are on every page, so every loader returns them. */
export interface Chrome {
  initial: string;
  badge: number;
}

/** Pre-pilot (HIRELANE_AUTO_APPLY off, the production default) the copy says "ready" and Apply applies nothing. */
export const pilotOn = (): boolean => applyMode() !== "off";

const initialOf = (name: string): string => (name[0] ?? "?").toUpperCase();

export function loadStudentHome(now: () => Date = () => new Date()): Promise<Screen<HomeView>> {
  return resolveScreen(env, {
    read: async (ctx) => {
      const [me, picks, apps, inbox, drives, resumes, settings] = await Promise.all([getMe(ctx), getPicks(ctx), listApplications(ctx), listInbox(ctx), listMyDrives(ctx), listResumes(ctx), getApplySettings(ctx)]);
      const data = toHomeView({ me, picks, apps: apps.applications, inbox: inbox.messages, drives: drives.drives, resumes, settings, pilot: pilotOn(), now: now() });
      const empty = picks.picks.length === 0 && apps.applications.length === 0 && inbox.messages.length === 0 && drives.drives.length === 0 && resumes.length === 0;
      return { data, empty };
    },
  });
}

export interface PicksData extends Chrome {
  cards: CardData[];
  autoApply: boolean;
  pilot: boolean;
  applyAddress: string | null;
}

export function loadStudentPicks(): Promise<Screen<PicksData>> {
  return resolveScreen(env, {
    read: async (ctx) => {
      const [me, picks, apps, settings] = await Promise.all([getMe(ctx), getPicks(ctx), listApplications(ctx), getApplySettings(ctx)]);
      const cards = picksToCards(picks);
      return {
        data: { initial: initialOf(firstNameOf(me)), badge: toTrackerView(apps.applications, [], new Date()).badge, cards, autoApply: settings.autoApply && pilotOn(), pilot: pilotOn(), applyAddress: settings.applyAddress },
        empty: cards.length === 0 && apps.applications.length === 0,
      };
    },
  });
}

export interface DrivesPageData extends Chrome {
  drives: DrivesData;
  college: string | null;
}

export function loadStudentDrives(now: () => Date = () => new Date()): Promise<Screen<DrivesPageData>> {
  return resolveScreen(env, {
    read: async (ctx) => {
      const [me, mine, apps, campus] = await Promise.all([getMe(ctx), listMyDrives(ctx), listApplications(ctx), getMyCampus(ctx)]);
      const drives = toDriveViews(mine.drives, now());
      return {
        data: { initial: initialOf(firstNameOf(me)), badge: toTrackerView(apps.applications, [], now()).badge, drives, college: campus.membership?.campus.name ?? null },
        empty: mine.drives.length === 0,
      };
    },
  });
}

export interface TrackerPageData extends Chrome {
  view: TrackerView;
  /** The application whose receipt is open, when one is selected and exists. */
  selected: { id: string; company: string; role: string; receipt: ReceiptView | null; fallbackUrl: string | null } | null;
  /** The message open in the middle pane: the one picked, else the latest for the selected application. */
  message: MessageView | null;
}

/** `a` is an application id, `m` a message id (the Inbox tab). A message picks its own application. */
export function loadStudentTracker(sel: { a?: string | null; m?: string | null }, now: () => Date = () => new Date()): Promise<Screen<TrackerPageData>> {
  return resolveScreen(env, {
    read: async (ctx) => {
      const [me, apps, inbox, mine] = await Promise.all([getMe(ctx), listApplications(ctx), listInbox(ctx), listMyOutcomes(ctx)]);
      const view = toTrackerView(apps.applications, inbox.messages, now(), mine.outcomes);
      const picked = sel.m ? view.messages.find((m) => m.id === sel.m) ?? null : null;
      const order = ["replies", "interview", "applied", "needs"];
      const first = order.flatMap((id) => view.groups.find((g) => g.id === id)?.rows ?? []).find((r) => apps.applications.some((a) => a.id === r.id))?.id ?? null;
      const wanted = picked?.applicationId ?? sel.a ?? first;
      const summary = apps.applications.find((a) => a.id === wanted);
      let selected: TrackerPageData["selected"] = null;
      if (summary && summary.status !== "undone") {
        const detail = await getApplication(ctx, { id: summary.id });
        selected = {
          id: summary.id,
          company: summary.company,
          role: summary.title,
          fallbackUrl: summary.fallback?.url ?? null,
          receipt: detail.receipt ? toReceipt(detail.receipt, detail.answers.filter((a) => a.answer).length, detail.applyAddress, summary.fallback?.url ?? null) : null,
        };
      }
      const message = picked ?? (selected ? view.messages.find((m) => m.applicationId === selected!.id) ?? null : null);
      return { data: { initial: initialOf(firstNameOf(me)), badge: view.badge, view, selected, message }, empty: apps.applications.length === 0 && inbox.messages.length === 0 && mine.outcomes.length === 0 };
    },
  });
}

/** The Needs-you page for one application. A stranger's id, or one that is not blocked, is a 404 from the service or null here. */
export function loadFinish(id: string): Promise<Screen<{ chrome: Chrome; finish: FinishView | null }>> {
  return resolveScreen(env, {
    read: async (ctx) => {
      const me = await getMe(ctx);
      // Someone else's application, or none at all, answers the same 404 the API gives.
      const detail = await getApplication(ctx, { id }).catch((e: unknown) => (isServiceError(e) && e.status === 404 ? notFound() : Promise.reject(e)));
      const a = detail.application;
      const blocked = a.status === "blocked_fallback" || a.status === "failed";
      const apps = await listApplications(ctx);
      return {
        data: {
          chrome: { initial: initialOf(firstNameOf(me)), badge: toTrackerView(apps.applications, [], new Date()).badge },
          finish: blocked ? toFinishView(a, detail.answers) : null,
        },
        empty: false,
      };
    },
  });
}

export interface OnboardingData {
  initial: string;
  autoApply: boolean;
  pilot: boolean;
  applyAddress: string | null;
  joined: boolean;
}

/** Onboarding steps 4 and 5: whether the student already chose to apply from their Hirelane address, and whether they joined a college. */
export function loadOnboarding(): Promise<Screen<OnboardingData>> {
  return resolveScreen(env, {
    read: async (ctx) => {
      const [me, settings, mine] = await Promise.all([getMe(ctx), getApplySettings(ctx), getMyCampus(ctx)]);
      return { data: { initial: initialOf(firstNameOf(me)), autoApply: settings.autoApply, pilot: pilotOn(), applyAddress: settings.applyAddress, joined: mine.membership !== null }, empty: false };
    },
  });
}

/** Paste only needs a signed-in student; the check itself runs in the browser against POST /api/v1/paste. */
export function loadStudentChrome(): Promise<Screen<Chrome>> {
  return resolveScreen(env, {
    read: async (ctx) => {
      const [me, apps] = await Promise.all([getMe(ctx), listApplications(ctx)]);
      return { data: { initial: initialOf(firstNameOf(me)), badge: toTrackerView(apps.applications, [], new Date()).badge }, empty: false };
    },
  });
}
