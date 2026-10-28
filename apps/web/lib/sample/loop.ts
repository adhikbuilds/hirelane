/**
 * Data contracts for the picks loop, Drives, Tracker and the weekly recap, plus labelled sample data for the dev
 * previews. Real adapters arrive with HLD M3–M7 and the campus slice; nothing here is shown to a real student.
 */
export type FitLine = { status: "pass" | "fail" | "partial"; text: string; quote?: string };

export type PickCard = {
  company: string;
  initial: string;
  role: string;
  city: string;
  experience: string;
  employment: string;
  readAgo: string;
  mustHaves: { met: number; total: number };
  fit: FitLine[];
  pay: string | null;
  eligibility: { rulesMet: number; rulesTotal: number; status: "pass" | "unknown" };
};

export type CheckAnswer = { label: string; value: string; source: string };

export type DriveItem = {
  id: string;
  company: string;
  role: string;
  ctc: string | null;
  deadlineLabel: string;
  daysLeft: number;
  status: "eligible" | "check" | "not_eligible" | "scam";
  headline: string;
  rules: { text: string; status: "pass" | "fail" | "unknown" }[];
};

export type TrackerItem = {
  id: string;
  company: string;
  initial: string;
  role: string;
  state: "handed_off" | "replied" | "interview" | "offer" | "quiet" | "not_this_time";
  steps: { at: string; text: string; done: boolean }[];
};

export type Recap = { weekLabel: string; handedOff: number; replies: number; retyping: number; minutesPerApplication: number; bestMatch: string };

export const SAMPLE_PICK: PickCard = {
  company: "Zenoti",
  initial: "Z",
  role: "Customer Support Associate",
  city: "Hyderabad",
  experience: "0 to 1 years",
  employment: "Full time",
  readAgo: "2h ago",
  mustHaves: { met: 4, total: 5 },
  fit: [
    { status: "pass", text: "Any graduate", quote: "Graduate in any discipline" },
    { status: "pass", text: "English and Hindi", quote: "fluent in English; Hindi preferred" },
    { status: "pass", text: "0 to 1 years", quote: "you're a 2025 grad" },
    { status: "pass", text: "MS Excel", quote: "from your skills" },
    { status: "partial", text: "Night shifts", quote: "rotational shifts; not in your preferences" },
  ],
  pay: null,
  eligibility: { rulesMet: 2, rulesTotal: 2, status: "pass" },
};

export const SAMPLE_ANSWERS: CheckAnswer[] = [
  { label: "Graduation", value: "2025, B.Com, Sample College of Commerce", source: "from your resume" },
  { label: "Phone", value: "+91 90000 00001", source: "from your profile" },
  { label: "Languages", value: "English, Hindi", source: "from your resume" },
  { label: "Current location", value: "Indore", source: "from your profile" },
];

export const SAMPLE_DRIVES: DriveItem[] = [
  {
    id: "d1",
    company: "A mass recruiter (sample)",
    role: "Process Associate",
    ctc: "3.2 LPA",
    deadlineLabel: "Sat 31 Oct",
    daysLeft: 2,
    status: "eligible",
    headline: "You meet all 4 rules",
    rules: [
      { text: "55% in 10th, 12th and graduation", status: "pass" },
      { text: "No active backlogs", status: "pass" },
      { text: "2025 or 2026 passout", status: "pass" },
      { text: "B.Com, BBA, BCA", status: "pass" },
    ],
  },
  {
    id: "d2",
    company: "A bank (sample)",
    role: "Relationship Officer",
    ctc: "4 LPA",
    deadlineLabel: "Tue 3 Nov",
    daysLeft: 5,
    status: "check",
    headline: "We couldn't check one rule",
    rules: [
      { text: "60% or 6.0 CGPA in graduation", status: "unknown" },
      { text: "No active backlogs", status: "pass" },
    ],
  },
];

export const SAMPLE_TRACKER: TrackerItem[] = [
  {
    id: "t1",
    company: "Zenoti",
    initial: "Z",
    role: "Customer Support Associate",
    state: "replied",
    steps: [
      { at: "Mon 9:02", text: "Matched: 4 of 5 must-haves", done: true },
      { at: "Mon 9:10", text: "Filled 8 answers, you answered 1", done: true },
      { at: "Mon 9:14", text: "You submitted on their careers page", done: true },
      { at: "Today 6:40", text: "\"Can you do a call Thursday?\"", done: true },
    ],
  },
  {
    id: "t2",
    company: "Process Associate drive",
    initial: "D",
    role: "From your placement cell",
    state: "interview",
    steps: [
      { at: "Wed 11:00", text: "Online test cleared", done: true },
      { at: "Fri 3:00", text: "Interview booked", done: false },
    ],
  },
  {
    id: "t3",
    company: "Payoneer",
    initial: "P",
    role: "Operations Analyst",
    state: "handed_off",
    steps: [{ at: "Tue 8:30", text: "You submitted on their careers page", done: true }],
  },
  {
    id: "t4",
    company: "Sigmoid",
    initial: "S",
    role: "Data Operations Trainee",
    state: "quiet",
    steps: [{ at: "6 days ago", text: "You submitted on their careers page", done: true }],
  },
];

export const SAMPLE_RECAP: Recap = { weekLabel: "26 Oct to 1 Nov", handedOff: 4, replies: 1, retyping: 0, minutesPerApplication: 4, bestMatch: "Zenoti" };
