# Feature-by-feature business review: will anyone pay?

2026-10-28. ECC `architect` agent, read-only, written at the owner's request. Sources: FINAL-BUSINESS.md §5 and §11, 01-BUSINESS.md §4.1 and §6, and FINAL-PRD.md. The design changes that follow from it are in [../design/hld-lld-core-loop.md](../design/hld-lld-core-loop.md).

## Bottom line
**There is no evidence yet that anyone will pay.**
- Every price and conversion rate in FINAL-BUSINESS §5 and 01-BUSINESS §4 is tagged [assumption].
- None of the pre-pilot gates has been run: G0 (supply), G2 (recruiter interviews on college-tier filtering) and G3 (a 20-student device survey).
- On our own unit economics, B2C alone is "a learning exercise, not yet a business". Scenario B earns about +₹21 per activated student and needs a CAC under ₹21.
- The viable model is **scenario C, campus-paid**. There **the payer is the placement cell, not the student**, and the features they would pay for (campus codes, cohort dashboard) sit in R2.

**So judge the slice by one test:** does it produce the evidence the stop rules need? Those are:
- time saved ≥50%
- ≥80% of picks worthwhile
- ≥5 of 50 buyers at full price
- replies broken down by college tier

## Four structural risks
1. **The pass sells "unlimited hand-offs", but supply can't use them up.** Today there are 75 India entry-level roles. At about 10 worthwhile roles a week, the 3 free hand-offs a week cover most of the real need, so the paywall rarely bites.
2. **The pass pays for our weakest feature on a phone.**
   - On mobile the hand-off is a copy pack, not a fill.
   - Prefill is unverified on every ATS, and Android has no extensions.
   - If copy-paste on a phone doesn't cut the time per application by ≥50%, the main reason to pay disappears.
   - G3 tests exactly this, needs no code, and should run before M5.
3. **The category charges for volume submission, which we refuse to do.** Tsenta charges $19–99 a month per submitted application (verify). Our paid value has to come from finding roles, saving time and getting replies.
4. **College-tier filtering.** The price-sensitive tier-3 persona (Rahul) may get close to zero interviews whatever his fit, and is also the least likely to pay.

## Verdict per feature
| Feature | Business role | Who pays | Evidence | Verdict |
|---|---|---|---|---|
| Accounts (Google or email code) | enabler | nobody | n/a | **in**, minimal |
| Resume upload and rules parse | activation | nobody (free everywhere) | n/a | **in** |
| Daily picks and worthwhile gate | activation; the differentiator is fresh, eligible supply, not the explanation | indirect | none; **G0 fails today** | **in, gated on G0**; honest counts, never padded |
| Fit explanation ✓/✕ | trust, learning | low on its own | none | **in** |
| Swipe deck | UX | nobody | none | **in**, cheap |
| Fill/check (Needs-you, answer bank) | **the main paid value: time saved** | students, via a pass, *if* it saves ≥50% | none; must be measured | **in**; record minutes per application from day 1 |
| Hand-off (copy pack) and 4s undo | trust; where the paywall sits | the pass meters here | none | **in** |
| Tracker | retention; campus outcome data | students: no; campus: yes | relayed | **thin**: a list, a timeline and manual moves |
| "Got a reply" button | **the north-star metric**; second paywall trigger; campus proof | indirect, but essential | n/a | **add to M7 as a manual button** |
| Reply threading (alias) | automates the north star | indirect | none | later (integration track) |
| Resume tailoring | **possibly the strongest student willingness to pay**; every competitor leads with it | students | relayed only | defer the build; **run an honest "notify me" test** |
| Gap plan | retention, a pass perk | low to medium | none | the first perk after the slice |
| Referral finder | counters tier filtering; a moat | unknown | relayed | defer; test with a manual "I know someone here" toggle first |
| WhatsApp / email picks | retention | doubtful | none | defer |
| Streaks, stories, recap | acquisition, retention | never paid | none | defer until after the pilot |
| Background agent / autopilot | retention | unclear | none | defer; LLM cost cap first |
| Founder outreach drafts | niche | unclear | relayed | **cut** from R1/R2 planning |
| Campus code and cohort dashboard | **the only viable revenue (scenario C)** | placement cell, ₹300 per student per semester [assumption] | none | **move earlier**: `cohort_code` goes in the slice's schema, the dashboard comes right after the pilot, campus conversations start now |
| Public board / SEO / llms.txt | acquisition | nobody | built | done; keep growing supply (A5) |
| Passes / payments | revenue | students | none | **no integration**; for the pilot, use a plain payment link with a refund promise |

## What this changes in the build plan
1. **Run the no-code gates now, alongside M0–M2:**
   - G2: interview 3–5 recruiters.
   - G3: 20 students fill in a form on their phone.
   - Hold the first campus conversations.
   - Do A5: India board discovery.
2. **Instrument locally:** a `product_events` table in migration 0007 (RLS own, insert-only, no PII). Record:
   - activation
   - swipes
   - check opened
   - hand-off
   - "did you submit?"
   - replies
   - **time from opening the check screen to confirm-submit**
3. **"Got a reply" button and replies by `college_tier`** in M7.
4. **`cohort_code` and `college_tier` on `profiles`** in 0008.
5. **Honest demand tests:** "Tailor this resume: coming soon, notify me" and "Season pass ₹499, pay by link". Both record intent. The copy stays honest (H1).
6. **Cut or park:** founder outreach, streaks/recap, autopilot and WhatsApp, until the pilot answers the stop rules.

## Owner decisions
1. **Campus-first (scenario C)?** If yes, the cohort dashboard moves to right after the slice.
2. Who runs G2, G3 and the first campus conversations, and when.
3. A B2C cash ceiling, and the payment link (not an integration) for the pilot's willingness-to-pay test.
4. Defer network, autopilot, WhatsApp and streaks; cut founder outreach.
