/**
 * Rich pick cards for the swipe deck. Every field maps to something we can know honestly: the posting (via our
 * engine), the company's own careers page (posting counts), the student's confirmed profile, and their own
 * connections file. Sample values only; real cards come from match:user + picks:user (HLD M3).
 */
export type DeckCard = {
  id: string;
  company: string;
  initial: string;
  tone: "lime" | "sun" | "blue" | "pink";
  about: string;
  role: string;
  city: string;
  mode: string;
  shift: string;
  postedAgo: string;
  momentum: string;
  pay: { label: string; monthly: string | null; stated: boolean };
  fit: { met: number; total: number; lines: { ok: boolean | "partial"; text: string; quote: string }[] };
  rules: { met: number; total: number };
  warm: { initials: string; who: string } | null;
  day: string[];
  rounds: string[];
  applyEffort: string;
};

export const DECK: DeckCard[] = [
  {
    id: "zenoti",
    company: "Zenoti",
    initial: "Z",
    tone: "lime",
    about: "Software that salons and spas run on, used in 50 countries",
    role: "Customer Support Associate",
    city: "Hyderabad",
    mode: "On-site",
    shift: "Rotational shifts",
    postedAgo: "Posted 2h ago",
    momentum: "6 new roles this week",
    pay: { label: "₹3.6 LPA", monthly: "about ₹30,000 a month before tax", stated: true },
    fit: {
      met: 4,
      total: 5,
      lines: [
        { ok: true, text: "Any graduate", quote: "Graduate in any discipline" },
        { ok: true, text: "English and Hindi", quote: "fluent in English" },
        { ok: true, text: "0 to 1 years", quote: "you graduated in 2025" },
        { ok: true, text: "MS Excel", quote: "on your resume" },
        { ok: "partial", text: "Night shifts", quote: "not in your preferences" },
      ],
    },
    rules: { met: 3, total: 3 },
    warm: { initials: "AK", who: "Aman K. works here (Senior Support Engineer)" },
    day: ["Answer salon owners on chat and email", "Fix booking and billing issues", "Hand tricky cases to engineers"],
    rounds: ["Online test", "Voice round", "HR"],
    applyEffort: "8 of 9 answers ready, about 4 minutes",
  },
  {
    id: "payoneer",
    company: "Payoneer",
    initial: "P",
    tone: "sun",
    about: "Cross-border payments for freelancers and small businesses",
    role: "Operations Analyst Trainee",
    city: "Bengaluru",
    mode: "Hybrid",
    shift: "Day shift",
    postedAgo: "Posted yesterday",
    momentum: "31 open roles in India",
    pay: { label: "Pay not stated", monthly: null, stated: false },
    fit: {
      met: 3,
      total: 4,
      lines: [
        { ok: true, text: "B.Com or BBA", quote: "Commerce graduates preferred" },
        { ok: true, text: "Excel and reconciliation", quote: "your GST billing project" },
        { ok: true, text: "2025 or 2026 batch", quote: "you graduated in 2025" },
        { ok: false, text: "SQL basics", quote: "not on your resume" },
      ],
    },
    rules: { met: 2, total: 2 },
    warm: { initials: "SM", who: "Sneha M. and 1 other work here" },
    day: ["Match payments to invoices", "Flag mismatches for review", "Update daily reports"],
    rounds: ["Assessment", "Manager interview"],
    applyEffort: "7 of 8 answers ready, about 5 minutes",
  },
  {
    id: "sigmoid",
    company: "Sigmoid",
    initial: "S",
    tone: "blue",
    about: "Data engineering services for global retail and CPG brands",
    role: "Data Operations Trainee",
    city: "Bengaluru",
    mode: "On-site",
    shift: "Day shift",
    postedAgo: "Posted 3 days ago",
    momentum: "38 open roles in India",
    pay: { label: "₹4.2 LPA", monthly: "about ₹35,000 a month before tax", stated: true },
    fit: {
      met: 3,
      total: 5,
      lines: [
        { ok: true, text: "Any graduate", quote: "Bachelor's in any field" },
        { ok: true, text: "Excel", quote: "on your resume" },
        { ok: true, text: "Fresher", quote: "0 years" },
        { ok: false, text: "Python basics", quote: "not on your resume" },
        { ok: "partial", text: "Attention to detail", quote: "shown in your audit project" },
      ],
    },
    rules: { met: 2, total: 2 },
    warm: null,
    day: ["Check data loads every morning", "Fix broken rows with a playbook", "Report issues to the data team"],
    rounds: ["Online test", "Technical", "HR"],
    applyEffort: "6 of 9 answers ready, about 6 minutes",
  },
];
