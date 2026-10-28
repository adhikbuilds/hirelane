# Eligibility (Slice 1)

**Status:** built, uncommitted, 2026-10-29. Pure engine code in `packages/engine/src/eligibility.ts` and `packages/engine/src/eligibility/`. It is wired into the worthwhile gate as an optional condition. Nothing in the app calls it yet. The eligibility screen (`/you/eligibility`) is Slice 3.

**Design rule:** a student is marked as failing a criterion only on a definite, contrary value. A missing value, an unrecognised value, an inferred value, or a CGPA-to-percentage conversion with no campus rule all give `unknown`. `unknown` never blocks anything.

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

`campuses.cgpa_rule` holds `{ kind: 'linear', a, b }`, meaning `pct = a * cgpa + b`, clamped to 0 to 100. `null` means there is no rule.

- `applyCgpaRule(cgpa, rule)` returns the percent, or `null` if there is no rule or the input is not finite.
- `invertCgpaRule(pct, rule)` returns the CGPA for a percentage student against a CGPA notice. It needs `a > 0`, otherwise `null`.
- With no rule, a CGPA-to-percent comparison is `unknown`. This is deliberate: a CGPA-to-percent conversion is a campus policy, not a fact the engine can know.
- `grad_conversion === 'direct'` means the student supplied their own percent equivalent in `grad_pct_equiv`, and that value is used directly. Any other conversion value (`campus:<id>`, `unknown`) falls through to the CGPA rule passed in the options. Nothing in the evaluator looks up a campus by id. The caller must pass the right rule.
- Scale 100 is taken as a percent. Scale 10 is taken as a CGPA. Scales 4 and 5 are stored, but the evaluator does not convert them, so they are `unknown` unless `grad_conversion` is `direct` (then `grad_pct_equiv` is used).

## 6. Worthwhile integration

`isWorthwhile` (`packages/engine/src/worthwhile.ts`) takes an optional `eligibility` field. When present, it adds an `academic_eligible` condition with `pass: overall !== 'fail'`. **Only `fail` blocks.** `unknown` leaves the job worthwhile, and the detail text says so. A property test (`eligibility.property.test.ts`) runs over 1,000 seeded random profiles and checks that unknown never changes the worthwhile answer. `worthwhile.test.ts` checks the same rule for fixed cases. Existing worthwhile tests are unchanged, because the field is optional.

## 7. Evaluation gates and corpora

`pnpm engine:eval` runs `scripts/evals/eligibility.ts` against `test/corpus/drive-criteria.labelled.jsonl` (88 notices).

| Gate | Value | Notes |
|---|---|---|
| Criterion accuracy | at least 0.90 | `tp / (tp + fp + fn)`, summed over all notices |
| Unknown to fail | must be 0 | Counted and gated |
| Wrong verdicts | counted, printed | **Not gated.** A pass-to-fail mismatch increments `wrong` but does not fail the eval |

**Gap.** The Slice 1 acceptance line says "0 wrong 'fail' verdicts". The eval only enforces "unknown never becomes fail". A `pass` that the engine turns into a `fail` is counted but not gated, so that part of the acceptance is not shown by the eval. Closing it means gating on `wrong` or on a specific pass-to-fail count, with a labelled set that contains those cases. Until then, do not describe the verdict side as fully gated.

The labelled corpora were written by the same agents who wrote the parsers. Treat the eval scores as regression guards, not measured accuracy.

## 8. Tests

| File | Covers |
|---|---|
| `packages/engine/test/eligibility.parse.test.ts` | Each criterion type and its surface forms |
| `packages/engine/test/eligibility.evaluate.test.ts` | Verdicts, roll-ups, overall, CGPA rule, unconfirmed profiles |
| `packages/engine/test/eligibility.corpus.test.ts` | The drive-criteria corpus through the parser |
| `packages/engine/test/eligibility.property.test.ts` | Unknown never blocks the worthwhile gate |
| `packages/engine/test/worthwhile.test.ts` | The `academic_eligible` condition |

## 9. Known limits

- The parser is regex-based. It is written for Indian drive notices (CGPA, percent, batch and passout years, B.Tech and friends). Other phrasings fall through to `unknown` rather than being guessed.
- Degree and branch aliases are local tables. They duplicate some of `data/degrees.json` and `data/branches.json`, and `criteria.ts` says so in its header.
- The notice corpus (88 labelled rows) is written by hand from paraphrased, public-style notices, with no employer or person names. It is not a measured sample of real drive notices.
- Pass-to-fail verdict errors are not gated (see §7).

## Related

- `docs/resume.md` for the education rows that feed the profile.
- `docs/design/campus-build-plan.md` for the S1.9 and S1.10 tasks and the Slice 1 acceptance.
