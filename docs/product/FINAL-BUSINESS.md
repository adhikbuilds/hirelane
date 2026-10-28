# Hirelane: final business document

Version 1.0, 2026-10-21. Supersedes 00-PLATFORMS, 01-BUSINESS and the external model review. Those stay as the working source.
Tags: [db] = measured on our local board · [site] = a vendor's own page · [relayed] = a vendor's claim, unchecked · [assumption] = ours, needs an owner.

---------------------------------------------------------------------
## 1. What Hirelane is
The job app for India's freshers.
- Every day it picks a few real, fresher-friendly roles read straight from company career pages.
- It shows exactly why each one fits (✓ / ✕ per requirement, quoting the posting).
- It fills the application. The student presses submit on the employer's own site.
- Every application lands in a tracker that also catches replies.
- Plus features:
  - a background agent that keeps looking while you sleep
  - a referral finder from your own contacts
  - founder outreach drafts for startups that aren't posting yet

The core loop is the business: picks → fit → fill → you submit → tracker.
Taglines: "Swipe. We fill it. You send it." · "Your first job, minus the forms."

---------------------------------------------------------------------
## 2. The market, by kind of player
| Kind | Players | What they solve | What they miss for an Indian fresher |
|---|---|---|---|
| Volume auto-appliers | Tsenta (YC; 50k+ career pages, 30+ ATS, $19–99/mo for 600–4,500 applications) [site]; JobCopilot (500k pages, 50/day) [site]; Shortlist autopilot (₹79/wk) [site]; LazyApply, LoopCV, Sonara | typing | they submit in your name, US/experienced focus, spam, bot-detection risk |
| Background / outreach agents | Backdoor (chat onboarding, finds startups, drafts founder outreach over text) [search]; Hunter (introductions to hiring managers) [search]; Hirevate (career pages and public ATS, not auto-apply) [search] | hidden jobs, founder access | US-centric, thin on fresher eligibility, no form help |
| Copilots / autofill | Jobright (~$40/mo Turbo) [review]; Simplify [site] | desktop form fill, match breakdown | US data, desktop extension |
| India mass boards | Naukri, LinkedIn, apna (5 cr seekers) [site], Internshala (28 lakh placements, sells courses) [site], Unstop (competitions) | listings and habit | noise, no fit explanation, no form help, dated UX |
| India direct hire | Instahyre, Cutshort, Hirect, Tal Boss (3,000 bosses) [site] | skipping agencies | built for experienced techies |
| Open-source DIY | career-ops, ai-job-search, Iris/Kaam [readme] | quality over volume ("never submits") | developers only |

**The unclaimed corner:** honest fit, form fill with the user submitting, and fresher-eligible India supply, in a Gen-Z mobile app at a student price. Nobody does all four.

---------------------------------------------------------------------
## 3. Use cases
- **UC1 Off-campus hunt (core, B2C).** Final-year students and 0–1 year grads, mostly tier-2/3. "Find roles I can actually get, apply properly, stop losing 3 hours a day."
- **UC2 Referral finder (Plus).** "Who do I know there, and how do I ask?" Uses your own contacts only.
- **UC3 Internship season.** 2nd and 3rd years. Brings students in early.
- **UC4 Close the gap.** "Docker is missing in 14 of your 30 picks", plus one 2-hour project. Retention between bursts.
- **UC5 Placement cells (B2B2C).** Campus code plus a cohort dashboard. The college pays.
- **UC6 Startup fresher hiring (later).** "Fresher Drop" slot; applicants with explained fit.
- **UC7 Jobs API/MCP (later).** A clean India-aware feed for AI career tools.
- **UC8 Hidden-job outreach (Plus, "backdoor" style).** For startups with no open role yet (recently funded, growing team pages), the agent drafts a short founder note citing the student's proof. The student sends it.

---------------------------------------------------------------------
## 4. USP
1. **You send it.** No bot submissions, nothing goes out unread, no ATS detection risk. Tsenta, JobCopilot and Shortlist's autopilot sell the opposite.
2. **Fit you can learn from.** ✓/✕ with the posting's words; ✕ becomes a gap plan.
3. **Honest data.** Read from company career pages, "read 2h ago", pay only when stated, closed roles vanish.
4. **Fresher-first.** A fresher-eligible filter, internships, campus codes, India pay in LPA.
5. **Gen-Z native.** Mobile swipe, 5 picks a day, company stories, a weekly Wrapped recap, no-shame streaks.
6. **Plus layer.** A background agent, a referral finder, founder outreach drafts.

---------------------------------------------------------------------
## 5. Revenue and economics
Passes, not subscriptions. A job search is a 60–90 day window, so economics are judged per cohort.
| Line | Price [assumption] | When |
|---|---|---|
| Free | 3 hand-offs a week, unlimited browse and tracker | R1 |
| 30-day pass | ₹249, no auto-renew | R1 pilot |
| Season pass | ₹499 for 90 days | R1 pilot |
| Campus | ₹300 per student per semester, college-paid | R2 |
| Employer | per-role Fresher Drop | R3+ |
| API | paid tier | R3+ |

**Paywall trigger:** the check screen of the 4th hand-off in a week, on a high-match role, and again after the first employer reply.

**Per activated student, per cohort window [assumption]:**
| Scenario | Inputs | Contribution before CAC | Verdict |
|---|---|---|---|
| A. B2C as first drafted | LLM ₹2 per hand-off, free 10/month, 5% buy ₹249 | −₹7 | not viable; needs ~24% conversion |
| B. Lean B2C | deterministic fill, ~₹0.3 per hand-off, free 3/week, 8% buy, ~₹350 average | +₹21 | marginal; needs CAC < ₹21 |
| C. Campus-paid + upsell | ₹300/student/semester, 50% activate, 5% buy a pass | about +₹600 (sales cost ~₹300) | viable |

**Conclusion:** the business is campus-paid with B2C upsell. B2C alone runs as a capped experiment (owner sets a ₹ ceiling).

**Paid value versus a free chatbot:** a chatbot can explain fit. It can't find fresh, eligible roles, fill employer forms, or track replies. The pilot must show ≥ 50% less time per application.

---------------------------------------------------------------------
## 6. Supply: how we get to Tsenta-scale coverage legally
- **Today [db]:**
  - 129 companies, 16,828 open roles
  - only 75 entry/intern roles in India and 161 remote
- **Others [relayed]:** Tsenta 50k+ career pages (~8 lakh jobs, per the owner), JobCopilot 500k pages, Shortlist 15–27k jobs.

**We do not scrape Tsenta or any aggregator.**
- It's their compiled database and against their terms.
- CLAUDE.md allows only public ATS board APIs.
- It would poison the "honest data" USP.

Their coverage comes from the same public career pages we can read, so we reach it by discovery:
1. **Board discovery pipeline.** Take company lists (YC directory, Indian funded-startup lists, NASSCOM/StartupIndia public lists, Fortune/Forbes India lists, our own users' "add a company"). Derive candidate board tokens. Probe the public endpoints:
   - `boards-api.greenhouse.io/v1/boards/{t}/jobs`
   - `api.lever.co/v0/postings/{t}`
   - `api.ashbyhq.com/posting-api/job-board/{t}`

   Store the hits in `company_boards` with `verified_at`.
2. **More public ATS APIs,** each verified for public access and terms before use: SmartRecruiters, Workable, Recruitee, Teamtailor, Personio, BambooHR. India: Darwinbox, Keka, Zoho Recruit and Freshteam career pages (check each one).
3. **Common Crawl URL index** (a public dataset) to find career-page URLs on those ATS domains at scale.
4. **Employer-posted roles** (UC6) later, for startups with no ATS.

**Targets:**
- R1: 3,000 companies with India presence; ≥ 1,500 worthwhile India entry roles at any time.
- R2: 10,000 companies.

---------------------------------------------------------------------
## 7. Knowledge graph (what it is for)
**Stored in Postgres as tables and edges, not a separate graph DB at first.**
- **Nodes:** student, resume skill, skill, role family, job, company, city, college, contact (private to its user).
- **Edges:**
  - job requires skill (must or nice)
  - skill is adjacent to skill
  - job is in a city
  - company has a job
  - contact works at a company (private)
  - student is from a college
  - outcome: our own users' anonymised, aggregated replies by company × college tier, with consent and a minimum count
- **What it powers:**
  - better fit: adjacent skills count as partial ✓
  - fresher eligibility
  - close-the-gap (the skill that unlocks the most jobs)
  - company momentum
  - the referral finder
  - "companies that reply to freshers from colleges like yours" (only once we have our own aggregated data)
- **Sources:**
  - ESCO / O*NET skill taxonomies (open) to clean the noisy skill tags
  - our ingest
  - user-provided contacts (never cross-user)

---------------------------------------------------------------------
## 8. Speed: making the board and picks fast
**Measured [db, 2026-10-21]:**
- `jobs` is 547 MB for 16.8k rows (~14 KB a row: 7.5 KB description, 5.7 KB traces).
- Embeddings are not populated.
- A fresher-India filter takes 211 ms plus 14 ms planning.
- Every board request recomputes the total and 6 facet counts.
- Pagination uses OFFSET.
- pg_stat_statements is off.

**Plan:**
1. **Hot card table.** A narrow `job_cards` table with only what a card shows, plus a `tags text[]` column, e.g.:
   - `role:sde`
   - `level:entry`
   - `city:blr`
   - `remote:in`
   - `pay:stated`
   - `fresher:yes`
   - `company:rubrik`

   GIN index on tags. Descriptions and traces stay in the cold `jobs` table.
2. **Top-100 cache per tag.** After each ingest/enrich run:
   - precompute the top 100 cards for every tag and for common pairs (role×city, role×level)
   - store them in a `tag_top` table and a Redis/Valkey key `tag:{tag}`
   - invalidate on the next finalize

   The board's first page, story counts and pick candidate pools read from the cache in single-digit milliseconds [assumption, to measure].
3. **Facets from the materialized view** (`job_facets`, refreshed at finalize), not per request.
4. **Keyset pagination** instead of OFFSET.
5. **Picks precomputed per user** after each enrich (match:user-delta), so opening the app reads 5 rows.
6. **Queue hygiene:**
   - batch enrich per board, not per posting
   - job_key dedupe
   - a separate low-concurrency queue for LLM tasks
   - turn on pg_stat_statements
   - statement timeouts
7. **Search engine option:** Meilisearch (MIT) or Typesense for typo-tolerant instant search with facets, fed from `job_cards`. Pick one after the cache lands and only if Postgres can't hold the target.
- **Targets:** board first page p95 < 150 ms server, picks p95 < 100 ms, search-as-you-type p95 < 50 ms.

---------------------------------------------------------------------
## 9. Open-source tools worth using [verify each licence before adopting]
| Need | Tool | Note |
|---|---|---|
| Cache | Valkey or Redis | per-tag top-100, rate limits |
| Instant search | Meilisearch (MIT), Typesense (GPL-3) | facets, typo tolerance |
| Graph in Postgres | plain edge tables + recursive CTEs; Apache AGE if needed | one database |
| Vectors | pgvector (in use) + a small local embedding model (fastembed / transformers.js) | no per-call cost |
| Skills taxonomy | ESCO, O*NET | fixes noisy skill tags |
| PDF text | unpdf / pdf.js | resume parsing without an LLM |
| Queue | graphile-worker (in use) | keep it |
| Product analytics | PostHog (self-host) or Umami | funnel and gates |
| Feature flags | Unleash | already known to the team |
| Observability | OpenTelemetry + Grafana | latency SLOs |
| Agent runtime | Claude Agent SDK | background agent, cost-capped |
| Reference repos | career-ops (scoring rubric, story bank), ai-job-search (drafter-reviewer), Iris/Kaam (resume tailoring) | ideas, check licences |
| Not allowed | JobSpy and similar LinkedIn/Indeed scrapers; unofficial WhatsApp libraries | terms and legal risk |

---------------------------------------------------------------------
## 10. Go-to-market
1. Two pilot campuses (Bengaluru/Pune tier-2) with 10 ambassadors each; free for one week, then full price.
2. **First-run hook:** "Add your resume, see your 5 picks and why you fit."
3. Weekly recap shared to Instagram/WhatsApp status, with a referral link.
4. SEO pages ("fresher jobs Bengaluru with stated pay"), llms.txt.
5. WhatsApp 9 am picks through the official Cloud API.
6. Placement-prep creators with campus codes.

---------------------------------------------------------------------
## 11. Pilot gates and stop rules (written before any result)
**Worthwhile role:**
1. open and read within 7 days
2. fresher-eligible
3. role and city match
4. meets ≥ 60% of must-haves with evidence
5. not already seen or applied
6. no flagged blocker

**Gates before recruiting:**
- G0 supply: ≥ 10 new worthwhile roles a week per pilot profile × city. Fails today.
- G1 economics: scenario B or C chosen, B2C cash ceiling set.
- G2: 3–5 junior-hiring recruiter interviews on college-tier filtering.
- G3: 20-student device survey (phone-only share; can they finish a real form on a phone?).

**Pilot:** 2 campuses, 50 students, 4 weeks.

**Stop rules:**
- Full-price buyers: ≥ 5 continue; 3–4 change one thing and rerun once; ≤ 2 stop B2C and go campus-only, or stop.
- Fewer than 80% of picks worthwhile → pause sign-ups.
- Time per application doesn't fall ≥ 50% → fix the fill before paid launch.
- Tier-3 interviews ≈ 0 while tier-1/2 are above 0 → narrow the ideal customer, lead with referrals.

---------------------------------------------------------------------
## 12. Metrics
- **North star:** weekly applications the user submitted that got a human reply.
- **Funnel:**
  - activation (resume + first swipe) ≥ 35% of visits
  - first hand-off ≥ 60% of activated
  - D7 ≥ 30%
  - reply rate ≥ 8%
  - pass conversion ≥ 8%
- **Guardrails:**
  - 0 sends by Hirelane
  - 0 Needs-you auto-filled
  - 0 cross-user contact exposure
  - LLM ≤ ₹0.3 per hand-off

---------------------------------------------------------------------
## 13. Where we are lacking (honest, 2026-10-21)
1. **Supply:** 129 companies and 75 India fresher roles, against Tsenta-scale tens of thousands of pages. This is the biggest gap.
2. **Core loop not built:** no accounts, resume, matching, fill, hand-off or tracker. The audit verdict was "limited beta, board only".
3. **Data quality:**
   - wrong skill tags (an "Associate Legal" role is tagged cybersecurity)
   - `salary_stated` true with no amount (Rubrik, GitLab)
   - no fresher flag
   - embeddings empty
4. **Speed:** wide rows, per-request facet counts, OFFSET pages, no cache, no query stats.
5. **Ops:**
   - no CI, Dockerfile or deploy target
   - typecheck and e2e red from environment drift
   - verify scripts that only echo "not implemented"
6. **Trust:**
   - the waitlist and honest-copy fix sits unmerged on `fix/audit-p1`
   - the footer and mobile menu still say "You approve every application"
   - no privacy page or grievance contact
7. **UI:** the Gen-Z Wrapped design exists only in mocks. The live site is the rejected dark-green look.
8. **Distribution:** no campus partner, SEO traffic, WhatsApp channel or analytics yet.
9. **Economics:** unproven; scenario C depends on selling campuses.
10. **Process:** two agents (Claude and Codex) editing the same mocks; ECC agents not always loaded.

---------------------------------------------------------------------
## 14. Roadmap
- **R0 (2 weeks):**
  - merge the P1 fix plus privacy page
  - CI
  - `job_cards` + tag cache + keyset pages
  - fix skill tags and `salary_stated`
  - fresher flag
  - board discovery v1 (target 1,000 companies)
  - run gates G0–G3
- **R1 (6 weeks):**
  - accounts (phone OTP/Google)
  - resume parse
  - picks
  - swipe
  - fill
  - hand-off
  - tracker
  - Wrapped UI in code
  - 3,000 companies
  - 2-campus pilot
- **R2 (12 weeks):**
  - passes (UPI)
  - recap share
  - WhatsApp picks
  - gap plans
  - referral finder
  - background agent
  - founder outreach drafts
  - 10 campuses
  - campus dashboard (paid)
- **R3 (6 months):** employer Fresher Drop, paid API/MCP, outcome graph.

## 15. Decisions for the owner
1. Scenario B or C, and the B2C cash ceiling.
2. Pass prices: ₹249 for 30 days and ₹499 for a season?
3. Campus-first? (Recommended.)
4. Keep "you send it" permanently? (Recommended.)
5. Privacy contact and grievance officer.
6. Who runs the recruiter interviews and the student survey.
7. Search engine: stay on Postgres plus cache, or add Meilisearch.

Sources: tsenta.com, shortlistapp.co, jobcopilot.com, jobright.ai (reviews: resumehog.com, careery.pro), simplify.jobs, internshala.com, apna.co, unstop.com, cutshort.io, tal.club, joinhandshake.com, wellfound.com; Backdoor via index.dodopayments.com/backdoor; Hunter via hunted.space; Hirevate via producthunt.com; READMEs of career-ops, ai-job-search, Iris.
