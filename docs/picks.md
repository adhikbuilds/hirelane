# Picks and paste a job

**Status:** built, uncommitted, 2026-11-01. Picks are computed on each request and nothing is stored. Paste writes nothing and fetches nothing. The student screens are in the working tree. `next build` has not been run on this change.

**Sources:**

- Picks service: `packages/services/src/picks/` (`service.ts` `getPicks`, `rank.ts` `buildPicks`, `fit.ts` `loadStudentContext`, `types.ts` the response schemas, `eval.ts` and `eval-cli.ts` the eval, `levels.ts`).
- Paste service: `packages/services/src/paste/` (`service.ts` `checkPastedJob`, `assess.ts` `assessPaste`, `types.ts` `PasteInput` and `PasteResultSchema`).
- Engine: `packages/engine/src/` (`parseCriteria`, `evaluateEligibility`, `isWorthwhile`, `assessFresher`, `scoreForProfile`, `parsePastedJob`, `detectScamSignals`, `formatSalary`). Rules only, 0 LLM calls.
- HTTP: `GET /api/v1/picks` (`apps/web/app/api/v1/picks/route.ts`) and `POST /api/v1/paste` (`apps/web/app/api/v1/paste/route.ts`). Operations: `apps/web/lib/openapi-picks.ts`. Contract in `docs/public-api.md` §14.9.
- Screens: `apps/web/app/(app)/picks/page.tsx` (a scrollable deck), `apps/web/app/(app)/paste/page.tsx`, `apps/web/components/student/Deck.tsx`, `PasteForm.tsx`. The loader is `apps/web/lib/student/load.ts` (`loadStudentPicks`) and the mapping is `apps/web/lib/student/map.ts` (`picksToCards`).
- Schema: none. Picks read `jobs`, `companies`, `job_requirements`, `eligibility_profiles`, `resumes`, `profiles`, `cohort_members` and `applications`. No table is added for picks (migration 0015 says so).
- Tests: `packages/services/test/picks-rank.test.ts`, `picks-eval.test.ts`, `paste.test.ts`, `apps/web/tests/picks-paste-api.test.ts`.

---

## 1. Picks (`GET /api/v1/picks`)

### What it reads

- The student's **own** rows, through their own session (row level security applies):
  - the confirmed eligibility profile (`eligibility_profiles`), or none;
  - the campus CGPA rule, through their campus membership (`cohort_members`), and whether they are placed;
  - the skills of their latest confirmed resume (the default first; deleted and purged resumes are ignored);
  - their cities and remote preference (`profiles`).
- The **open** jobs the ingest holds, with their companies and must-have requirements (`job_requirements`, kind `must`).
- The student's applications. A job they already applied to (any status except `undone`) is never shown again.

Nothing else is read, and nothing is written.

### Candidate pool

The newest 400 open jobs whose posting date (or first-seen date, when there is no posting date) is within the last 14 days, and which were seen within the last 14 days. A new ingest changes the next call. There is no separate refresh job.

### How a pick is chosen

`buildPicks` is pure: no database, no network, and the clock is passed in. In order:

1. **Freshness and status.** Drop closed jobs, jobs posted or first seen 14 or more days ago, and jobs not seen in the last 14 days.
2. **Academic rules.** The posting's text is parsed for criteria (first 20,000 characters). The criteria are checked against the confirmed profile with the campus CGPA rule. **A hard fail is dropped** and cannot come back through ranking. An unknown rule stays, with its reason. Unknown never blocks.
3. **The worthwhile gate** (`isWorthwhile`). Every condition must hold: the role is open to freshers (`assessFresher`), at least 60% of its must-haves have evidence, the job is open, it was checked within 14 days, and the academic condition is not a fail. Pay and location are reported, not gated.
4. **De-duplication.** The same role (same company, same normalised title) is kept once, the best-ranked posting.
5. **Order.** Eligible before "check" (some rule could not be checked). Then the higher must-have ratio, then a location match, then the newer posting, then a stated pay, then the job id.
6. **Cap.** At most **10** picks a day. Ranks run from 1. There is no percentage and no score: the order is the whole signal.

**Placed students** get `placed: true` and an empty list. A placed student is not ranked.

### Response

`PicksSchema` (strict): `placed`, `date` (the IST day), and `picks[]`. Each pick has:

- `jobId`, `slug`, `company`, `title`, `locations`, `remote`, `rank`;
- `eligibility`: `eligible` (every stated rule met) or `check` (at least one rule could not be checked; nothing failed);
- `rules[]`: plain English with the maths, each `pass` or `unknown`;
- `mustHaves`: `matched`, `total`, and the matched and missing skills by label;
- `pay`: `stated` and the text (the posting's own figure, not converted to a monthly one);
- `whoYouKnow`: always `null` in this build (no source exists yet; the connections upload is a later slice). `null` means "no source", not "nobody";
- `posted`: `at`, `ageDays` and a label such as "Posted 2 days ago".

---

## 2. Paste a job (`POST /api/v1/paste`)

For a WhatsApp forward or a Naukri or LinkedIn listing that the student is not sure about.

- **Input:** `text` (20 to 20,000 characters) and an optional `url` (`http` or `https`, at most 500 characters). **The link is read as text. It is never fetched.** It is shown back as `applyUrl`, and it is never opened.
- **Output** (`PasteResultSchema`):
  - `job`: title, company, locations, workplace, level, a fresher check with its reason, pay (as stated), `applyUrl`, and the source hint (`naukri`, `linkedin`, `whatsapp` or `other`).
  - `eligibility`: `eligible`, `not_eligible` or `check`, with the rules (`pass`, `fail` or `unknown`) and the reason for each.
  - `fit`: `worthwhile`, `not_worthwhile` or `suspicious`; must-haves matched and missing; the gate's conditions; whether the location fits.
  - `scam`: `risk` (none, low, medium or high), `flagged`, and each signal's id, severity and quote (cut to 200 characters). The student sees their own paste's scam signals. The drive notices' scam flags are staff-only (`docs/campus.md` §5).
- **Writes nothing.** Not the text, not the result. A job is kept only when the student saves it through the tracker.
- **Limit:** 20 pastes per 10 minutes per student (`429`, with `Retry-After`). Not idempotency-keyed, because there is nothing to replay.
- A paste with no stated academic rule gets the line "The paste states no academic rules" with status `pass`. That line is a status, not a count of rules.

---

## 3. The picks eval

`pnpm --filter @hirelane/services picks:eval` runs `packages/services/src/picks/eval.ts`. It builds a synthetic corpus whose rules are known by construction, asks the picker for each profile's picks, and fails if any pick breaks a hard eligibility rule. The judge is plain arithmetic written in the eval, not the engine. A rule the engine does not parse back out of the text is also reported, because it would make the picker blind to that rule. Synthetic data only: 0 LLM calls, no network, no database.

Last result (integrate pass, 2026-11-01): 60 profiles by 40 postings, **0 violations**, 0 unread rules. `picks-eval.test.ts` runs the same check under `pnpm test`.

---

## 4. Known gaps

- **`whoYouKnow` is always `null`.** No connections source exists.
- **Years of experience are always 0** in the loader (`fit.ts`). A must-have that asks for a number of years is therefore never matched, and it counts against the ratio.
- **The campus CGPA rule only.** The university rule is not wired (`docs/apply.md` open list, item 3).
- **The CGPA rows are unverified** (`docs/apply.md` open list, item 2). A conversion with no verified rule shows as "check", never as a pass.
- **Per-verdict "this looks wrong" report** (competitor gap P0-4) is not built. Nothing in the picks or paste path logs one.
- **No push, no WhatsApp, no quiet hours.** Picks are a page the student opens. The Home notification rows are in `docs/notifications.md`.
- **The student Home screen reads picks through the same service.** It does not yet read notification rows.
