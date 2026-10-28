# Hirelane campus-first: strategy for large private universities and tier-3 colleges

Version 1.0, 2026-10-29. Answers FINAL-BUSINESS §15 decision 3 ("Campus-first?") with **yes** (owner, 2026-10-29). Supersedes FINAL-BUSINESS §3 UC5, §5 Campus row and §10 where they differ; everything else there still holds.
Tags as in FINAL-BUSINESS: [db] measured · [site] vendor's own page · [relayed] secondary source, unchecked · [assumption] ours, needs an owner.

---------------------------------------------------------------------
## 1. The decision in one paragraph
The payer is the **placement cell**, the user is the **student the on-campus drives didn't place**. Hirelane becomes "the off-campus layer for the students your drives don't reach": honest eligibility matching, a resume an ATS can actually read, scam-safe roles, and placement outcomes the college can file. It sits beside the college's existing placement ERP (Superset and similar), not against it. The student side is free when the college pays.

---------------------------------------------------------------------
## 2. Who exactly
Two segments with different buyers. We pilot with segment A and design every student screen for segment B.

| | A. Large private universities | B. Tier-3 / affiliated colleges |
|---|---|---|
| Examples (owner's framing) | Manipal-type deemed/private universities, multi-campus groups | affiliated engineering, BCA/B.Com/BBA colleges in tier-2/3 cities |
| Size | 5k–30k students, many programmes [assumption] | 300–2,000 final-years [assumption] |
| Placement reality | top programmes place on campus; a long tail of programmes and students doesn't | on-campus placement roughly 18–50% depending on source [relayed: collegesimplified.in, placementpilot.ai] |
| Buyer | Director of placements / CRC head; budget exists | TPO, often a faculty member part-time; principal signs; tiny budget |
| Why they pay | placement % is marketing and NAAC 5.2.1 / NIRF evidence; the unplaced tail is the problem they can't staff | the same accreditation pressure, plus parents asking |
| Price shape | per-student per year or per-programme licence | flat per campus per year, or free tier + paid export |

**Why A first:** a large private university is one contract with thousands of students, a real budget, and lower-tier programmes inside it that behave like segment B. It is also a credible logo for selling to B.

**Accreditation hook [relayed, verify against the NAAC manual]:** NAAC metric 5.2.1 asks for the percentage of outgoing students placed or progressing to higher education, and colleges file a list of placed students with package per annum and offer letters as evidence (see the public 5.2.1 files from VCET, JKKN, TCE). Off-campus offers count, but colleges collect them by hand through Google Forms and WhatsApp. **A consented, verified off-campus outcome export is the clearest thing a placement cell would pay for.**

---------------------------------------------------------------------
## 3. The tier-3 student, honestly
These are the constraints every screen and the resume feature must be built for. [assumption] unless tagged; G3 (20-student phone survey) checks the first four.
1. **Phone-only, low-end Android, metered data, sometimes a shared phone.** Pages must be light; nothing important behind a desktop.
2. **WhatsApp, not email.** Email codes reach a Gmail they rarely open. Google sign-in works for most; phone OTP moves up in priority.
3. **English confidence is uneven.** Guidance copy in plain English with a Hinglish option later; resume output stays English.
4. **The resume is the weakest asset.** Typical failures:
   - made in Canva or as a phone photo → an **image-only PDF an ATS reads as blank**
   - Indian biodata habits: photo, DOB, father's name, religion, marital status, "Declaration", sometimes an **Aadhaar or PAN number**
   - an objective paragraph, hobbies, two pages, no links, projects copied from tutorials with no proof
   - DOCX made at a cyber café
5. **Hard academic filters decide eligibility before fit does:** "60% throughout 10th/12th/graduation", "no active backlogs", "2025/2026 passout only", "B.E/B.Tech CSE/IT/ECE", "no gap > 1 year". Tier-3 students hit these more often and waste applications on roles that auto-reject them.
6. **College-tier filtering.** Recruiters screen on college name (WTP risk 4). Proof beats pedigree: shared assessment scores (TCS NQT-style), certificates (NPTEL, Infosys Springboard), deployed projects, referrals.
7. **Job scams target exactly this user:** "registration fee", "training deposit", Telegram-only HR, Gmail recruiters. A campus product that is visibly scam-safe is a reason for the TPO to recommend it.
8. **Many are non-tech** (B.Com, BBA, BA): ops, sales, support, banking, accounting. Our current supply is tech-startup heavy.
9. **Some first-years are under 18.** DPDP Act 2023 s.9 requires verifiable parental consent for children; we gate sign-up at 18+ until that flow exists.

---------------------------------------------------------------------
## 4. Similar products in the campus space
Most figures come from vendor blogs or listing sites; treat them as leads to check, not facts.

| Kind | Player | What it does | Price signal | Gap Hirelane fills |
|---|---|---|---|---|
| Placement ERP + student network (**the incumbent**) | **Superset** | **TnpSuite** is the placement cell's system of record (student data and eligibility, drives, shortlists, offers, fraud detection, employer CRM). **Launchpad+** is a free student console: resume intelligence, InterviewEdge AI mock interviews, assessment bundles; open sign-up with "no college onboarding required"; one profile across campus, competitions and experienced roles. Employer side: assessments, AI interviews (AVA), resume shortlisting (TalentLens) [site, joinsuperset.com, read 2026-10-29] | 1,400+ institutions, 30M+ students, 600+ employers [site]; jobs come from "100+ hiring partners" behind one Superset assessment [site, Launchpad blog]; pricing "talk to sales"; described as out of reach for most tier-2/3 [relayed: placementpilot.ai] | Its jobs are partner employers only, and student reviews complain of too few postings [relayed: capterra]. No NAAC/NIRF outcome reporting on its site. No open-market off-campus supply, no academic-eligibility honesty on outside roles, no scam shield for roles found elsewhere |
| Placement ERP, tier-2/3 | **PlacementPilot AI** | readiness tracking for 100–2,000 candidates | from ₹2,999/month [site, via its own blog] | no supply, no student-side job loop |
| Free campus listing | **SalaryBox CampusConnect** | colleges list for free; ITI, polytechnic, blue/grey-collar roles | free for institutes [site] | different segment (vocational) |
| Fresher portal | **Naukri Campus** | fresher jobs, free resume builder, NCAT test, off-campus drives, college tie-ups | free for students; Naukri ~60M users [relayed] | noise, no eligibility honesty, no outcome export to the college |
| Competitions / hiring | **Unstop** | hackathons, quizzes, campus drives, intern hiring | paid certifications and premium filters [relayed] | competition-first, not a job loop |
| Internships + training | **Internshala** | the default internship start; sells trainings; upGrad took a majority stake Feb 2026 [relayed] | training upsell | internship-only, course-led |
| Mass job app | **apna** | job seeker app, big in grey/blue collar | free | no college pipeline [relayed] |
| Resume tools | ResumeLevelUp (₹19 per resume, aimed at first-gen and rural students) [site], ResumeOS (ATS score, ₹299/mo) [site], EarlyJobs.ai (free, placement prep) [site], Naukri's builder | resume building and "ATS scores" | ₹0–299 | no Hindi/regional support seen in any of them [relayed]; none checks Aadhaar/biodata leaks or academic eligibility |
| Placement prep (TPOs already buy these) | PrepInsta, FACE Prep, Talent Battle [assumption: names from memory, verify] | aptitude and coding training | per-batch contracts | a partner, not a competitor: our cohort gap report tells them what to teach |
| Government | NAPS / NATS apprenticeships, National Career Service [assumption, verify] | apprenticeships with stipend support | free | a possible supply source if their data is public |

**Is there no one in India? Not quite.** Superset is the Indian equivalent of Handshake (US: 1,600+ institutions, 25M users, students free, employers pay for premium from ~$10k a year [site, joinhandshake.com/about; relayed]). It already owns the placement cell's system of record at the top of the market. So:
- **Don't compete on the TPO ERP.** Import from it: a CSV import of the cohort (roll number, programme, passout year, placed yes/no) is the integration, and placed students drop out of picks.
- **Compete on the open market after the drive:** roles from thousands of employer career pages (not 100 partners), matched honestly against the student's academics, with a scam shield and an off-campus outcome export the college can file.
- **Reverse-engineer two products, the way docs/recon did for Shortlist (public pages and our own free accounts only, no data copied):** Superset (Launchpad+ student console, TnpSuite public pages) for the Indian TPO workflow and vocabulary; Handshake for the three-sided network model (students free → career centers adopt → employers pay).

**The unclaimed corner for a placement cell:** off-campus roles matched against *academic* eligibility, a resume health check that catches unreadable and unsafe resumes, a scam-safe feed, and a consented outcome export for NAAC. Nobody above does all four for the unplaced tail.

---------------------------------------------------------------------
## 5. Are we building a bigger data source? Yes. It's the biggest gap
Today [db]: 129 companies, 16,828 roles, **75 India entry/intern roles**. G0 (≥ 10 worthwhile roles a week per profile × city) fails. A campus pilot dies on this before anything else, so supply runs as its own track from day 1. Routes, all legal (CLAUDE.md legal guardrails; no Naukri, LinkedIn, Indeed or aggregator scraping):

| # | Route | What it adds | Legal posture | Track |
|---|---|---|---|---|
| S1 | **Board discovery at scale** (FINAL-BUSINESS §6.1): company lists → candidate tokens → probe public Greenhouse/Lever/Ashby | Indian startups and MNC India offices; target 1,000 → 3,000 companies | already allowed | now |
| S2 | **New public ATS connectors** where Indian mass recruiters and Indian companies post: Workday career sites, SAP SuccessFactors, Darwinbox, Keka, Zoho Recruit, Freshteam, SmartRecruiters | IT-services mass hiring, BFSI, non-tech fresher roles, the part of the market tier-3 students actually get | **each needs a dated terms check and an owner sign-off**, then an allowlist entry; CLAUDE.md currently allows only GH/Lever/Ashby | after owner sign-off |
| S3 | **Drive inbox (campus-sourced)**: the TPO pastes an off-campus drive link or notice they would otherwise forward on WhatsApp; Hirelane parses eligibility and shows it only to eligible students | the drives colleges already receive, structured | the college's own data; we store the link and parsed criteria, not the employer's page | campus slice |
| S4 | **Employer-posted roles via the college's recruiter network** (UC6 "Fresher Drop", moved earlier for campuses) | small employers with no ATS | first-party | after pilot |
| S5 | Government apprenticeship listings | non-tech, stipend roles | only if a public API or open dataset exists | research |

**Measure before promising:** every route reports worthwhile roles per week per profile × city, the G0 number. Picks always show honest counts ("2 new roles you're eligible for this week"), never padding.

---------------------------------------------------------------------
## 6. Resume: hardened first (owner priority, 2026-10-29)
Changes from the HLD M2 ("sealed PDF upload; rules-only parse; inline fixes"):

**Inputs**
- R-in-1 Text PDF (as planned).
- R-in-2 **Image-only PDF: detect first, OCR later.**
  - Phase 1, cheap, most of the value: detect a missing or near-empty text layer. Health issue #1: "an ATS can't read this file". Offer two fixes: re-export from Canva/Word as text, or use the builder (R-in-4).
  - Phase 2, a separate owner decision: local OCR. tesseract.js fetches language data from a CDN by default, so the data has to be bundled locally to keep "nothing leaves our servers". Image-only PDFs also need each page rendered to an image first (pdf.js plus node-canvas, a native dependency), so this is not light.
  - Photo uploads stay out (PDF/DOCX only) until phase 2.
- R-in-3 **DOCX** accepted (cyber-café reality), converted to text in the worker, with magic-byte and zip-bomb checks. This amends the HLD's "PDF only".
- R-in-4 **No resume → guided builder**: 6–8 short questions (education with %/CGPA, projects, internships, skills, certificates, links) produce a one-page, ATS-safe PDF. It is rendered in the worker with a light PDF library, not Playwright.

**Parse (rules, India-aware)**
- R-p-1 Sections: Education (10th, 12th/diploma, graduation; board, %, CGPA, passout year, backlogs), Projects, Internships, Certifications, Achievements, Skills, Links.
- R-p-2 Every parsed field editable on one confirm screen, with a confidence flag. Nothing feeds matching until the student confirms.

**Safety**
- R-s-1 **Sensitive-data scan**: Aadhaar (12 digits passing the Verhoeff check), PAN pattern, DOB, father's/mother's name, religion, caste, marital status, photo. Warn the student, and leave them out of anything we generate. Aadhaar/PAN found → never stored in parsed text.
- R-s-2 Upload hardening: ≤ 5 MB, ≤ 3 pages, magic bytes, PDF JavaScript and embedded files ignored, parse in a worker with time and memory caps, contents never logged, envelope encryption (packages/vault), audited download, deletion within 24 h.
- R-s-3 18+ attestation at sign-up (DPDP s.9) until a parental-consent flow exists.
- R-s-4 No LLM on resume content without the `llm_resume` consent (unchanged).

**Health check (deterministic, free, the activation hook)**
- R-h-1 Checks with a reason and a fix each: readable by an ATS (text layer), one page for freshers, contact present, no biodata/ID numbers, no "Declaration"/objective padding, bullets with numbers, project proof links, skills that appear in the text, sensible file name.
- R-h-2 No fake "ATS score out of 100". Show "6 of 9 checks pass" with the failing ones first.

**Eligibility profile (new, campus-critical)**
- R-e-1 Captured from the parse and confirmed: 10th %, 12th/diploma %, graduation % or CGPA (with the college's conversion), active backlogs, backlog history, gap years, passout year, degree, branch.
- R-e-2 `engine/eligibility.ts` (pure, TDD) parses posting criteria ("60% throughout", "no active backlogs", "2026 batch", branch lists, gap rules) and returns pass / fail / unknown per criterion with evidence. Fail = blocker in the worthwhile gate; unknown never blocks.
- R-e-2a **Data dependency:** criteria like "60% throughout" and "no active backlogs" appear mostly in mass-recruiter drive notices, not in Greenhouse/Lever/Ashby startup postings. The test corpus has to come from real drive notices (synthetic fixtures modelled on them). In production the parser earns its keep only together with S3 (drive inbox) or S2.
- R-e-3 Stored under RLS; academic numbers are needed for matching so they stay queryable, but are never shown to the TPO per student without the student's share consent.

---------------------------------------------------------------------
## 7. Campus layer (light)
- C1 **Campuses and cohorts:** `campuses`, `cohorts` (campus × passout year × programme), membership by **campus code or verified college email domain**.
- C2 **Student share levels**, chosen by the student, changeable any time: *aggregate only* (default) · *outcomes* (interview/offer status) · *full* (applications too). The TPO never sees resume contents or answers.
- C3 **TPO console (web):** cohort funnel (joined → resume healthy → eligible picks → hand-offs → replies → interviews → offers), resume-health aggregate ("41% have image-only PDFs"), eligibility-blocker aggregate ("212 students blocked by 60% cutoffs"), skill-gap aggregate. Every aggregate has k ≥ 10.
- C4 **Drive inbox** (S3).
- C5 **Outcome capture and export:** students mark interview/offer; an optional offer-letter upload (sealed); the TPO verifies; CSV export in the NAAC 5.2.1 list shape (name, programme, employer, package). Only students at the *outcomes* share level appear.
- C6 **Scam shield:** our supply comes only from employer career pages; drive-inbox and inbound replies get flagged for fee requests, Telegram/WhatsApp-only HR and free-mail recruiters; the "Hirelane never charges you to apply" card.

---------------------------------------------------------------------
## 8. Keep it light (web + API for every app)
- One service layer per feature in `packages/*`; web server actions and a versioned **`/api/v1`** both call it, so a future Android app uses the same API. OpenAPI extended from the public one.
- Server-rendered Next.js; client JS per student page ≤ 100 KB gzip; no client PDF or OCR libraries; heavy work (OCR, DOCX, PDF render) only in `workers/runner`.
- No new infrastructure for the slice: Postgres + graphile-worker + local blob store; Azure later (HLD §7).
- LLM calls in the slice: 0.

---------------------------------------------------------------------
## 9. Pricing and economics, revised [assumption]
₹300 per student per semester (FINAL-BUSINESS §5 C) is likely too high for segment B. The PlacementPilot price signal (₹2,999/month ≈ ₹36k/year flat) is the reference point.
- Segment A: ₹100–200 per final-year student per year, or a per-programme licence.
- Segment B: free cohort dashboard; paid outcome export + drive inbox at a flat ₹25k–50k per campus per year.
- Students: free under a campus; the B2C pass stays a capped experiment.
- Pilot: one segment-A university plus one segment-B college, one semester free, written success bar: ≥ 30% of the unplaced tail activated, ≥ 8% reply rate, and the TPO uses the export.

---------------------------------------------------------------------
## 10. Gates, revised
- G0 supply (unchanged, now per *programme* × city).
- G2 recruiter interviews (unchanged).
- G3 20-student phone survey: **add** "what file is your resume, and where did you make it?".
- **G4 (new):** 5 placement-cell conversations (2 segment A, 3 segment B) before building C3–C5. Ask: how do you collect off-campus offers today, what do you file for NAAC 5.2.1, what would you pay for.
- **G5 (new):** 2 letters of intent before the pilot.

## 11. Owner decisions
1. Pilot targets: which segment-A university and which segment-B college, and who makes the first contact.
2. S2: approve the terms check for Workday / SuccessFactors / Darwinbox / Keka / Zoho Recruit career sites (each still needs a dated note).
3. Price shape per segment (§9).
4. Grievance officer (still blocks real uploads; HLD gap 4).
5. 18+ gate now, parental consent later?

Sources: placementpilot.ai/blog/best-placement-management-software-india · collegesimplified.in (tier-3 placement reality 2026) · salarybox.in campus-placement blogs · capterra / saasworthy / getapp listings for Superset · deepaksood619.github.io job-platform analyses (Naukri, Unstop, Internshala) · producthunt / apps.apple.com listings for ResumeLevelUp, ResumeOS, EarlyJobs.ai · NAAC 5.2.1 public files from vcet.edu.in, engg.jkkn.ac.in, tce.edu · docs.avantifellows.org NIRF employability sources.
