import type { CardData, DrivesData, FinishView, HomeView, MessageView, ReceiptView, TrackerView } from "./types";

/**
 * The labelled sample student for development: the people and employers from the approved mocks (docs/design/mocks).
 * All fictional. Only ever shown when decideSource says "sample", which is development and nothing else.
 */
export const SAMPLE_ADDRESS = "rahul.k3x@apply.hirelane.in";

export const SAMPLE_CARDS: CardData[] = [
  {
    id: "trellis",
    jobId: null,
    href: "/jobs",
    tone: "lime",
    company: "Trellis Cloud",
    initial: "T",
    about: "Software that salons and spas run on",
    city: "Hyderabad",
    role: "Customer Support Associate",
    chips: ["Hyderabad", "On-site", "Rotational shifts"],
    pay: { stated: true, headline: "₹3.6 LPA", monthly: "about ₹30,000 a month before tax" },
    verdict: "You qualify: 3 of 3 rules",
    rules: [
      { status: "pass", text: "12th: 58%, needs 55%", note: "From the posting’s eligibility section" },
      { status: "pass", text: "Graduation: 8.1 CGPA = 73.5%, needs 60%", note: "Sample University’s rule, (CGPA − 0.75) × 10, checked 12 Oct" },
      { status: "pass", text: "Active backlogs: 0, needs none", note: "From your eligibility profile" },
    ],
    mustHaves: { met: 4, total: 5 },
    who: { initials: "AK", text: "Aman K. works here (Senior Support Engineer)" },
    fresh: "Posted 2h ago, from careers.trelliscloud.in",
    answers: { ready: 6, total: 7, ask: "can you work rotational shifts?" },
    rounds: "Online assessment, then an HR interview. Dates come with the invite.",
  },
  {
    id: "ankur",
    jobId: null,
    href: "/jobs",
    tone: "sun",
    company: "Ankur Logistics",
    initial: "A",
    about: "Road freight for FMCG brands in western India",
    city: "Pune",
    role: "Shipment Coordinator",
    chips: ["Pune", "On-site", "Day shift"],
    pay: { stated: true, headline: "₹3.2 LPA", monthly: "about ₹26,700 a month before tax" },
    verdict: "You qualify: 3 of 3 rules",
    rules: [
      { status: "pass", text: "Graduation: any degree, 2025 or 2026", note: "You: B.Com, 2026" },
      { status: "pass", text: "12th: 58%, needs 50%" },
      { status: "pass", text: "Hindi and English", note: "From your resume: both listed" },
    ],
    mustHaves: { met: 3, total: 4 },
    who: null,
    fresh: "Posted 5h ago, from ankurlogistics.in/careers",
    answers: { ready: 6, total: 7, ask: "can you join by 1 Dec?" },
    rounds: "A phone screen, then an interview at the Pune office. Carry your 12th marksheet.",
  },
  {
    id: "saarthi",
    jobId: null,
    href: "/jobs",
    tone: "blue",
    company: "Saarthi Health",
    initial: "S",
    about: "Home-care nursing and lab tests in 6 cities",
    city: "Bengaluru",
    role: "Patient Support Executive",
    chips: ["Bengaluru", "Hybrid", "Day shift"],
    pay: { stated: true, headline: "₹3.0 LPA", monthly: "about ₹25,000 a month before tax" },
    verdict: "You qualify: 2 of 2 rules",
    rules: [
      { status: "pass", text: "Graduation: 55%, you have 73.5%", note: "8.1 CGPA by Sample University’s rule" },
      { status: "pass", text: "Fresher, 2026 passouts" },
    ],
    mustHaves: { met: 4, total: 4 },
    who: { initials: "PS", text: "Pooja S. works here (Care Operations Lead)" },
    fresh: "Posted yesterday, from careers.saarthihealth.in",
    answers: { ready: 7, total: 7, ask: null },
    rounds: "A spoken English and Hindi call, then a video interview with the care team.",
  },
];

export const SAMPLE_HOME: HomeView = {
  sample: true,
  firstName: "Rahul",
  initial: "R",
  cards: SAMPLE_CARDS,
  newCount: 3,
  badge: 2,
  autoApply: true,
  pilot: true,
  applyAddress: SAMPLE_ADDRESS,
  codes: [{ id: "code-kosha", from: "Kosha Payments", code: "482 913", note: "Works for 10 minutes. Received 9:40." }],
  finish: [{ id: "brightdesk", company: "Brightdesk", role: "Customer Success Associate", reason: "It asked for a sign-in. Your 7 answers are ready.", url: "https://careers.brightdesk.in/jobs/csa-2026", needsAnswers: 0 }],
  drives: [
    { id: "d1", role: "Process Associate", company: "Anvaya Retail", verdict: "You meet all 4 rules", closesShort: "Closes Sun" },
    { id: "d2", role: "Relationship Officer", company: "Suvidha Bank", verdict: "We couldn’t check: your semester marks", closesShort: "Closes 5 Nov" },
  ],
  resume: { passed: 6, total: 9, topFix: "It runs to 2 pages. Fix that first." },
  marks: { moreDrives: 2, label: "Add your semester marks" },
  week: { applied: 4, replies: 1, replyLine: "Kosha Payments replied about Operations Analyst" },
};

export const SAMPLE_DRIVES: DrivesData = {
  open: [
    {
      id: "d1",
      title: "Process Associate, Anvaya Retail",
      role: "Process Associate",
      company: "Anvaya Retail",
      closes: "Closes Sun 1 Nov",
      closesShort: "Closes Sun",
      daysLeft: 1,
      verdict: "You meet all 4 rules",
      state: "eligible",
      rules: [
        { status: "pass", text: "10th: 71%, needs 55%" },
        { status: "pass", text: "12th: 58%, needs 55%" },
        { status: "pass", text: "Graduation: 8.1 CGPA = 73.5%, needs 60%", note: "Sample University’s rule, (CGPA − 0.75) × 10, checked 12 Oct" },
        { status: "pass", text: "Active backlogs: 0, needs none" },
      ],
      publishedLabel: "27 Oct",
      lastDate: "Sunday 1 Nov, 11:59 pm",
      rounds: "Online assessment, 8 Nov, 10:00. Computer lab 2, main block.\nHR interview, 12 Nov.",
      documents: "Resume, college ID, 12th marksheet",
      link: "https://careers.anvayaretail.in/process-associate",
      pay: "₹2.8 LPA, about ₹23,300 a month before tax",
      chips: ["Indore", "On-site", "Day shift"],
      about: "Anvaya Retail, back-office operations for a retail chain",
    },
    {
      id: "d3",
      title: "Customer Success Associate, Brightdesk",
      role: "Customer Success Associate",
      company: "Brightdesk",
      closes: "Closes 6 Nov",
      closesShort: "Closes 6 Nov",
      daysLeft: 6,
      verdict: "You meet all 3 rules",
      state: "eligible",
      rules: [
        { status: "pass", text: "Any graduate, 2026 passout" },
        { status: "pass", text: "12th: 58%, needs 50%" },
        { status: "pass", text: "Hindi and English" },
      ],
      publishedLabel: "28 Oct",
      lastDate: "Friday 6 Nov, 11:59 pm",
      rounds: null,
      documents: null,
      link: null,
      pay: null,
      chips: [],
      about: null,
    },
  ],
  check: [
    {
      id: "d2",
      title: "Relationship Officer, Suvidha Small Finance Bank",
      role: "Relationship Officer",
      company: "Suvidha Small Finance Bank",
      closes: "Closes 5 Nov",
      closesShort: "Closes 5 Nov",
      daysLeft: 5,
      verdict: "We couldn’t check every rule",
      state: "check",
      rules: [{ status: "unknown", text: "Needs 60% in every semester. You’ve entered your CGPA only." }],
      publishedLabel: "26 Oct",
      lastDate: "Thursday 5 Nov, 11:59 pm",
      rounds: null,
      documents: null,
      link: null,
      pay: null,
      chips: [],
      about: null,
    },
  ],
  closed: [
    { id: "d4", role: "Data Entry Operator", company: "Pathway Freight", closes: "Ended 20 Oct", note: null },
    { id: "d5", role: "Claims Associate", company: "Neelgiri Insurance Brokers", closes: "Ended 22 Sep", note: "12th: 58%, needs 60%. It never showed in your picks." },
  ],
};

export const SAMPLE_MESSAGES: MessageView[] = [
  {
    id: "m1",
    applicationId: "kosha",
    from: "Kosha Payments",
    subject: "Operations Analyst: next step",
    excerpt:
      "Hi Rahul,\n\nThanks for applying for Operations Analyst. The next step is an online assessment on reconciliation and Excel. Please share two slots that work for you between 3 and 7 November.\n\nRegards,\nTalent team, Kosha Payments",
    at: "9:12",
    matched: true,
    matchedBy: "domain",
    fromAddr: "talent@koshapay.in",
    toAddr: SAMPLE_ADDRESS,
  },
  { id: "m2", applicationId: null, from: "recruit.hr2026@gmail.com", subject: "Looks like a scam: asks for a ₹1,500 fee", excerpt: "", at: "Yesterday", matched: false, matchedBy: "none", fromAddr: "recruit.hr2026@gmail.com", toAddr: SAMPLE_ADDRESS },
];

export const SAMPLE_TRACKER: TrackerView = {
  badge: 2,
  messages: SAMPLE_MESSAGES,
  unmatched: [SAMPLE_MESSAGES[1]!],
  groups: [
    { id: "needs", label: "Needs you", empty: null, rows: [{ id: "brightdesk", company: "Brightdesk", role: "Customer Success Associate", meta: "Customer Success Associate. It asked for a sign-in.", right: null, pill: null, quiet: null, followUp: false, finish: true }] },
    { id: "replies", label: "Replies", empty: null, rows: [{ id: "kosha", company: "Kosha Payments", role: "Operations Analyst", meta: "Operations Analyst: “Share your availability…”", right: "9:12", pill: null, quiet: null, followUp: false, finish: false }] },
    { id: "interview", label: "Interview", empty: null, rows: [{ id: "saarthi", company: "Saarthi Health", role: "Patient Support Executive", meta: "Patient Support Executive, 4 Nov", right: null, pill: "Interview", quiet: null, followUp: false, finish: false }] },
    {
      id: "applied",
      label: "Applied",
      empty: null,
      rows: [
        { id: "lotus", company: "Lotus Hotels", role: "Guest Relations Associate", meta: "Guest Relations Associate, 27 Oct", right: null, pill: "Applied", quiet: null, followUp: false, finish: false },
        { id: "pathway", company: "Pathway Freight", role: "Logistics Coordinator", meta: "Logistics Coordinator, applied 25 Oct", right: "Quiet 6 days", pill: null, quiet: "Quiet 6 days", followUp: true, finish: false },
        { id: "medhaa", company: "Medhaa Learning", role: "Inside Sales Associate", meta: "Inside Sales Associate, 24 Oct", right: null, pill: "Applied", quiet: null, followUp: false, finish: false },
      ],
    },
    { id: "offer", label: "Offer", empty: "Offers you record show here, with who can see them.", rows: [] },
  ],
};

export const SAMPLE_RECEIPT: ReceiptView = {
  applied: "24 Oct, 10:42",
  where: "jobs.koshapay.in",
  from: SAMPLE_ADDRESS,
  resume: "Version 2",
  answers: "7 sent, hash a91f 03c2",
  result: "Accepted by their form",
};

export const SAMPLE_FINISH: FinishView = {
  id: "brightdesk",
  company: "Brightdesk",
  role: "Customer Success Associate",
  url: "https://careers.brightdesk.in/jobs/csa-2026",
  host: "careers.brightdesk.in",
  reason: "It asked you to sign in, so we stopped. Nothing was sent. Your answers are ready to copy.",
  needsAnswers: 0,
  answers: [
    { answerable: true, key: "full_name", label: "Full name", value: "Rahul Verma", needsYou: false, suggestion: null },
    { answerable: true, key: "email", label: "Email", value: SAMPLE_ADDRESS, needsYou: false, suggestion: null },
    { answerable: true, key: "graduation", label: "Graduation", value: "B.Com, 8.1 CGPA out of 10, 2026", needsYou: false, suggestion: null },
    { answerable: true, key: "pct_12", label: "12th percentage", value: "58", needsYou: false, suggestion: null },
    { answerable: true, key: "why_role", label: "Why do you want this role?", value: "I’ve handled customer queries at my family’s pharmacy for two years and enjoy fixing problems people bring to me. I’d like to do that for clinics using Brightdesk.", needsYou: false, suggestion: null },
    { answerable: true, key: "notice", label: "Notice period", value: "Available from June 2026", needsYou: false, suggestion: null },
  ],
};
