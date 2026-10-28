# Hirelane campus PRD

Version 1.0, 2026-10-29. The why is in [CAMPUS-FIRST.md](CAMPUS-FIRST.md); the how is in [../design/campus-hld.md](../design/campus-hld.md); scope changes are PLAN.md Amendment B (owner-approved 2026-10-29). This PRD extends FINAL-PRD.md: the core loop (picks → fit → check → hand-off → tracker) stays, and the campus requirements below are added on top. Status per item: todo unless marked. Releases: **C1** (resume + accounts), **C2** (campus pilot), **C3** (after the pilot).

## 1. Goal
For a student the on-campus drives didn't place, Hirelane offers:
- a resume an employer's ATS can read and that leaks no ID numbers
- only the off-campus roles and drives they are actually eligible for
- a way to apply properly from a phone
- a record the college can count

For the placement cell, it turns the unplaced tail into numbers it can act on and file.

**North star (unchanged):** weekly applications the student submitted that got a human reply.
**Campus north star:** the share of a cohort's unplaced students with at least one interview within 60 days.

## 2. Personas
| Persona | Who | Needs | Constraint |
|---|---|---|---|
| **Rahul** (tier-3, core) | B.Com/BCA or tier-3 B.Tech, final year, unplaced, 58% in 12th, 1 cleared backlog | roles he's eligible for, a resume that works, no scams | phone-only, WhatsApp-first, uneven English, made his resume in Canva |
| **Sneha** (large private university) | B.Tech in a lower-placing programme at a Manipal-type university | off-campus roles beyond the campus partner list | has a laptop, but lives on her phone |
| **Mr. Kulkarni** (TPO, tier-3) | a faculty member running placements part-time | outcome numbers for NAAC without chasing Google Forms | no budget, no time, low tech tolerance |
| **Placement director** (segment A) | runs the CRC at a large private university | lift placement % across programmes; a report for management | already has Superset or a similar ERP |

## 3. Requirements

### R. Resume (C1, the first priority)
| ID | Requirement | Acceptance |
|---|---|---|
| R1 | Upload a text PDF or DOCX, ≤ 5 MB; PDFs ≤ 3 pages | magic bytes checked; a malicious file never crashes the worker |
| R2 | Detect resumes an ATS can't read (image-only, or Canva-garbled) and say so first | the image-only fixture shows "an ATS can't read this file" plus two fixes |
| R3 | India-aware parse: 10th, 12th/diploma, graduation %/CGPA, board, passout year, backlogs, projects, internships, certifications, skills, links | field accuracy ≥ 90% on the labelled synthetic set |
| R4 | ~~Sensitive-data scan as a product feature~~ **De-scoped by the owner, 2026-10-29:** employers don't ask for Aadhaar or PAN, so no screen, health-check copy or pitch mentions them. The already-built background masking (engine/resume/sensitive.ts) stays only as a silent privacy safety net, so an ID number a student typed is never stored in parsed text, unless the owner asks to remove it too | no student-facing mention; masking tests stay green |
| R5 | Health check: 9 fixed checks, "N of 9 pass", each with a fix; no fake score | every check has ≥ 3 passing and ≥ 3 failing fixtures |
| R6 | Confirm screen: every parsed field editable; nothing is used until confirmed | an edited value lands in the eligibility profile with `confirmed_at` |
| R7 | Guided builder for students with no usable resume: 6–8 questions → a one-page PDF an ATS can read | the builder output passes our own readability check |
| R8 | Up to 3 resumes, an audited download, delete, and purge within 24 h | purge test proves the 24 h bound |
| R9 | 0 LLM calls on resume content without the `llm_resume` consent | `llm_calls` count is 0 in the e2e test |
| R10 | **LinkedIn data upload** (owner, 2026-10-29): the student uploads their own "Get a copy of your data" ZIP (Profile, Education, Positions, Skills, Connections CSVs). It goes through the same zip guard as DOCX and is parsed in the worker. Education, positions and skills pre-fill the profile and eligibility, and the student confirms each field. Connections stay private to the user, for the later referral finder, and are never shared across users | the ZIP fixture pre-fills the confirm screen; the zip-bomb fixture is rejected; 0 connection rows are readable by another user |

### E. Eligibility (C1 engine, C2 in use)
| ID | Requirement | Acceptance |
|---|---|---|
| E1 | Eligibility profile from the confirmed resume, editable | 10th/12th/diploma/UG scores, backlogs, gap, passout year, degree, branch |
| E2 | Parse posting and drive criteria: "60% throughout", "no active backlogs", "2026 batch", branch lists, gap rules | criterion accuracy ≥ 90%; 0 wrong "fail" on items labelled unknown |
| E3 | Per role: pass / fail / unknown per criterion, with the posting's words | "Needs 60% in 12th, you have 58%" shown as a blocker |
| E4 | Fail blocks the role from picks; unknown never does | property test over 1,000 random profiles |
| E5 | **CGPA validation and conversion (owner priority, 2026-10-29).** (a) Validate: CGPA within its scale (4/5/10), SGPA vs CGPA told apart, CGPA consistent with the stated percentage when both are given, marks written as "412/500" converted to a percent, impossible values flagged for the student to fix. (b) Convert CGPA→% from a per-university rule table (public formulas: e.g. a university's own "percentage = (CGPA − 0.75) × 10" style rule), each row with its source URL and the date it was checked. The student picks their university once; a campus rule overrides it. (c) With no known rule, the verdict stays unknown and says which rule is missing, never a guess | rule table with ≥ 25 universities common among tier-2/3 colleges, each sourced; conversion tests per row; 0 guessed conversions |
| E6 | **Show the maths:** every eligibility line that used a conversion shows it ("8.1 CGPA = 73.5% by your university's rule, needs 60%: you qualify") | visible on drive, pick and paste-a-job verdicts |

### A. Accounts (C1)
| ID | Requirement |
|---|---|
| A1 | Google sign-in, plus a 6-digit email code that works inside Instagram/WhatsApp in-app browsers |
| A2 | 18+ attestation before any account exists (DPDP s.9); no DOB collected |
| A3 | Phone OTP: optional, after the owner picks a vendor |
| A4 | Delete account → everything purged within 24 h |
| A5 | Accounts stay off in production until a grievance officer is named |
| A6 | **Sign in with LinkedIn** (owner, 2026-10-29): official OpenID Connect (scopes `openid profile email`) next to Google. It gives name, email and photo only. No LinkedIn MCP, no session cookies, no scraping (LinkedIn User Agreement §8.2 and §2.2) |

### C. Campus (C2; C3–C5 gated on G4, the placement-cell conversations)
| ID | Requirement | Gate |
|---|---|---|
| C1 | Join a campus by code or verified college email; pick a cohort (passout year × programme) | — |
| C2 | Student share levels: aggregate (default) · outcomes · full; changeable any time; the student sees every TPO view of their data | — |
| C3 | TPO console: cohort funnel, resume-health, eligibility-blocker and skill-gap aggregates; every cell k ≥ 10 | G4 |
| C4 | Drive inbox: the TPO pastes a drive notice → criteria parsed → shown only to eligible (or unknown) students | G4 |
| C5 | Outcomes: students mark interview/offer, optional offer letter; TPO verifies; NAAC 5.2.1-shaped CSV export | G4 |
| C6 | Scam shield: flag fee requests, Telegram/WhatsApp-only HR and free-mail recruiters on drives and replies; a "Hirelane never charges you" card | — |
| C7 | Cohort CSV import (from Superset or any ERP export): verify members and drop placed students from picks | G4 |

### S. Supply (runs in parallel with everything)
| ID | Requirement | Gate |
|---|---|---|
| S1 | Board discovery on Greenhouse/Lever/Ashby: 1,000 → 3,000 companies | — |
| S2 | New public ATS connectors: Workday, SuccessFactors, Darwinbox, Keka, Zoho Recruit; each after a dated terms note | **owner approved the terms check, 2026-10-29**; each connector still needs its note |
| S3 | Drive inbox (= C4) as a supply source | G4 |
| S4 | Honest counts: "2 new roles you're eligible for this week", never padded | — |
| S5 | **Paste a job** (owner, 2026-10-29: build right after Slices 1–2): the student pastes the text of any job (Naukri, LinkedIn, a WhatsApp forward); we parse it, score fit and eligibility, scam-flag it, and add it to the tracker with "apply at source". **We never fetch the link** | — |
| S5a | **Share a job into Hirelane** (owner, 2026-10-29): a PWA `share_target` in the web manifest, so "Share → Hirelane" from the LinkedIn, Naukri or WhatsApp app on Android opens Paste a job with the text and link filled in. We still never fetch the link | — |
| S6 | **Drive inbox moved earlier** (owner, 2026-10-29): build the TPO paste and parse right after Slices 1–2, reusing S5's parser; the full TPO console still waits for G4 | — |
| S7 | **Remote-for-India filter** (owner, 2026-10-29): show non-India jobs only when they are remote and open to India; everything else is hidden by default | — |
| S8 | Licensed feeds (Adzuna, Careerjet, Jooble): only with a written licence that allows showing our score; see docs/recon/job-feeds-2026-10-29.md | owner + licence |
| S9 | **Never:** scraping Naukri, LinkedIn, Superset or other job boards, or getting around their bot blocks (their terms forbid it; IT Act s.43 risk) | — |

### P. Platform
| ID | Requirement |
|---|---|
| P1 | Every user feature is both a web screen and a `/api/v1` endpoint (OpenAPI), so an Android app can come later |
| P2 | Student pages ≤ 100 KB JS each, server-rendered, usable on a low-end Android over 4G |
| P3 | No new infrastructure: Postgres, the worker, local blob store; Azure later |

## 4. Screens
| Screen | Who | Release |
|---|---|---|
| Sign in · Welcome (18+, terms) | student | C1 |
| Resume: upload → "reading…" → health → confirm | student | C1 |
| Resume builder (one question per page) | student | C1 |
| You: eligibility profile, resumes, share level, delete | student | C1 / C2 |
| Join campus | student | C2 |
| Drives (eligible only) | student | C2 |
| Outcome: "I got an interview / offer" | student | C2 |
| TPO: cohorts, funnel, aggregates, drive inbox, outcomes, export | TPO | C2 (G4) |
| Existing core-loop screens (picks, check, hand-off, tracker) | student | per FINAL-PRD |

## 5. Non-goals
- A placement ERP or on-campus drive management (Superset's ground; we import from it).
- Hirelane submitting applications or messaging employers.
- Per-student marks, resumes or answers visible to a TPO.
- OCR, photo uploads and LLM resume parsing in C1.
- Scraping Naukri, LinkedIn, Indeed, Superset or any aggregator.

## 6. Metrics
- **Student:**
  - activation: resume confirmed
  - health checks passed before and after
  - share of picks eligible
  - hand-offs
  - replies
  - interviews
- **Campus:**
  - joined / cohort size
  - share of resumes readable by an ATS
  - share of students blocked by each cutoff
  - interviews and offers per 100 unplaced students
  - exports used
- **Guardrails:**
  - 0 ID numbers stored or shown
  - 0 cross-user reads
  - 0 aggregate cells under k
  - 0 sends by Hirelane

## 7. Releases
- **C1:** R1–R9, E1–E5 (engine), A1–A5, P1–P3, S1, S4, then S5 (paste a job), S6 (drive inbox paste) and S7. Built as Slices 1–3 in [../design/campus-build-plan.md](../design/campus-build-plan.md).
- **C2 (pilot):** C1, C2, C6, then C3–C5 and C7 after G4, plus the core loop M3–M7 and S2 connectors that pass their terms note.
- **C3:** Android app on `/api/v1`; OCR; Hindi copy; employer roles via the college's recruiter network.
- **Later (laptops):** a browser extension that scores the job page the student is already viewing on any site. The student's own browser reads the page; our servers don't. Android has no extensions, so this is a laptop-only extra.

## 8. Open decisions
1. Pilot campuses (one segment A, one segment B) and who makes first contact.
2. Grievance officer (blocks real accounts).
3. Phone OTP vendor and timing.
4. Order after C1: the core loop first, or campus first. Recommended: core loop first, with C1/C2/C6 alongside.
5. Do drives enter the application tracker? They are private to a campus; jobs are public.
6. TPO per-student shortlists ("who is eligible for this drive"). That would need a new consent level; deferred.
7. Prices per segment (CAMPUS-FIRST §9; all assumptions).
