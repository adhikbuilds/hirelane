import type { ApplicationSummary, InboundView, Me, Membership, ResumeSummary, StudentDrive } from "@hirelane/services";
import type { HomeData } from "@/lib/sample/home";
import { toDriveItems } from "./drives";
import { clock, dateLabel, daysBetween, shortDate } from "./ist";

export interface HomeInput {
  me: Me;
  membership: Membership | null;
  resumes: ResumeSummary[];
  drives: StudentDrive[];
  applications: ApplicationSummary[];
  inbox: InboundView[];
  now: Date;
}

/** What the student sees as a name: the first word of their display name, else a neutral "there". */
export function firstNameOf(me: Pick<Me, "displayName">): string {
  const w = me.displayName?.trim().split(/\s+/)[0];
  return w && w.length > 0 ? w : "there";
}

/** True when the services returned nothing at all for this student (so a dev build may show the sample instead). */
export function homeIsEmpty(i: Omit<HomeInput, "now" | "me">): boolean {
  return !i.membership && i.resumes.length === 0 && i.drives.length === 0 && i.applications.length === 0 && i.inbox.length === 0;
}

const inLastWeek = (iso: string | null, now: Date): boolean => iso != null && daysBetween(new Date(iso), now) < 7 && new Date(iso) <= now;

/**
 * Services => HomeData. Zeros are shown as zeros. Fields with no service yet stay empty rather than invented:
 * picks (HLD M3), the streak, warm connections (LinkedIn upload) and the "qualify" blocker.
 */
export function toHomeData(i: HomeInput): HomeData {
  const resume = i.resumes.find((r) => r.isDefault && r.healthTotal > 0) ?? i.resumes.find((r) => r.healthTotal > 0) ?? null;
  const driveCards = toDriveItems(i.drives, i.now);
  const eligible = driveCards.filter((d) => d.status === "eligible").length;
  const repliesThisWeek = i.inbox.filter((m) => inLastWeek(m.receivedAt, i.now)).length;

  const feed: HomeData["feed"] = [
    ...i.inbox.map((m) => ({ when: m.receivedAt, text: `${m.employer} wrote back`, tag: "reply" as const })),
    ...i.drives.map((d) => ({ when: d.publishedAt, text: `Your placement cell added ${d.title}`, tag: "drive" as const })),
  ]
    .sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0))
    .slice(0, 5)
    .map((f) => {
      const at = new Date(f.when);
      return { at: daysBetween(at, i.now) <= 0 ? clock(at) : shortDate(at), text: f.text, tag: f.tag };
    });

  return {
    sample: false,
    firstName: firstNameOf(i.me),
    college: i.membership?.campus.name ?? null,
    dateLabel: dateLabel(i.now),
    streakDays: 0,
    paused: false,
    picks: { total: 0, fresherFriendly: 0, remote: 0, payStated: 0, readAgo: "", companies: [], minutes: 0 },
    resume: resume
      ? { passed: resume.healthPassed, total: resume.healthTotal, topFix: resume.healthPassed < resume.healthTotal ? `${resume.healthTotal - resume.healthPassed} checks still to fix.` : null }
      : null,
    qualify: { count: eligible, blockedBy: null },
    drives: driveCards.slice(0, 3).map((d) => ({
      id: d.id,
      company: d.company,
      role: d.role,
      deadlineLabel: d.deadlineLabel,
      daysLeft: d.daysLeft,
      status: d.status === "eligible" ? "eligible" : "check",
      reason: d.headline,
    })),
    feed,
    week: {
      handedOff: i.applications.filter((a) => a.status === "submitted" && inLastWeek(a.submittedAt, i.now)).length,
      replies: repliesThisWeek,
      answersFilled: 0,
      recapReady: false,
    },
    warm: null,
  };
}
