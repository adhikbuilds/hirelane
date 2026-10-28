# Platform analysis

Written 2026-10-19. Sources: live sites fetched today, our own screenshots of Shortlist, GitHub READMEs, and third-party reviews.
Tags: [site] = the vendor's own page, read today · [review] = third-party article · [readme] = repo README · [db] = our local board · [plan] = PLAN.md / docs/network-plan.md.
Prices are what the vendor says, unchecked.

## 1. The six kinds of player

### A. Volume auto-appliers: the bot applies for you
- **Tsenta** (YC) [site]
  - Watches 50k+ career pages across 30+ ATSs, scores matches, tailors CV and cover letter, fills and **submits**, then routes replies.
  - Channels: web, iOS, Android, iMessage, WhatsApp, Chrome, MCP/CLI.
  - Pricing: $19 / $39 / $99 a month for 600 / 1,500 / 4,500 applications; 25 free. "Pay for the applications. Not the tool."
  - Pitch: speed ("recruiters review the first 100"). Audience in their own words: "the desperate, the laid-off, the OPT-clocked".
  - Does not promise to be undetectable.
- **Shortlist** (shortlistapp.co) [site]
  - AI agent: reads 15k–27k jobs from career pages every 6h, fills the real form, and either you approve each one or the autopilot applies by rule. Replies are threaded and "Not this time" is filed quietly.
  - Pricing: free 10, ₹79/week with autopilot. India pricing; experienced-tech focus (US, UK, India).
  - Very strong detailing: match maths, a 4-second undo, a paper trail.
- **JobCopilot** [site]: "500k company career pages", up to 50 applications a day, auto-applies, 100k+ users, hiring-manager emails.
- **LazyApply, LoopCV, Sonara** (named on Shortlist's compare page): bulk-apply bots. Shortlist positions against them.
- **What they solve:** typing. **What they create:** spam, applications the user never read, bot-detection risk, and a race to the bottom on volume.

### B. Copilots and autofill extensions: you apply, they help
- **Jobright.ai** [review]
  - Match scores broken down (experience, skill, industry), "why you're a good fit", autofill, tailored resumes, insider connection emails, an AI agent.
  - Turbo about $39.99/month or $17.99/week; no public price page.
  - US; claims 3M users and 400k new jobs a day [site, 2026-10-17 screenshot].
- **Simplify** [site]
  - Daily matches, autofill extension, tracker, resume scoring against the job description, "connections at <company>".
  - US students and new grads; claims 2M+ users.
- **What they solve:** form filling on desktop. **Gaps:** US-only data, desktop extension, no India pay or fresher signals.

### C. India mass job boards: supply and habit
- **Naukri, LinkedIn, Indeed India:** the default habit. Recruiter-paid. Noisy: reposts, consultancies, stale listings, hidden pay.
- **apna** [site]: 5 crore+ seekers, 7 lakh+ MSMEs, 6 crore+ downloads. Blue- and grey-collar plus freshers. HR contacts you directly.
- **Internshala** [site]
  - Internships and fresher jobs: 28.4 lakh+ placements claimed, 10k+ daily openings.
  - Makes money from paid placement courses and "IS PRO"; employers post free.
- **Unstop** [site title]: competitions, hackathons, quizzes, internships for students; campus and corporate branding.
- **What they solve:** volume of listings for freshers. **Gaps:**
  - no fit explanation
  - no form help
  - no honesty about pay or freshness
  - monetised by selling courses or by recruiters
  - a 2012 UI

### D. India reverse marketplaces and direct hire: companies come to you
- **Instahyre** [search]: candidates get contacted by 800+ companies (Amazon, Uber, Paytm…). Experienced tech.
- **Cutshort** [site]: "every 3rd product engineer in India", companies invite you, "one offer every hour". Experienced tech.
- **Hirect** [search]: direct chat with CXO/HR, no consultants. 2M+ seekers and 40–60k startups claimed.
- **Tal Boss** (tal.club) [site]: "The app where bosses hire directly"; 3,000+ startup and product bosses. Employer app only; the page is thin.
- **What they solve:** skipping agencies and reaching decision makers. **Gaps:** built for experienced techies; freshers rarely get pinged; no help applying anywhere else.

### E. Open-source and DIY agents: the disciplined power user
- **career-ops** (santifer, mirrored by vancityayush) [readme]
  - Claude Code command centre: A–F scoring over 10 dimensions, tailored ATS PDFs, a portal scanner (Greenhouse, Ashby, Lever, Wellfound), batch eval, TUI tracker, story bank, negotiation scripts.
  - "NOT a spray-and-pray tool… never submits." The author evaluated 740 offers to land one role.
- **ai-job-search** (MadsLorentzen, mirrored by vancityayush) [readme]: /scrape → /apply → /interview; drafter-reviewer agents; LaTeX CVs. 69 applications → 20 interviews → 1 offer.
- **Iris / "Kaam"** (vancityayush) [readme]: resume tailoring and application platform. Next 15, NestJS hexagonal, pgvector, BullMQ, Tectonic LaTeX in Firecracker, Terraform.
- **What they solve:** quality and discipline. **Gap:** developers only (needs a terminal, Claude Code, LaTeX).
- **What they prove:** quality over volume works (a 29% interview rate in ai-job-search's funnel).

### F. Campus and network: who you know
- **Handshake** (US) [site]: the campus-network job platform; 1M+ employers.
- **Wellfound** [site]: startups, "talk to the people doing the actual hiring", AI sourcing.
- **WarmPath** (ours) [plan]: relationship-graph warmth scoring, ported into Hirelane under Amendment A.
- **Gap in India:** no fresher product answers "who do I know at this company, and how do I ask them?" Referrals decide a large share of fresher hires, but tier-2/3 students have no map of their own network. [assumption: referral share; needs a source]

## 2. Comparison grid
| | Volume bots (A) | Copilots (B) | India boards (C) | Reverse/direct (D) | DIY agents (E) | Hirelane |
|---|---|---|---|---|---|---|
| India fresher supply | weak | none | strong | weak | n/a | weak today (75 roles [db]); must fix |
| Explains fit | % score | breakdown | no | no | A–F, deep | ✓/✕ with quotes |
| Fills the form | yes | yes (extension) | no | no | drafts | yes, then hand-off |
| Who submits | the bot | you | you | n/a | you | you |
| Honest pay/freshness | mixed | mixed | no | no | n/a | yes, enforced in the engine |
| Warm path / referrals | email scraping | "connections" | no | direct chat | no | your own contacts, warmth maths |
| Mobile, Gen-Z | some apps | desktop | dated apps | apps | terminal | swipe-first app |
| Price for an Indian student | $19+/mo | $18+/wk | free / courses | free | free + API cost | ₹79/wk planned |

## 3. Where the gap is
Nobody serves an Indian fresher with all four at once:
1. real, fresh, fresher-friendly roles
2. a fit explanation they can learn from
3. the form filled, while they still press submit
4. the people they already know at that company, with an intro drafted

- Volume bots cover 1 and 3, but submit for you and aren't India-fresher.
- India boards cover only part of 1.
- Reverse marketplaces skip freshers.
- DIY agents cover 2 and 3 for developers.
- The unclaimed corner is 1–3 done honestly for Indian freshers, with the user submitting. That is Hirelane's core business. Warmth (4, Amendment A) is an extra edge on top.

## 4. Threats
- Shortlist adding a fresher or campus mode (they already have India pricing and the mechanics).
- Tsenta launching INR pricing and WhatsApp in India.
- Naukri or Internshala bolting on AI autofill (they own the supply and the habit).
- Detection: ATSs and employers penalising bot-sent applications. This one helps us, because we don't send.

## 5. What to borrow (mechanics, never their copy, names or assets)
- **Shortlist:** match maths with misses; "Needs you"; 4-second undo; paper trail; "Not this time".
- **Tsenta:** WhatsApp as a channel; the MCP/CLI agent surface; receipts per application.
- **Jobright:** the score broken into dimensions; "why you're a good fit"; insider connections.
- **Internshala/Unstop:** campus distribution; competitions as a top-of-funnel.
- **career-ops:** an A–F grade and a "don't apply below 4" rule; the story bank for interviews.
- **Hirect/Tal Boss:** direct-to-decision-maker chat, for a later employer side.

Sources: tsenta.com, shortlistapp.co (+ /jobs, /how-it-works), jobright.ai, simplify.jobs, joinhandshake.com, wellfound.com, jobcopilot.com, internshala.com, apna.co, unstop.com, cutshort.io, tal.club; GitHub READMEs of vancityayush/{career-ops, ai-job-search, Iris}; Jobright pricing from resumehog.com and careery.pro reviews; Hirect from yourstory.com.
