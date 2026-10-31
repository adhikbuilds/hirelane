/**
 * View models for the student app. Plain data, no React and no services: the loaders build them from real service
 * output (lib/student/load.ts) and the labelled sample (lib/student/sample.ts) fills the same shapes in development.
 * A field is null or absent when no service knows it. Nothing here is a score or a percentage match.
 */
export type Tone = "lime" | "sun" | "blue" | "pink";
export type RuleStatus = "pass" | "unknown" | "fail";

export interface RuleLine {
  status: RuleStatus;
  text: string;
  /** Where the rule came from or how it was worked out, one short line. */
  note?: string;
}

/** One role on the deck. Fields without a source are null: the card shows only what is true. */
export interface CardData {
  id: string;
  /** The ingested job. null for a sample card: swiping a sample never touches the network. */
  jobId: string | null;
  /** The full posting. null when there is none to open (the sample). */
  href: string | null;
  tone: Tone;
  company: string;
  initial: string;
  about: string | null;
  city: string | null;
  role: string;
  chips: string[];
  pay: { stated: boolean; headline: string; monthly: string | null };
  verdict: string;
  rules: RuleLine[];
  mustHaves: { met: number; total: number } | null;
  who: { initials: string; text: string } | null;
  fresh: string;
  answers: { ready: number; total: number; ask: string | null } | null;
  rounds: string | null;
}

/** An application stopped on a site that wants the student: finish there, or answer a question and send it again. */
export interface NeedsRow {
  id: string;
  company: string;
  role: string;
  reason: string;
  /** The company's own https form, when the application stopped on it. */
  url: string | null;
  /** Answers the student still owes. Above 0 the application can be sent again (rearm). */
  needsAnswers: number;
}

/** A one-time code the student must copy. Shown only when a source exists; the sample carries one for the layout. */
export interface NeedsCode {
  id: string;
  from: string;
  code: string;
  note: string;
}

export interface DriveView {
  id: string;
  /** The title the placement cell typed. */
  title: string;
  role: string;
  company: string | null;
  closes: string;
  closesShort: string;
  daysLeft: number | null;
  verdict: string;
  state: "eligible" | "check";
  rules: RuleLine[];
  publishedLabel: string;
  lastDate: string | null;
  rounds: string | null;
  documents: string | null;
  link: string | null;
  /** Pay and place chips come only from a placement cell that typed them; none of the services carry them yet. */
  pay: string | null;
  chips: string[];
  about: string | null;
}

export interface ClosedDriveView {
  id: string;
  role: string;
  company: string | null;
  closes: string;
  /** Why it never showed in the student's picks, when we know. */
  note: string | null;
}

export interface DrivesData {
  open: DriveView[];
  check: DriveView[];
  closed: ClosedDriveView[];
}

export interface TrackerRow {
  id: string;
  company: string;
  role: string;
  meta: string;
  /** A short right-hand label: a time, a status. */
  right: string | null;
  pill: "Applied" | "Interview" | "Offer" | null;
  quiet: string | null;
  followUp: boolean;
  finish: boolean;
}

export interface TrackerGroup {
  id: "needs" | "replies" | "interview" | "applied" | "offer";
  label: string;
  rows: TrackerRow[];
  /** What the empty stage says, so no stage is a dead end. */
  empty: string | null;
}

export interface MessageView {
  id: string;
  applicationId: string | null;
  from: string;
  subject: string;
  excerpt: string;
  at: string;
  matched: boolean;
  /** How the service tied the message to an employer: the sender's domain, the company name, or not at all. */
  matchedBy: "company" | "domain" | "none";
  fromAddr: string | null;
  toAddr: string | null;
}

export interface TrackerView {
  groups: TrackerGroup[];
  unmatched: MessageView[];
  messages: MessageView[];
  badge: number;
}

export interface ReceiptView {
  applied: string;
  where: string | null;
  from: string | null;
  resume: string | null;
  answers: string;
  result: string;
}

export interface AnswerView {
  key: string;
  /** Only an answer with a question key can be saved from here. */
  answerable: boolean;
  label: string;
  value: string | null;
  needsYou: boolean;
  suggestion: string | null;
}

export interface FinishView {
  id: string;
  company: string;
  role: string;
  url: string | null;
  host: string | null;
  reason: string;
  answers: AnswerView[];
  needsAnswers: number;
}

export interface HomeView {
  sample: boolean;
  firstName: string;
  initial: string;
  cards: CardData[];
  newCount: number;
  badge: number;
  autoApply: boolean;
  /** Whether a right swipe really applies (the pilot is on). */
  pilot: boolean;
  applyAddress: string | null;
  codes: NeedsCode[];
  finish: NeedsRow[];
  drives: { id: string; role: string; company: string | null; verdict: string; closesShort: string }[];
  resume: { passed: number; total: number; topFix: string | null } | null;
  marks: { moreDrives: number; label: string } | null;
  week: { applied: number; replies: number; replyLine: string | null };
}

export interface PasteRuleView {
  status: RuleStatus;
  text: string;
}

export interface PasteView {
  title: string;
  headline: string;
  rules: PasteRuleView[];
  pay: string;
  fit: string;
  scam: { title: string; quotes: string[] } | null;
}
