# Eligibility (Slice 1)

**Status:** built, uncommitted, 2026-10-29. Pure engine code in `packages/engine/src/eligibility.ts` and `packages/engine/src/eligibility/`. It is wired into the worthwhile gate as an optional condition, and into these callers:

- `packages/services/src/eligibility.ts`: saves and reads the profile (`eligibility_profiles`).
- `apps/web/app/api/v1/eligibility/route.ts` and `apps/web/app/(app)/you/eligibility/actions.ts`: the v1 route and the server actions.
- `packages/services/src/campus/drives.ts`: the student's drive inbox and the TPO drive counts.
- `workers/runner/src/tasks/campus-stats.ts`: the nightly drive snapshot.

The eligibility **screen** is not built. `/you/eligibility` has an actions file and no page yet. `apps/web/app/students/page.tsx` calls the engine on sample data only.

**Design rule:** a student is marked as failing a criterion only on a definite, contrary value. A missing value, an unrecognised value, an inferred value, or a CGPA-to-percentage conversion with no rule all give `unknown`. `unknown` never blocks anything.

**Readable verdicts.** Every verdict has a `reason` that a student can read. It shows the maths: the student's value, the required value, and the gap when there is one. Reasons are built from numbers and labels only, never from the notice text. The comparison is made on the same rounded value that is printed, so a reason never reads "60.0%, short by 0.0%". The examples below are from `packages/engine/test/eligibility.verdicts.test.ts`:

| Case | Reason |
|---|---|
| Short 12th | `Your 12th: 58%. Needs 60%. Short by 2%` |
| Met 12th | `Your 12th: 75%. Needs 60%: you meet it` |
| 10th | `Your 10th: 55.5%. Needs 60%. Short by 4.5%` |
| Diploma | `Your diploma: 70%. Needs 60%: you meet it` |
| CGPA through a confirmed university rule | `8.1 CGPA = 77.0% by RGPV's rule, needs 60%: you meet it` |
| CGPA through the campus rule | `8.0 CGPA = 76.0% by your campus's rule, needs 60%: you meet it` |
| Failing conversion | `7.0 CGPA = 66.5% by RGPV's rule, needs 70%. Short by 3.5%` |
| CGPA notice on the same scale | `Your graduation CGPA: 6.2. Needs 6.5. Short by 0.3` |
| No conversion rule | Unknown. The reason says which rule is missing and shows the CGPA (see §5) |

## 1. Two stages

```
notice text ──► parseCriteria ──► Criterion[] (with evidence offsets into the ORIGINAL text)
                                        │
confirmed profile ──► evaluateEligibility(criteria, profile, { cgpaRule }) ──► EligibilityResult
                                                                              │
                                              isWorthwhile({ eligibility }) ◄─┘  (only `fail` blocks)
```

- `parseCriteria` is pure regex. It does not normalise its input, so every offset indexes the notice string exactly as the caller gave it.
- Anything vague yields no criterion at all, so it stays `unknown` downstream. Examples: "good academics", a bare "60% aggregate" with no level, and "up to 2 backlogs" with no mention of history.
- Aliases for degrees and branches live in `criteria.ts` (`canonDegree`, `canonBranch`). They accept the lower-case ids in `data/degrees.json` and `data/branches.json`. `B.E` and `B.Tech` are one code, because notices write "B.E/B.Tech" as one requirement. `BRANCH_PARENT` marks AIML, DS, AIDS, CYBER as children of CSE (and ISE of IT, EE of EEE).

## 2. Criterion types

The contract is `Criterion` in `eligibility/types.ts`. Every variant carries `evidence: EvidenceSpan[]`.

| `type` | Fields | Recognised surface forms (examples, not exhaustive) |
|---|---|---|
| `min_score` | `levels`, `pct`, `cgpa?`, `throughout` | Percent: `60%`, `60 per cent`, `60 percentage`, for values 10 to 100. CGPA: `7.0 CGPA`, `CGPA 7`, `CGPA: 7.5`, `7/10 CGPA`, for values 1 to 10. Levels: 10th, Xth, SSC, SSLC, matriculation (10th); 12th, XII, HSC, PUC, intermediate, plus two (12th); diploma; graduation, UG, degree, bachelor's (ug); PG, post-graduation, master's (pg). "throughout", "in all levels", "at every level" or "each level" set `throughout`, and then the criterion applies to 10th, 12th and ug |
| `no_active_backlogs` | none | "no active backlogs", "zero standing arrears", "active backlogs are not allowed" |
| `max_backlog_history` | `n` | "up to 2 backlogs in history", "max 1 backlog in academic history". "no backlog history" gives `n = 0` |
| `passout_years` | `years` (expanded set) | 4-digit years 2000 to 2099 with a cue before or after. Before: passout, passing out, batch, graduates of, graduating, YOP, year of passing. After: passout, batch, graduates, grads, YOP. Chains such as "2024 and 2025" and ranges "2022-2026" (up to 6 years apart). In a batch context a span of 3 years or more keeps only the end year, because "batch 2022-2026" is a session |
| `degrees` | `list` (codes) | B.Tech, B.E, bachelor of engineering or technology (BTECH); M.Tech, M.E (MTECH); MCA; BCA; B.Sc (BSC); M.Sc (MSC); MBA; BBA; B.Com (BCOM); M.Com (MCOM) |
| `branches` | `list` (codes) | Full names and codes: computer science (CSE), information technology (IT), electronics and communication (ECE), electrical and electronics (EEE), mechanical (MECH), civil, chemical, instrumentation (EIE), artificial intelligence (AIML), data science (DS), and others. "circuit branches" expands to ECE, EEE, EIE. Bare IT, CS and EE count only inside branch context (words such as "only", "branch", "streams", "from", "eligible"). A parenthesis right after a degree, such as "M.Sc (CS/IT)", is masked and dropped (so the verdict is `unknown`), unless it is an explicit list of two or more branches on B.E, B.Tech or M.Tech |
| `max_gap_years` | `n` | "gap not more than 1 year", "max 1 year education gap", "no education gap" (`n = 0`) |

**Clause splitting.** Each clause ends at a newline, a `;`, or a sentence-ending `.` before a capital or digit. Score groups are built inside a clause. A percent and a CGPA written together ("60% or 6.5 CGPA") join into one group, and the grouping is kept only if the two are joined by or, and, slash, comma, ampersand, "equivalent to" or "i.e.". Each group becomes its own `min_score` criterion when it has a level.

## 3. Profile input

`EligibilityProfileInput` is the set of plain fields written to `eligibility_profiles` on confirm:
`pct_10`, `board_10`, `secondary_kind` (`12th` or `diploma`), `pct_secondary`, `board_secondary`, `degree`, `branch_code`, `branch_raw`, `grad_score`, `grad_scale` (4, 5, 10 or 100), `grad_pct_equiv`, `grad_conversion` (`campus:<id>`, `direct` or `unknown`), `grad_is_final`, `active_backlogs`, `backlog_history`, `gap_years`, `passout_year`, `lateral_entry`.

`confirmed: true` is required. Without it, every criterion is `unknown` with the reason "profile not confirmed by the student", and the overall result is `unknown`. Nothing is evaluated before the student confirms.

## 4. Evaluation rules

`evaluateEligibility(criteria, profile, { cgpaRule })` returns one `CriterionVerdict` per criterion, with `status`, a `reason` that contains only the numbers and labels, and `profileField` naming the field read.

**Per criterion:**

| Criterion | Verdict logic |
|---|---|
| `min_score` | Each level is checked. 10th: `pct_10` against `pct`. 12th or diploma: `secondary_kind` must be set. If it is 12th, a diploma-only notice is a `pass` (the rule does not apply). If it is diploma, the notice must name diploma, otherwise `unknown`. Then `pct_secondary` against `pct`. UG or PG: graduation, see below. The parts roll up: any `fail` gives `fail`, else any `unknown` gives `unknown`, else `pass` |
| `no_active_backlogs` | `active_backlogs` must be a number. 0 passes, 1 or more fails. Missing is `unknown` |
| `max_backlog_history` | `backlog_history` at or below `n` passes, above `n` fails. Missing is `unknown` |
| `passout_years` | `passout_year` in the expanded set passes, otherwise fails. Missing or outside 1990 to 2100 is `unknown` |
| `degrees` | `canonDegree(degree)` must be in `list`. Unmapped degree is `unknown`, and a mapped one not in the list fails |
| `branches` | `canonBranch(branch_code)`, or else `branch_raw`. Listed passes. A branch related to a listed one (see `BRANCH_PARENT`) is `unknown`, because the notice may accept it. Otherwise it fails. Unmapped is `unknown` |
| `max_gap_years` | `gap_years` at or below `n` passes, above `n` fails. Missing is `unknown` |

**Graduation** (UG and PG) takes the score through the CGPA rule (see §5) into a percent. It tests the percent route when the criterion has a `pct`, and the CGPA route when it has a `cgpa`. A route that passes gives `pass`. If every route fails, the first failing route is returned. Otherwise the first unknown route is returned. Finally, a `fail` on a degree that is not final (`grad_is_final === false`) becomes `unknown`, with the reason noting the score can still change.

**Overall** (`EligibilityResult.overall`): not confirmed gives `unknown`. Any criterion `fail` gives `fail`. Otherwise any `unknown` gives `unknown`. Otherwise `pass`. A notice with no criteria, and a confirmed profile, gives `pass`.

**Unknown semantics, summarised.** Unknown is returned whenever a value is missing, out of range, non-finite, unmapped, inferred from a related branch, not stated in the notice, or dependent on a CGPA rule that does not exist. `NaN` is what the parser writes for a CGPA-only criterion's `pct`, so a missing percentage in the notice is read as absent, not as zero.

## 5. CGPA rule

A rule is `{ kind: 'linear', a, b }`, meaning `pct = a * cgpa + b`, clamped to 0 to 100. `campuses.cgpa_rule` holds the campus rule, and `null` means there is none.

- `applyCgpaRule(cgpa, rule)` returns the percent, or `null` if there is no rule or the input is not finite.
- `invertCgpaRule(pct, rule)` returns the CGPA for a percentage student against a CGPA notice. It needs `a > 0`, otherwise `null`.
- With no rule, a CGPA-to-percent comparison is `unknown`. This is deliberate: a CGPA-to-percent conversion is a policy of the university or campus, not a fact the engine can know.
- `grad_conversion === 'direct'` means the student supplied their own percent equivalent in `grad_pct_equiv`, and that value is used directly. Any other conversion value (`campus:<id>`, `unknown`) falls through to the rules passed in the options. The evaluator does not look up a campus by id. The caller must pass the right rule.
- Scale 100 is taken as a percent. Scale 10 is taken as a CGPA. Scales 4 and 5 are stored, but the evaluator does not convert them, so they are `unknown` unless `grad_conversion` is `direct` (then `grad_pct_equiv` is used).

**Precedence** (`resolveConversion` in `eligibility/evaluate.ts`):

1. The **campus rule** (`cgpaRule`) always wins. The reason says "your campus's rule".
2. Otherwise, the **university rule** (`universityRule`) is used when the row is `verified`, or when the student has confirmed it (`universityRuleConfirmed`). The reason says "RGPV's rule" (the row's short name).
3. Otherwise the verdict is `unknown`. The reason names the missing rule: "We need your university's CGPA to % rule" when no university is picked, or "<rule> is not confirmed yet" when a row is picked but not confirmed.

**University rules** (`data/cgpa-rules.json`, read by `eligibility/university.ts`). Each row names a university, its aliases, its formula, a `source_url`, a `checked_on` date, a `check_method`, and a worked example. `findUniversityRule(query)` matches an id, a name or an alias. It tries an exact match first, then a name or alias of 3 or more characters found as whole words inside a longer line. Ids match exactly only, so a place word inside a longer line cannot match a university by its id. It never guesses: no match returns `null`. A name with a place qualifier does not register its placeless form as a key ("Mahatma Gandhi University" alone is not a key for "Mahatma Gandhi University, Kerala"). School-board rows (CBSE and similar) are excluded from lookup, because they convert school scores, not degrees.

**Current state:** all 28 rows are `verified: false`. Each was entered from memory and needs a fetched check before it can be `verified`. Until a student confirms a row, it is used 0 times.

**Wiring (checked 2026-10-31): the university rule is not connected to any caller.** The engine accepts `universityRule` and the answer engine takes it as an option, but no production path passes it. The drive inbox (`listMyDrives`), the nightly drive counts (`campus:stats`) and the application answers (`answerPortFor`) all pass only the campus rule. So in production a CGPA-to-percent comparison is `unknown` unless the campus has a rule or the student gave a printed percentage, even when the student has confirmed a university row. The RGPV examples in the table above come from the engine tests, not from a live path. Wiring is owner item E5 (`docs/apply.md`, "Open before pilot"). `pnpm engine:eval` runs `scripts/evals/cgpa-rules.ts`, which gates on: at least 25 rows; every row has a formula, an `https` source, and a `checked_on` date; every row converts its own example; no row is verified without a `fetched` check; an unverified row is never used without confirmation; and no rule gives `unknown`.

## 6. Worthwhile integration

`isWorthwhile` (`packages/engine/src/worthwhile.ts`) takes an optional `eligibility` field. When present, it adds an `academic_eligible` condition with `pass: overall !== 'fail'`. **Only `fail` blocks.** `unknown` leaves the job worthwhile, and the detail text says so. A property test (`eligibility.property.test.ts`) runs over 1,000 seeded random profiles and checks that unknown never changes the worthwhile answer. `worthwhile.test.ts` checks the same rule for fixed cases. Existing worthwhile tests are unchanged, because the field is optional.

## 7. Evaluation gates and corpora

`pnpm engine:eval` runs `scripts/evals/eligibility.ts` against `test/corpus/drive-criteria.labelled.jsonl`, and `scripts/evals/cgpa-rules.ts` against the university rule table (§5).

| Gate | Value | Notes |
|---|---|---|
| Criterion accuracy | at least 0.90 | `tp / (tp + fp + fn)`, summed over all notices |
| Unknown to fail | must be 0 | Counted and gated |
| Wrong verdicts | counted, printed | **Not gated.** A pass-to-fail mismatch increments `wrong` but does not fail the eval |

**Last run (2026-10-31, `pnpm engine:eval`): PASS.** The `eligibility` gate reports 88 notices, criterion accuracy 100.00% (tp 85, spurious 0, missed 0), and 93 labelled verdicts with 0 wrong and unknown→fail 0. The `cgpa-rules` gate reports 28 universities, 0 verified, 0 used without confirmation, and 28 of 28 unknown without a rule.

**Gap (still open, re-checked 2026-10-29).** The Slice 1 acceptance line says "0 wrong 'fail' verdicts". The eval `ok` condition is still only `accuracy >= 0.90` and `unknownToFail === 0`. The `wrong` count is printed and not gated, so a `pass` that the engine turns into a `fail` does not fail `engine:eval`. The readable-reason tests (§8) check the text of individual verdicts, but they do not gate pass-to-fail across the corpus. Closing the gap means gating on `wrong` or on a pass-to-fail count, with labelled cases that contain those mismatches. The matching box in `docs/design/campus-build-plan.md` stays unticked until then.

The labelled corpora were written by the same agents who wrote the parsers. Treat the eval scores as regression guards, not measured accuracy.

## 8. Tests

| File | Covers |
|---|---|
| `packages/engine/test/eligibility.parse.test.ts` | Each criterion type and its surface forms |
| `packages/engine/test/eligibility.evaluate.test.ts` | Verdicts, roll-ups, overall, CGPA rule, unconfirmed profiles |
| `packages/engine/test/eligibility.verdicts.test.ts` | Readable reasons with the maths; rounding; rule precedence (campus, then confirmed university, then unknown) |
| `packages/engine/test/cgpa-rules.test.ts` | University rule lookup and aliases; rules are used only when verified or confirmed |
| `packages/engine/test/eligibility.corpus.test.ts` | The drive-criteria corpus through the parser |
| `packages/engine/test/eligibility.property.test.ts` | Unknown never blocks the worthwhile gate |
| `packages/engine/test/worthwhile.test.ts` | The `academic_eligible` condition |
| `packages/engine/test/audit-fixes.test.ts` | Regression tests from the 2026-10-29 audit: a school-board row never converts a degree, a place name is not a university, cutoffs compare before rounding, and the submitted percentage is the one used for eligibility |

## 9. Known limits

- The parser is regex-based. It is written for Indian drive notices (CGPA, percent, batch and passout years, B.Tech and friends). Other phrasings fall through to `unknown` rather than being guessed.
- Degree and branch aliases are local tables. They duplicate some of `data/degrees.json` and `data/branches.json`, and `criteria.ts` says so in its header.
- The notice corpus (88 labelled rows) is written by hand from paraphrased, public-style notices, with no employer or person names. It is not a measured sample of real drive notices.
- The university rule table has no verified rows yet (§5). Every CGPA-to-percent verdict for a university needs the student's confirmation until a row is fetched and checked.
- The university rule is not passed by any production caller (§5, "Wiring"). Until it is, a university rule has no effect outside the engine tests and the eval.
- Pass-to-fail verdict errors are not gated (see §7).
- The eligibility screen is not built (§ Status).

## Related

- `docs/resume.md` for the education rows that feed the profile.
- `docs/campus.md` for the drive inbox and the nightly drive counts that use this engine.
- `docs/answers.md` for application answers, which read the same profile and the same CGPA rules.
- `docs/design/campus-build-plan.md` for the S1.9 and S1.10 tasks and the Slice 1 acceptance.
