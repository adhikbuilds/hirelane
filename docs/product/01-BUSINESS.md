# Business case

Written 2026-10-19. Builds on 00-PLATFORMS.md and PLAN.md. Owner direction (2026-10-19): the core business, the thing that earns and does good, is the Hirelane loop (fresher picks → fit → fill → you submit → tracker). Warm intros (Amendment A) are a supporting differentiator and a Plus feature, not the main product.
Tags: [verified] = checked · [relayed] = a competitor's claim · [assumption] = ours, needs an owner.

## 1. One line
Hirelane is the job app for India's freshers. Each day it picks a few real, fresher-friendly roles straight from company career pages and shows exactly why each one fits. It fills the application, and the student presses submit. Where they know someone at the company, it also helps them ask for a referral.

Taglines to test:
- "Swipe. We fill it. You send it."
- "Your first job, minus the forms."
- "Fewer applications. Better ones. All yours."

## 2. Business use cases (who, the job to be done, and why they'd pay)

### UC1: Off-campus hunt for a final-year or recent grad (THE core business, B2C)
- **Who:** final-year students and 0–1 year grads, mostly tier-2/3 colleges, with no campus offer or a weak one.
- **Job to be done:** "Find roles I can actually get, apply properly, and not waste 3 hours a day."
- **Today:** Naukri, LinkedIn and Internshala scrolling; the same form typed again and again; 100+ blind applications; silence.
- **Hirelane:**
  1. 5 fresher-friendly picks a day
  2. ✓/✕ fit
  3. the form filled
  4. they submit
  5. a tracker
- **Why they pay (30-day or season pass):** time saved, and better applications during the 6–10 week burst before and after graduation.

### UC2: Referral finder (supporting differentiator, Plus feature)
- **Who:** the same student, plus 1–3 year switchers.
- **Job to be done:** "Who do I know at this company, and how do I ask without being weird?"
- **Today:** guessing on LinkedIn and cold DMs to strangers.
- **Hirelane:**
  - imports your own contacts (LinkedIn Connections.csv export, phone vCard, manual add)
  - "You know 2 people here" on the card, with warmth explained (same college and batch, worked together…)
  - drafts the referral ask; you send it yourself
- **Why it matters:** it raises reply rates on the core loop and is a reason to upgrade. A referral is often the highest-converting path to a fresher job [assumption, needs a source]. It is not the main product.

### UC3: Internship season (B2C, seasonal spike)
- **Who:** 2nd and 3rd year students hunting summer or winter internships.
- **Job to be done:** "Get one good internship before the semester ends."
- **Hirelane:** an internship filter, closing dates, and the same fill-and-hand-off.
- **Value:** gets students in early; they return as finalists (lifetime value).

### UC4: Close the gap (B2C, retention between bursts)
- **Who:** anyone with 1–2 missing skills against the roles they want.
- **Job to be done:** "Tell me exactly what to learn to qualify."
- **Hirelane:** aggregated ✕s across swiped jobs, e.g. "Docker is missing in 14 of your 30 picks". One 2-hour project each, which flips matches when added to the resume.
- **Value:** keeps users active between job bursts. Optional partner courses later (an Internshala-style revenue line, without the course-selling feel).

### UC5: Placement cell off-campus pipeline (B2B2C)
- **Who:** placement officers at tier-2/3 colleges, measured on placement percentage.
- **Job to be done:** "Place the 40–60% the campus drives don't." [assumption]
- **Hirelane:**
  - a campus code
  - a cohort dashboard: applications, replies, offers
  - alumni-at-company insight from the college's own alumni list, with consent
- **Why they pay:** ₹300–600 per student per year [assumption]. Placement stats sell admissions.

### UC6: Fresher hiring for startups (later, B2B employer side)
- **Who:** founders and hiring managers at startups (the Tal Boss / Hirect buyer).
- **Job to be done:** "Find good freshers without agencies or 2,000 junk applications."
- **Hirelane:** a "Fresher Drop" featured slot in picks, applicants with explained fit (not keyword spam), and optional direct chat.
- **Why they pay:** per-role or monthly. This only works once we have a supply of engaged freshers.

### UC7: Job data for agents and tools (API, later)
- **Who:** career-ops and ai-job-search users, other AI career tools, and college portals.
- **Job to be done:** "A clean, fresh, India-aware jobs feed with honest pay and requirements."
- **Hirelane:** the public JSON API, llms.txt and markdown pages (all exist), plus an MCP server later.
- **Value:** free tier for distribution; a paid tier for higher limits and webhooks.

## 3. USP (why us, in one breath)
"Real fresher jobs, why you fit, the form filled. You stay the sender. Plus: who you know there."
1. **You send it:**
   - no bot submissions, no ATS detection risk
   - nothing goes out in your name unread
   - competitors (Tsenta, JobCopilot, Shortlist autopilot) sell the opposite
2. **Fit you can learn from:** ✓/✕ per requirement, quoting the posting; ✕ turns into a close-the-gap plan.
3. **Honest data:** straight from company career pages, "read 2h ago", pay only when stated, closed roles vanish.
4. **Built for Gen-Z freshers:** mobile swipe, 5 picks a day, company stories, a weekly Wrapped recap to share, streaks without shame.
5. **India-priced:** UPI, 30-day and season passes, campus codes.
6. **Warm path (Plus):** your own contacts, warmth shown as an equation, and the referral ask drafted. No scraping, no cross-user aggregates.

## 4. Revenue
Sold as passes, not subscriptions. A job search is a 60–90 day window: students who get a job stop paying, and so do students who give up. Economics are judged per cohort, not as recurring revenue.
| Line | Use case | Price [assumption] | When |
|---|---|---|---|
| Free | UC1, UC3 | 3 hand-offs a week (not 10 a month), unlimited browse and tracker | R1 |
| 30-day pass | UC1–UC4 | ₹249, no auto-renew by default | R1 pilot |
| Season pass (90 days) | UC1–UC4 | ₹499: one placement or off-campus season | R1 pilot |
| Campus | UC5 | ₹300 per student per semester, paid by the college | pilot: free; paid from R2 |
| Employer | UC6 | per-role "Fresher Drop" | R3+ |
| API | UC7 | paid tier | R3+ |

What the pass buys:
- unlimited hand-offs (the main reason)
- resume versions
- gap plans
- WhatsApp picks
- the referral finder

**Conversion trigger (designed, not a passive expiry):** the paywall appears on the check screen of the 4th hand-off in a week, on a high-match role ("This one's 82 · Season pass ₹499 till 31 Jan"). A second trigger is the first employer reply.

### 4.1 Unit economics per activated student, per cohort window [all assumptions, owner needed]
"Activated" = resume added plus a first swipe. Variable cost = LLM + infra + payment fee. CAC excluded until the last column.
| Scenario | Inputs | Revenue | Variable cost | Contribution before CAC | Break-even |
|---|---|---|---|---|---|
| A. As first drafted (B2C only) | free 10/mo; LLM ₹2/hand-off, ~8 used; 5% buy ₹249; infra ₹3 | ₹12.45 | ~₹19.5 | **−₹7** | needs ~24% conversion at CAC ₹40. Not viable |
| B. Lean B2C | deterministic fill, LLM only for free-text answers ≈ ₹0.3/hand-off, ~10 used; free 3/week; 8% buy, blended ₹350 (30-day + season) | ₹28 | ~₹6.6 | **≈ ₹21** | needs CAC < ₹21 (organic, ambassadors, recap shares) or ~13% conversion at CAC ₹40. Marginal |
| C. Campus-paid + B2C upsell | college pays ₹300/student/semester; 50% of enrolled activate; 5% also buy a pass | ≈ ₹617 | ~₹10 | **≈ ₹600** | campus sales cost ~₹1.5L per deal over ~500 activated ≈ ₹300 CAC. Viable |

**Finding:** B2C alone is a learning exercise, not yet a business. The viable path is campus-paid (C), with B2C passes as upsell and as proof of value to colleges.
- B2C runs inside a fixed cash ceiling, ₹____ (owner to set) [decision].
- The cost lever is engineering, not hope. The engine is already deterministic (no LLM for matching or pay). Form fill maps profile fields deterministically. The LLM only drafts free-text answers, and those are cached per question.

### 4.2 Paid value versus "a free LLM can do this"
A free chatbot can explain fit in 5–10 minutes. It cannot:
1. find fresh, fresher-eligible roles from career pages
2. fill the employer's form
3. track and thread replies

The pass must win on 1 and 2.
- **Pilot measure:** minutes per application with and without Hirelane. Target: ~25 min down to ≤ 8 min [assumption].
- **Pilot measure:** applications per week a student would otherwise have skipped.
- If neither moves, the paid-value claim fails.

## 5. Go-to-market
1. **Two pilot campuses** (Bengaluru/Pune tier-2), free for a semester in exchange for outcome data. Placement cell plus 10 ambassadors per campus.
2. **First-run hook:** "Add your resume and see your 5 picks for today, with why you fit". The first-run moment is the fit reveal on real roles. Contact import is offered after the first hand-off.
3. **Share loop:** the weekly recap card on Instagram and WhatsApp status, with a referral link.
4. **SEO/AEO:** "fresher jobs Bengaluru with stated pay", "remote internships India", built from the live board; llms.txt for AI answers.
5. **WhatsApp:** daily 9 am picks (opt-in).
6. **Creators:** placement-prep YouTubers and LinkedIn creators, with campus codes.

## 6. What must be true, and the risks
1. **India fresher supply.** 75 open entry/intern roles in India and 161 remote out of 16.8k [verified, local DB 2026-10-17]. Amendment A already orders adding Indian companies' public ATS boards.
   - Target: ≥ 1,500 India entry-level roles before closed beta.
   - Without this, every use case fails.
2. **Core-loop conversion.** Picks → check → hand-off → "did you submit". If freshers don't finish on the employer's site, the loop fails.
   - Measure every step from day 1.
   - Contact import (UC2) is secondary; test its adoption in R2.
3. **Data quality:**
   - skill tags are wrong (an "Associate Legal" role is tagged cybersecurity)
   - `salary_stated` is true with no amount on Rubrik and GitLab rows [verified]
   - fresher detection doesn't exist yet
4. **Truth in marketing.** The audit's P1 was the site claiming unbuilt features. The fix is on branch `fix/audit-p1`; the footer and mobile menu still say "You approve every application".
5. **Law:**
   - DPDP Act 2023: consent, purpose limits, deletion, a grievance officer.
   - Contacts are third-party personal data: use them only for the user's own drafts, never aggregate them.
6. **Competition.**
   - Threats: Shortlist going fresher/campus, Tsenta going India, Naukri/Internshala adding AI autofill.
   - Moat: fresher-specific data and matching, campus relationships, the "you send it" trust brand, and the per-user warm-path graph.
7. **Seasonality.** Job search comes in bursts. UC3 (internships), UC4 (gap plans) and campus cycles carry users between bursts.

8. **Employers filter by college tier.** Junior IT hiring in India often screens on college tier regardless of posted requirements. A correct eligibility match may still get near-zero interviews for tier-3 students.
   - Before the pilot, interview 3–5 junior-hiring recruiters.
   - In the pilot, report outcomes by college tier.
   - Referral asks (UC2) are the main counter, which is why they stay in Plus.
9. **Mobile hand-off.** Freshers are often phone-first. Completing a Greenhouse, Lever or Ashby form on a phone (resume upload, copy-paste answers) may be the real drop-off.
   - Before the pilot, survey 20 target students: phone-only share, and whether they can finish one real form on a phone.

## 6.1 Pilot: gates before recruiting, and stop rules written now
**Definition: a worthwhile role** (used by every gate and metric). For a given student, a role is worthwhile only if all of these hold:
1. It is open and was read within the last 7 days.
2. It is fresher-eligible: level intern or entry, or the posting asks for 0–2 years or says "fresher" or "new grad".
3. It matches the student's role family and location rule (their city or remote-India).
4. The student meets ≥ 60% of the must-haves, with resume evidence.
5. They haven't already applied to it or skipped it.
6. It has no blocker the student has flagged (bond, relocation abroad, night shift).

**Gates that must pass before a single student is recruited:**
- **G0 Supply.** For each pilot profile ({SDE, data, ops/sales/support, finance} × {Bengaluru, Pune, remote-India}), count new worthwhile roles a week for a sample resume. Need ≥ 10 a week per profile; otherwise drop that profile or add sources first. Today's 75 India entry/intern roles fail this.
- **G1 Economics.** The owner picks scenario B or C and sets the B2C cash ceiling.
- **G2 Recruiters.** 3–5 junior-hiring recruiter interviews done, notes on tier filtering.
- **G3 Device.** 20-student survey done. If more than 30% are phone-only and can't finish a form on a phone, fix hand-off before the pilot.

**Pilot:** 2 campuses, 50 students, 4 weeks; free for the first week, then full price.

**Stop rules (fixed now, before results):**
- **Full-price buyers out of 50:**
  - ≥ 5 → continue to R2.
  - 3–4 → change one thing (price or trigger) and rerun once with a new 50.
  - ≤ 2 → stop B2C pricing and go campus-paid only (scenario C), or stop.
- **Worthwhile picks:** if fewer than 80% of the picks shown are worthwhile in any week, pause new sign-ups until supply recovers.
- **Time saved:** if the median time per application doesn't fall by ≥ 50%, stop paid launch and fix the fill.
- **Outcomes:** if tier-3 interview rate ≈ 0 while tier-1/2 are above 0, narrow the ideal customer or lead with referrals. Don't scale.

## 7. Metrics
- **North star:** weekly hand-offs (applications the user submitted) that got a human reply.
- **Activation:** resume added plus the first swipe.
- **Funnel targets:**
  - visit → activated ≥ 35%
  - activated → first hand-off ≥ 60%
  - D7 ≥ 30%
  - reply rate ≥ 8% (track separately when a referral ask was sent)
  - pass conversion ≥ 8% (scenario B)
- **Guardrails:**
  - 0 submissions or messages sent by Hirelane
  - 0 Needs-you fields auto-filled
  - 0 cross-user contact exposure

## 8. Milestones
- **R0 (now):** board-only limited beta, waitlist, honest copy, legal pages, CI. Run gates G0–G3.
- **R1 (6 weeks):** accounts, resume, picks, swipe, fill, hand-off, tracker for 2 campuses. India supply ≥ 1,500.
- **R2 (12 weeks):** Plus payments (UPI), recap share, WhatsApp picks, close-the-gap, contact import plus referral drafts (Plus), 10 campuses, 5k activated.
- **R3 (6 months):** campus dashboard (paid), employer Fresher Drop pilot, paid API/MCP.

## 9. Decisions needed from the owner
1. Pass prices: 30-day ₹249 and season ₹499? (₹79/week dropped: passes match the search window.)
2. Campus-first or direct-to-student first? (Recommendation: campus first. It solves supply of users and alumni data together.)
3. Keep "you send it" forever, even though CLAUDE.md allows flagged headless submission later? (Recommendation: yes for freshers.)
4. Is the Iris/Kaam repo a partner, a teammate's code to reuse, or just a reference?
5. A privacy contact and a grievance officer name for the waitlist and privacy page (needed before collecting more data).
