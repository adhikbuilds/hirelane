# Screen audit, 2026-10-29

ECC `architect` agent, read-only, against CAMPUS-PRD, CAMPUS-FIRST §3, DESIGN.md and the approved mocks. Screens are in docs/screens. The owner chose next (2026-10-29): job and company detail, the resume upload flow, Discover with filters, console sign-in and roster; student app "keep Wrapped, go bolder".

## Fix first: credibility (a placement officer spots these)
- [ ] **One sample data source.** A drive has one rule set everywhere. Today Process Associate is 55% on the console, Home and Drives, but 60% on the resume screen. Counts must match across pages: offers waiting and verified, resume checks (6/9 vs 3/9), and "rules met" on picks.
- [ ] **k ≥ 10 for real.** No visible cell under 10 (B.Com Honours shows 1, 2, 4, 8). No hidden row that can be worked out by subtracting from the totals.
- [ ] **Students never see an ineligible drive** (C4), and the reason given matches the console's rules.
- [ ] **Scam signs stay off placement-cell drives.** A scam flag belongs on paste-a-job and replies, never under "From your placement cell".
- [ ] **No invented CTC split** in the parser-filled drive form. Show "3.6 LPA total" and leave fixed and variable empty, marked "check".
- [ ] **"Publish" includes unknown-verdict students** (E4: unknown never blocks). They see "we couldn't check: CGPA scale".
- [ ] **The funnel uses one population** (students not placed on campus who joined); state the base.
- [ ] **The CGPA rule shows its source URL and the date checked** (E5).
- [ ] **Every stat has a basis** ("minutes saved", "higher studies"), or is removed.
- [ ] **Copy:** "never you" is false at the *outcomes* share level. Say what each level shows.
- [ ] **Layout:** no horizontal overflow from 320 to 430 px on any screen; sidebars full height; no dev badge in captures.

## Missing screens (by PRD)
Resume upload, "reading", confirm and builder (R1, R2, R6, R7) · resumes manager (R8) · LinkedIn ZIP confirm (R10) · eligibility profile + university CGPA picker + "show the maths" line (E1, E5, E6) · Sign in with LinkedIn (A6) · join campus + cohort (C1) · share level + TPO view log (C2) · "I got an interview / offer" with letter (C5) · student settings and notifications (M2) · Discover + filters (S7) · job detail · company page · "Not this time" list · console sign-in + staff invite · console drives list · offer-letter review · roster import with mapping · cohort setup and switcher · empty, error and loading states · a public roles page for signed-out and under-18 visitors.

## Engagement (real counts only, no dark patterns)
Show what each fix unlocks ("add your CGPA scale: 3 more drives you can check") · drives with no 12th cutoff when that blocks a student · follow-up drafts on "quiet 6 days" · round-date reminders with documents to carry · a daily honest "N new since yesterday" line · WhatsApp share of drives and the recap · PWA share target · interview prep built from the posting · offer sharing with a clear explanation of what the college sees.

## Top 12 build order
1. Resume upload, "reading", health (readability first, with actions)
2. Confirm fields with confidence highlights
3. Eligibility profile, CGPA picker, show-the-maths line
4. The credibility fixes above
5. Mobile overflow and layout fixes; tab set per DESIGN.md
6. Guided builder whose output passes our own checks
7. Join campus in onboarding
8. Share level + TPO view log
9. "I got an interview / offer" + console review
10. Console sign-in, staff invite, drives list, roster import
11. Discover, job detail, company page
12. Settings and notifications; empty, error and loading states
