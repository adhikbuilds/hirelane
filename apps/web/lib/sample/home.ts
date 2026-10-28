/**
 * The Home dashboard's data contract, and a labelled sample student for the dev preview.
 *
 * The real adapter (services → HomeData) lands with HLD M3–M7. Until then /dev/account/home renders SAMPLE_HOME, and
 * every screen that shows it says "sample". Counts are never padded: a real Home shows what the services return,
 * including zero.
 */
export type HomeData = {
  sample: boolean;
  firstName: string;
  college: string | null;
  /** IST date label, e.g. "Thu 29 Oct". */
  dateLabel: string;
  /** Days in a row the student opened picks. Pauses never break it. */
  streakDays: number;
  paused: boolean;
  picks: {
    total: number;
    fresherFriendly: number;
    remote: number;
    payStated: number;
    readAgo: string;
    /** Initials of the first three companies, for the stacked chips. */
    companies: { initial: string; name: string; tone: "lime" | "pink" | "blue" | "sun" }[];
    minutes: number;
  };
  resume: { passed: number; total: number; topFix: string | null } | null;
  qualify: { count: number; blockedBy: { label: string; count: number } | null };
  drives: { id: string; company: string; role: string; deadlineLabel: string; daysLeft: number; status: "eligible" | "check" | "not_eligible"; reason: string }[];
  feed: { at: string; text: string; tag: "match" | "reply" | "gone" | "drive" }[];
  week: { handedOff: number; replies: number; minutesSaved: number; recapReady: boolean };
};

export const SAMPLE_HOME: HomeData = {
  sample: true,
  firstName: "Rahul",
  college: "Sample College of Commerce, Indore",
  dateLabel: "Thu 29 Oct",
  streakDays: 4,
  paused: false,
  picks: {
    total: 3,
    fresherFriendly: 3,
    remote: 1,
    payStated: 1,
    readAgo: "2h ago",
    companies: [
      { initial: "Z", name: "Zenoti", tone: "lime" },
      { initial: "P", name: "Payoneer", tone: "pink" },
      { initial: "S", name: "Sigmoid", tone: "blue" },
    ],
    minutes: 3,
  },
  resume: { passed: 6, total: 9, topFix: "Your resume has your Aadhaar number. Remove it." },
  qualify: { count: 7, blockedBy: { label: "60% in 12th", count: 4 } },
  drives: [
    { id: "d1", company: "A mass recruiter (sample)", role: "Process Associate", deadlineLabel: "Sat 31 Oct", daysLeft: 2, status: "eligible", reason: "You meet all 4 rules" },
    { id: "d2", company: "A bank (sample)", role: "Relationship Officer", deadlineLabel: "Tue 3 Nov", daysLeft: 5, status: "check", reason: "We couldn't check: your CGPA rule" },
  ],
  feed: [
    { at: "02:04", text: "Zenoti posted Customer Support Associate", tag: "match" },
    { at: "06:40", text: "Your placement cell added a drive", tag: "drive" },
    { at: "07:15", text: "Payoneer closed a role you saved", tag: "gone" },
  ],
  week: { handedOff: 4, replies: 1, minutesSaved: 38, recapReady: true },
};
