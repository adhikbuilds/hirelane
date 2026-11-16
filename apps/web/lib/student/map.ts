import type { ApplicationSummary, ApplySettings, InboundView, Me, PasteResult, Picks, ResumeSummary, StudentDrive } from "@hirelane/services";
import { parseDeadline, UNDATED_WINDOW_DAYS } from "@/lib/adapters/drives";
import { firstNameOf } from "@/lib/adapters/home";
import { clock, dateLabel, daysBetween, shortDate } from "@/lib/adapters/ist";
import { QUIET_AFTER_DAYS } from "@/lib/adapters/tracker";
import type {
  AnswerView,
  CardData,
  DrivesData,
  DriveView,
  FinishView,
  HomeView,
  MessageView,
  NeedsRow,
  PasteView,
  ReceiptView,
  RuleLine,
  RuleStatus,
  Tone,
  TrackerGroup,
  TrackerRow,
  TrackerView,
} from "./types";

const TONES: Tone[] = ["lime", "sun", "blue", "pink"];
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** "Aman K." -> "AK", "Aman" -> "A", "" -> "?". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** The ranker and the paste assessor add one passing line when a text states no academic rules. It is not a rule the student met. */
const isNoRulesLine = (r: { status: RuleStatus; text?: string }): boolean => r.status === "pass" && /^The (posting|paste) states no academic rules$/.test(r.text ?? "");

/** The one line on a card that says how the student stands against the posting's rules. Unknown is never a failure. */
export function verdictLine(eligibility: "eligible" | "check", all: { status: RuleStatus; text?: string }[]): string {
  const rules = all.filter((r) => !isNoRulesLine(r));
  if (rules.length === 0) return "The posting states no eligibility rules";
  const passed = rules.filter((r) => r.status === "pass").length;
  const unknown = rules.filter((r) => r.status === "unknown").length;
  if (passed === 0 && unknown === rules.length) return `We couldn't check ${rules.length} ${plural(rules.length, "rule", "rules")} yet. Confirm your profile`;
  if (eligibility === "eligible" && unknown === 0) return `You qualify: ${passed} of ${rules.length} rules`;
  return `You qualify: ${passed} of ${rules.length} rules. We couldn't check ${unknown}`;
}

type Pick = Picks["picks"][number];

/** A pick from GET /api/v1/picks as a role card. Pay is shown exactly as stated; no monthly figure is derived from text. */
export function pickToCard(p: Pick, index: number): CardData {
  const chips = [...p.locations.slice(0, 2), ...(p.remote ? ["Remote"] : [])];
  const rules: RuleLine[] = p.rules.map((r) => ({ status: r.status, text: r.text }));
  const first = p.whoYouKnow?.[0];
  return {
    id: p.jobId,
    jobId: p.jobId,
    href: `/job/${p.slug}`,
    tone: TONES[index % TONES.length]!,
    company: p.company,
    initial: (p.company.trim()[0] ?? "?").toUpperCase(),
    about: null,
    city: p.locations[0] ?? (p.remote ? "Remote" : null),
    role: p.title,
    chips,
    pay: p.pay.stated ? { stated: true, headline: p.pay.text, monthly: null } : { stated: false, headline: "Pay not stated", monthly: null },
    verdict: verdictLine(p.eligibility, rules),
    rules,
    mustHaves: p.mustHaves.total > 0 ? { met: p.mustHaves.matched, total: p.mustHaves.total } : null,
    who: first ? { initials: initialsOf(first), text: `${first} works here` } : null,
    fresh: p.posted.label,
    answers: null,
    rounds: null,
  };
}

export const picksToCards = (picks: Picks): CardData[] => (picks.placed ? [] : picks.picks.map(pickToCard));

const hostOf = (url: string | null): string | null => {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

/** Applications that stopped on something only the student can do. Undone, ready and sent ones are not here. */
export function toNeedsRows(apps: ApplicationSummary[]): NeedsRow[] {
  const out: NeedsRow[] = [];
  for (const a of apps) {
    if (a.status !== "blocked_fallback") continue;
    const needsAnswers = a.needsYouCount;
    out.push({
      id: a.id,
      company: a.company,
      role: a.title,
      reason: needsAnswers > 0 ? `${needsAnswers} ${plural(needsAnswers, "answer needs", "answers need")} you.` : "It asked for a sign-in.",
      url: a.fallback?.url ?? null,
      needsAnswers,
    });
  }
  return out;
}

const timeLabel = (iso: string, now: Date): string => (daysBetween(new Date(iso), now) <= 0 ? clock(new Date(iso)).replace(/^0/, "") : shortDate(new Date(iso)));

const messageOf = (m: InboundView, now: Date): MessageView => ({
  id: m.id,
  applicationId: m.applicationId,
  from: m.employer,
  subject: m.subject,
  excerpt: m.excerpt,
  at: timeLabel(m.receivedAt, now),
  matched: m.applicationId !== null,
  matchedBy: m.matchedBy === "domain" || m.matchedBy === "company" ? m.matchedBy : "none",
  fromAddr: null,
  toAddr: null,
});

/** Applications and the inbox as the Tracker's stages. Every stage is always present so none is a dead end. */
export interface OutcomeLike {
  id: string;
  kind: "interview" | "offer";
  employer: string;
  roleTitle: string | null;
  verification: "student_reported" | "tpo_verified";
  createdAt: string;
}

export function toTrackerView(apps: ApplicationSummary[], inbox: InboundView[], now: Date, outcomes: OutcomeLike[] = []): TrackerView {
  const needs: TrackerRow[] = [];
  const replies: TrackerRow[] = [];
  const interview: TrackerRow[] = [];
  const applied: TrackerRow[] = [];

  for (const a of apps) {
    if (a.status === "undone") continue;
    const sent = a.submittedAt ? new Date(a.submittedAt) : new Date(a.createdAt);
    const base = { id: a.id, company: a.company, role: a.title, right: null, pill: null, quiet: null, followUp: false, finish: false } as const;
    const when = shortDate(sent);
    if (a.status === "blocked_fallback") {
      needs.push({ ...base, meta: `${a.title}. ${a.needsYouCount > 0 ? `${a.needsYouCount} ${plural(a.needsYouCount, "answer needs", "answers need")} you.` : "It asked for a sign-in."}`, finish: true });
    } else if (a.status === "failed") {
      needs.push({ ...base, meta: `${a.title}. It could not be sent.`, finish: true });
    } else if (a.status === "ready" || a.status === "submitting") {
      applied.push({ ...base, meta: `${a.title}, Hirelane is sending it`, pill: "Applied" });
    } else if (a.lastReply === "interview") {
      interview.push({ ...base, meta: `${a.title}, applied ${when}`, pill: "Interview" });
    } else if (a.lastReply === "test" || a.lastReply === "other") {
      const m = inbox.find((x) => x.applicationId === a.id);
      replies.push({ ...base, meta: m ? `${a.title}: ${m.subject || m.excerpt}` : a.title, right: m ? timeLabel(m.receivedAt, now) : null });
    } else if (a.lastReply === "rejection") {
      applied.push({ ...base, meta: `${a.title}, applied ${when}`, right: "Not this time" });
    } else {
      const quiet = daysBetween(sent, now) >= QUIET_AFTER_DAYS;
      applied.push(
        quiet
          ? { ...base, meta: `${a.title}, applied ${when}`, right: `Quiet ${daysBetween(sent, now)} days`, quiet: `Quiet ${daysBetween(sent, now)} days`, followUp: true }
          : { ...base, meta: `${a.title}, ${when}`, pill: "Applied" },
      );
    }
  }

  const offers: TrackerRow[] = outcomes
    .filter((o) => o.kind === "offer")
    .map((o) => ({
      id: o.id,
      company: o.employer,
      role: o.roleTitle ?? "Offer",
      meta: `${o.roleTitle ?? "Offer"}, ${o.verification === "tpo_verified" ? "verified by your placement cell" : `recorded ${shortDate(new Date(o.createdAt))}`}`,
      right: null,
      pill: "Offer" as const,
      quiet: null,
      followUp: false,
      finish: false,
    }));

  const groups: TrackerGroup[] = [
    { id: "needs", label: "Needs you", rows: needs, empty: "Nothing is waiting on you." },
    { id: "replies", label: "Replies", rows: replies, empty: "Replies from employers show here." },
    { id: "interview", label: "Interview", rows: interview, empty: "When an employer asks for an interview, it moves here." },
    { id: "applied", label: "Applied", rows: applied, empty: "Tap Apply on a pick and it shows here." },
    { id: "offer", label: "Offer", rows: offers, empty: "Offers you record show here, with who can see them." },
  ];
  const messages = inbox.map((m) => messageOf(m, now));
  return { groups, unmatched: messages.filter((m) => !m.matched), messages, badge: needs.length };
}

export function toReceipt(r: { at: string; platform: string; resultCode: string; sent: boolean; answersHash: string; resumeVersion: number | null }, answerCount: number, address: string | null, applyUrl: string | null): ReceiptView {
  const d = new Date(r.at);
  return {
    applied: `${shortDate(d)}, ${clock(d).replace(/^0/, "")}`,
    where: hostOf(applyUrl),
    from: address,
    resume: r.resumeVersion == null ? null : `Version ${r.resumeVersion}`,
    answers: `${answerCount} sent, hash ${r.answersHash.slice(0, 4)} ${r.answersHash.slice(4, 8)}`,
    result: r.sent ? "Accepted by their form" : "Not sent",
  };
}

export function toFinishView(a: ApplicationSummary, answers: { fieldId: string; questionKey: string | null; label: string; needsYou: boolean; answer: string | null; suggestion: string | null }[]): FinishView {
  const list: AnswerView[] = answers.map((x) => ({ key: x.questionKey ?? x.fieldId, answerable: x.questionKey !== null, label: x.label, value: x.answer, needsYou: x.needsYou, suggestion: x.suggestion }));
  const needsAnswers = list.filter((x) => x.needsYou && !x.value).length;
  return {
    id: a.id,
    company: a.company,
    role: a.title,
    url: a.fallback?.url ?? null,
    host: hostOf(a.fallback?.url ?? null),
    reason: needsAnswers > 0 ? "It needs a few answers only you can give, so we stopped. Nothing was sent." : "It asked you to sign in, so we stopped. Nothing was sent. Your answers are ready to copy.",
    answers: list,
    needsAnswers,
  };
}

const roleAndCompany = (title: string): { role: string; company: string | null } => {
  const i = title.lastIndexOf(",");
  if (i <= 0 || i === title.length - 1) return { role: title.trim(), company: null };
  return { role: title.slice(0, i).trim(), company: title.slice(i + 1).trim() };
};

const dayAsDate = (key: string): Date => new Date(`${key}T06:30:00Z`);

/** The student's published drives, split into open, couldn't-check and closed. Rules are the engine's own lines. */
export function toDriveViews(drives: StudentDrive[], now: Date): DrivesData {
  const open: DriveView[] = [];
  const check: DriveView[] = [];
  const closed: DrivesData["closed"] = [];
  for (const d of drives) {
    const stated = d.deadline ?? parseDeadline(d.noticeText, now);
    const { role, company } = roleAndCompany(d.title);
    const pub = new Date(d.publishedAt);
    let daysLeft: number | null = null;
    let closes = "No closing date in the notice";
    let closesShort = "Check the notice";
    let lastDate: string | null = null;
    if (stated) {
      const at = dayAsDate(stated);
      daysLeft = daysBetween(now, at);
      if (daysLeft < 0) {
        closed.push({ id: d.id, role, company, closes: `Ended ${shortDate(at)}`, note: null });
        continue;
      }
      closes = `Closes ${daysLeft <= 2 ? dateLabel(at) : shortDate(at)}`;
      closesShort = daysLeft <= 2 ? `Closes ${dateLabel(at).split(" ")[0]}` : `Closes ${shortDate(at)}`;
      lastDate = dateLabel(at);
    } else if (daysBetween(pub, now) > UNDATED_WINDOW_DAYS) {
      closed.push({ id: d.id, role, company, closes: "Ended", note: null });
      continue;
    }
    const eligible = d.verdict === "eligible";
    const rules: RuleLine[] = d.rules ? d.rules.map((r) => ({ status: r.status, text: r.text })) : d.reasons.map((text) => ({ status: eligible ? "pass" : "unknown", text }));
    const n = rules.length;
    const view: DriveView = {
      id: d.id,
      title: d.title,
      role,
      company,
      closes,
      closesShort,
      daysLeft,
      verdict: eligible ? (n === 0 ? "The notice states no rules we could read" : `You meet all ${n} ${plural(n, "rule", "rules")}`) : "We couldn't check every rule",
      state: eligible ? "eligible" : "check",
      rules,
      publishedLabel: shortDate(pub),
      lastDate,
      rounds: d.rounds,
      documents: d.documents,
      link: d.link && /^https:\/\//i.test(d.link) ? d.link : null,
      pay: null,
      chips: [],
      about: null,
    };
    (eligible ? open : check).push(view);
  }
  const byDeadline = (a: DriveView, b: DriveView) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999);
  open.sort(byDeadline);
  check.sort(byDeadline);
  closed.sort((a, b) => a.id.localeCompare(b.id));
  return { open, check, closed };
}

const inLastWeek = (iso: string | null, now: Date): boolean => iso != null && daysBetween(new Date(iso), now) < 7 && new Date(iso) <= now;

export interface HomeInput {
  me: Pick2<Me, "displayName">;
  picks: Picks;
  apps: ApplicationSummary[];
  inbox: InboundView[];
  drives: StudentDrive[];
  resumes: ResumeSummary[];
  settings: Pick2<ApplySettings, "autoApply" | "applyAddress">;
  /** The pilot is on: Apply really applies. Otherwise it only marks the role ready. */
  pilot?: boolean;
  now: Date;
}
type Pick2<T, K extends keyof T> = { [P in K]: T[P] };

/** Everything Home shows, from the services' own output. Zeros stay zeros; nothing is padded. */
export function toHomeView(i: HomeInput): HomeView {
  const cards = picksToCards(i.picks);
  const fresh = i.picks.placed ? 0 : i.picks.picks.filter((p) => p.posted.ageDays <= 1).length;
  const drives = toDriveViews(i.drives, i.now);
  const resume = i.resumes.find((r) => r.isDefault && r.healthTotal > 0) ?? i.resumes.find((r) => r.healthTotal > 0) ?? null;
  const tracker = toTrackerView(i.apps, i.inbox, i.now);
  const recent = i.inbox.filter((m) => inLastWeek(m.receivedAt, i.now));
  const latest = recent[0];
  const latestApp = latest?.applicationId ? i.apps.find((a) => a.id === latest.applicationId) : undefined;
  const semester = drives.check.some((d) => d.rules.some((r) => /semester/i.test(r.text)));
  const name = firstNameOf(i.me);
  return {
    sample: false,
    firstName: name,
    initial: (name[0] ?? "?").toUpperCase(),
    cards,
    newCount: fresh,
    badge: tracker.badge,
    autoApply: i.settings.autoApply && (i.pilot ?? true),
    pilot: i.pilot ?? true,
    applyAddress: i.settings.applyAddress,
    codes: [],
    finish: toNeedsRows(i.apps),
    drives: [...drives.open, ...drives.check]
      .sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999))
      .slice(0, 2)
      .map((d) => ({ id: d.id, role: d.role, company: d.company, verdict: d.verdict, closesShort: d.closesShort })),
    resume: resume ? { passed: resume.healthPassed, total: resume.healthTotal, topFix: resume.healthPassed < resume.healthTotal ? `${resume.healthTotal - resume.healthPassed} ${plural(resume.healthTotal - resume.healthPassed, "check", "checks")} still to fix.` : null } : null,
    marks: drives.check.length > 0 ? { moreDrives: drives.check.length, label: semester ? "Add your semester marks" : "Add your marks" } : null,
    week: {
      applied: i.apps.filter((a) => a.status === "submitted" && inLastWeek(a.submittedAt, i.now)).length,
      replies: recent.length,
      replyLine: latest ? (latestApp ? `${latest.employer} replied about ${latestApp.title}` : `${latest.employer} wrote back`) : null,
    },
  };
}

const RULE_ORDER: Record<RuleStatus, number> = { fail: 0, unknown: 1, pass: 2 };

/** A pasted post's result as one headline, the rules (misses first) and an honest scam note. */
export function pasteView(r: PasteResult): PasteView {
  const rules = [...r.eligibility.rules].filter((x) => !isNoRulesLine(x)).sort((a, b) => RULE_ORDER[a.status] - RULE_ORDER[b.status]).map((x) => ({ status: x.status, text: x.text }));
  const n = rules.length;
  const fail = rules.filter((x) => x.status === "fail").length;
  const unknown = rules.filter((x) => x.status === "unknown").length;
  const stated = r.eligibility.rules.length > 0;
  const headline =
    n === 0
      ? stated
        ? "No eligibility rules in this post"
        : "We couldn't read any rules in this post"
      : fail > 0
        ? `You don't meet ${fail} of ${n} ${plural(n, "rule", "rules")}`
        : unknown > 0
          ? `We couldn't check ${unknown} of ${n} ${plural(n, "rule", "rules")}`
          : `You meet all ${n} ${plural(n, "rule", "rules")}`;
  const title = [r.job.title, r.job.company].filter(Boolean).join(", ") || "This post";
  const quotes = r.scam.signals.map((s) => s.quote);
  const scam = r.scam.flagged ? { title: "This looks like a scam", quotes } : r.scam.risk === "medium" || r.scam.risk === "low" ? (quotes.length > 0 ? { title: "Worth a second look", quotes } : null) : null;
  const m = r.fit.mustHaves;
  return {
    title,
    headline,
    rules,
    pay: r.job.pay.stated ? r.job.pay.text : "Pay not stated",
    fit: m.total > 0 ? `${m.matched} of ${m.total} must-haves` : "No must-haves listed",
    scam,
  };
}

