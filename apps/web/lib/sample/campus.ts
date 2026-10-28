/**
 * Placement-console data contract and a labelled sample cohort for the dev preview and the G4 placement-cell
 * conversations. Real numbers come from SECURITY DEFINER aggregates (Amendment B §15): totals only, any group under
 * 10 students hidden.
 */
export type CampusOverview = {
  sample: boolean;
  college: string;
  cohort: string;
  asOf: string;
  finalYears: number;
  joined: number;
  placedOnCampus: number;
  offCampusOffers: { total: number; verified: number };
  funnel: { label: string; count: number }[];
  stuck: { blocker: string; students: number; action: string }[];
  hiddenGroups: number;
  drives: { company: string; role: string; rules: string; eligible: number; applied: number; deadline: string; status: "open" | "closing" | "closed" }[];
};

export const SAMPLE_CAMPUS: CampusOverview = {
  sample: true,
  college: "Sample University, Indore",
  cohort: "B.Com and BBA, batch of 2026",
  asOf: "29 Oct, 9:00",
  finalYears: 412,
  joined: 268,
  placedOnCampus: 96,
  offCampusOffers: { total: 31, verified: 22 },
  funnel: [
    { label: "Joined Hirelane", count: 268 },
    { label: "Resume ready", count: 201 },
    { label: "Eligible for at least one role", count: 174 },
    { label: "Applied", count: 118 },
    { label: "Interview", count: 46 },
    { label: "Offer", count: 31 },
  ],
  stuck: [
    { blocker: "No project links on the resume", students: 71, action: "Ask project guides to have students add a GitHub or drive link" },
    { blocker: "Resume can't be read by hiring software (Canva or scanned)", students: 64, action: "Run a 30-minute resume clinic; students can rebuild theirs in Hirelane" },
    { blocker: "Below 60% in 12th", students: 52, action: "Point them to drives with no 12th cutoff (21 open now)" },
    { blocker: "CGPA written without its scale", students: 38, action: "Share the university's CGPA-to-% rule once; it applies to every student" },
  ],
  hiddenGroups: 3,
  drives: [
    { company: "Mass recruiter (sample)", role: "Process Associate", rules: "55% throughout, no active backlogs", eligible: 143, applied: 61, deadline: "31 Oct", status: "closing" },
    { company: "Private bank (sample)", role: "Relationship Officer", rules: "60% or 6.0 CGPA in graduation", eligible: 88, applied: 19, deadline: "3 Nov", status: "open" },
    { company: "IT services firm (sample)", role: "Trainee Engineer", rules: "60% throughout, B.E/B.Tech, MCA", eligible: 0, applied: 0, deadline: "2 Nov", status: "open" },
  ],
};

export type ProgrammeRow = { programme: string; finalYears: number; joined: number; ready: number; eligible: number; applied: number; interviews: number; offers: number } | { programme: string; hidden: true; finalYears: number };

export const SAMPLE_PROGRAMMES: ProgrammeRow[] = [
  { programme: "B.Com (General)", finalYears: 186, joined: 121, ready: 92, eligible: 80, applied: 56, interviews: 21, offers: 14 },
  { programme: "B.Com (Computer Applications)", finalYears: 74, joined: 52, ready: 41, eligible: 36, applied: 25, interviews: 11, offers: 8 },
  { programme: "BBA", finalYears: 112, joined: 79, ready: 58, eligible: 50, applied: 33, interviews: 12, offers: 8 },
  { programme: "BBA (Logistics)", hidden: true, finalYears: 9 },
  { programme: "B.Com (Honours)", finalYears: 31, joined: 16, ready: 10, eligible: 8, applied: 4, interviews: 2, offers: 1 },
];

export type OfferRow = { id: string; student: string; programme: string; employer: string; lpa: number; source: "Hirelane" | "On-campus drive"; letter: boolean; status: "verified" | "waiting" | "rejected" };

export const SAMPLE_OFFERS: OfferRow[] = [
  { id: "o1", student: "Sample Student 04", programme: "B.Com (General)", employer: "Mass recruiter (sample)", lpa: 3.2, source: "Hirelane", letter: true, status: "waiting" },
  { id: "o2", student: "Sample Student 11", programme: "BBA", employer: "Private bank (sample)", lpa: 4.0, source: "Hirelane", letter: true, status: "waiting" },
  { id: "o3", student: "Sample Student 17", programme: "B.Com (Computer Applications)", employer: "SaaS startup (sample)", lpa: 4.5, source: "Hirelane", letter: false, status: "waiting" },
  { id: "o4", student: "Sample Student 02", programme: "B.Com (General)", employer: "Retail chain (sample)", lpa: 2.8, source: "On-campus drive", letter: true, status: "verified" },
  { id: "o5", student: "Sample Student 09", programme: "BBA", employer: "Logistics firm (sample)", lpa: 3.6, source: "Hirelane", letter: true, status: "verified" },
];

export const SAMPLE_NOTICE = `Off-campus drive: Customer Success Associate, Bengaluru (on-site)
Eligibility: B.Com / BBA / BBM, 2025 or 2026 passout. Minimum 60% or 6.0 CGPA in graduation and 55% in 10th and 12th. No active backlogs.
CTC: 3.6 LPA. Apply on the company careers page by 6 Nov.`;
