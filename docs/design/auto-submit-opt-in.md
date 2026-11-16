# Opt-in auto-submit: plan (not approved to build)

2026-10-29. The owner asked to plan an opt-in mode where Hirelane submits an application after the student approves that specific application. Today's rule (CLAUDE.md legal guardrails, PLAN.md) is "no auto-submission in MVP; headless submission is a later, feature-flagged phase with per-application approval". This doc is that later phase's plan. **It may not be built until every gate below passes.**

## Gates, before any code
1. **ATS terms review, per platform.** Greenhouse, Lever, Ashby and every S2 source: does the employer-facing or candidate-facing agreement allow software submitting on a candidate's behalf? Record a dated note per platform in docs/recon. Any "no" means that platform stays copy-pack only.
2. **Legal review (India).** Acting as the candidate's agent: a consent record per application, liability for wrong answers, DPDP purpose limitation. Written advice, not our own reading.
3. **Employer signal.** At least 3 employers or recruiters (G2 interviews) are fine with assisted submissions that carry a disclosure.
4. **Evidence that it's needed.** G3 shows the phone copy step is too slow: under 50% of students finish a real form, or the time saved is under 50%.

## Design if the gates pass
- **Opt-in per student, then per application.** The default is off. Turning it on shows a plain explanation. Every application still goes through the check screen; the button reads "Submit for me", next to "Open their form instead".
- **Nothing is ever guessed.** The "Needs you" fields must be answered by the student, and an answer without resume evidence blocks submission.
- **Disclosure.** Where a form allows it, add "Submitted with Hirelane on the candidate's instruction". Never pretend to be the student typing.
- **Rate and scope limits.** At most N per day per student. Submits only to official ATS endpoints of allowlisted employers, never a scraped or aggregator page. No account creation on employer sites, no CAPTCHA solving.
- **Receipts.** Store what was sent (an answers hash, the resume version, a timestamp, the ATS response code), viewable by the student, plus a 4-second undo before sending.
- **Kill switch.** A global and per-platform flag. Any platform complaint switches that platform off.
- **Code boundary.** Lives only in `packages/agent/src/submit/`, behind the existing `no-submit-guard`. Its own security review, and an e2e test against a fixture ATS only.

## Until then
The student presses Submit on the employer's site. Speed-ups that need no gate:
- pre-fill links where an ATS documents them (verify each one)
- a "copy next" stepper on phones
- the laptop extension that fills the form while the student submits
