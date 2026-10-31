# Application answers (0 LLM)

**Status:** built, uncommitted, 2026-10-31. Decision 1 of the 2026-10-29 owner night decisions (`docs/product/DECISIONS-2026-10-29-night.md`): answers come from rules and confirmed facts, never from a model.

**Sources:**

- `packages/engine/src/answers/` (`classify.ts`, `answer.ts`, `types.ts`, `index.ts`). Pure, no I/O, no runtime dependencies. It does not import `@hirelane/agent` or any model client.
- `workers/runner/src/tasks/apply-submit.ts`: `answerPortFor` adapts the answer set to the submit executor.
- `packages/agent/src/submit/execute.ts`: the executor reads each answer, and a `needs_you` answer blocks the submission.
- `packages/services/src/apply/answers.ts`: the student's answer bank, sealed at rest.
- Eval: `packages/engine/scripts/evals/answers.ts` (run by `pnpm engine:eval`). Tests: `packages/engine/test/answers.test.ts`, `workers/runner/test/apply-submit.test.ts`.

**Rule of the engine:** a value is filled only with an evidence record. Anything without one is `needs_you`, with a reason the student can read.

---

## 1. Three functions

| Function | Job |
|---|---|
| `classifyQuestion(label, options?)` | Maps a form label (and its options, when the label is vague) to one key, or `unknown`. Rules only. The first matching rule wins. |
| `answerFrom(profile, answerBank, resumeFacts, company, options)` | Builds one `Answer` for each of the 23 keys, each `filled` (with evidence) or `needs_you` (with a reason). |
| `answerQuestion(label, options, set)` | Classifies the label and returns its answer. When the form offers options, a filled value must equal one of them (case and spacing ignored), or the answer becomes `needs_you`. An email never goes to a Yes/No question. |

`unknown` is always `needs_you`. The engine never forces a question into a key it does not recognise.

## 2. The keys

| Group | Keys |
|---|---|
| Identity and contact | `name`, `email`, `phone`, `linkedin`, `github` |
| Academics | `grad_year`, `degree`, `cgpa`, `percentage`, `cgpa_pct`, `pct_10`, `pct_12` |
| Work and pay | `notice_period`, `relocation`, `expected_ctc`, `current_ctc`, `work_authorization`, `visa_sponsorship` |
| Free text | `why_company`, `why_role`, `about_yourself` |
| Never filled | `gender_eeo`, `sensitive_id` |

## 3. How each key is filled

- **Profile facts** (`name`, `email`, `phone`, `degree`, `grad_year`): from the confirmed profile. The worker sets `email` to the student's **apply address**, never the student's own mailbox (see `docs/apply.md`).
- **Links:** `linkedin` needs a `linkedin.com/in/...` URL and `github` needs a `github.com/...` URL. The student's own link wins. A resume link is used only after the student has confirmed the parse.
- **Academics** (`pct_10`, `pct_12`, `cgpa`, `percentage`, `cgpa_pct`): only when the eligibility profile is confirmed. Each value must be in range (percent 0 to 100, CGPA at most its scale).
  - For a 10-point CGPA, a percentage the university printed (`grad_conversion: 'direct'`) wins over any rule. This matches eligibility, so the percentage submitted is the one the student was judged on.
  - Otherwise a campus rule (`options.campusRule`) or a confirmed university rule converts the CGPA. With neither, the answer is `needs_you` and the reason names the missing rule.
  - Scales 4 and 5 are never converted. Only a printed percentage fills `percentage` for them.
- **Work authorisation and visa sponsorship:** from the student's row for the job's country. A `visa_held` student is asked about sponsorship, because only they know if it will be needed later.
- **Answer bank:** `notice_period`, `relocation`, `expected_ctc`, `current_ctc`, `work_authorization`, `visa_sponsorship`, `why_company`, `why_role` and `about_yourself` take the student's own saved answer first, when one exists (at most 2,000 characters).
- **Always `needs_you`:** `gender_eeo` (demographic questions are always the student's) and `sensitive_id` (family, parents, guardian, emergency contacts, Aadhaar, PAN, passport). These are applied after the set is built, so no source can override them.
- **Free-text templates** (`why_company`, `why_role`, `about_yourself`): built from the strongest confirmed resume evidence. That is the first experience ("`<role>` experience at `<org>`"), else a project title, else up to three skills. Without a confirmed resume there is no template. `why_company` also needs a line about the company, and `why_role` needs the role title.

## 4. The classifier

- Labels are cleaned first: Unicode-normalised, lower-cased, smart quotes folded, "(optional)" and "(required)" dropped.
- **Traps are checked before any key.** Each of these is `unknown`:
  - why-questions about leaving, switching, a gap or being laid off ("why did you leave")
  - company, employer, college or reference name questions, including "current company" and "alternate"
  - school year, board, school name or roll number, even when a percentage is nearby
  - relocation assistance or bonus (not whether the student will relocate)
  - "when did you start your degree"
- A percentage is read as academic only when academic words appear ("what percentage of travel" is `unknown`).
- Options can tip a vague label into a key. A list containing "prefer not to say" (or male and female) is `gender_eeo`. A list with "Immediate" and "days" is `notice_period`.
- The `via` field records what decided it: `label`, `options` or `none`.

## 5. Use in the worker

- `answerPortFor` builds the profile from the student's facts and passes the **single** job country when the student has exactly one work-authorisation row. Phone, LinkedIn and GitHub come from the answer bank.
- The company "about" line is passed as an **empty string**. So `why_company` always comes out `needs_you` in the worker, because it has no company line to write from.
- **Unknown labels:** the worker derives a bank key `q:` plus 16 hex characters (the hash of the normalised label). The student answers that question once, and the answer is reused for every form that asks it the same way. The label is shown on the application detail.
- **Prose written for one company is never reused.** For an unknown label that matches cover letter, "why us", "anything else", "message to", "motivation", "statement of purpose" or SOP, the answer is `needs_you` with "Write this for each company yourself".
- Form answers still need a value **and** evidence. The executor also checks email and number format, and it matches select options exactly. Any `needs_you` answer blocks the submission (`needs_you` state, see `docs/apply.md`).

## 6. Known gaps

- **Template free text is auto-submitted.** In the worker, `why_role` is filled from the template and sent without asking the student, once the resume is confirmed and has some evidence. `about_yourself` is sent the same way, if the profile also has a degree. Only `why_company` is held back, for the reason in §5. Owner decision: whether templates should ever be sent unseen. See `docs/apply.md`, "Open before pilot".
- **The university rule is not passed by any caller.** The engine accepts it, but the worker's answer port passes only the campus rule. See `docs/eligibility.md` §5.
- The classifier and the templates are not tested against real employer forms. There is no live ATS transport (see `docs/apply.md`).

## 7. Evals and tests

`pnpm engine:eval` (run on 2026-10-31, PASS for the `answers` gate):

| Measure | Result | Gate |
|---|---|---|
| Labels | 220 (`test/corpus/questions.labelled.jsonl`) | at least 120 |
| Known-key accuracy | 100.00% (182 of 182) | at least 95% |
| Trap labels forced into a known key | 0 | 0 |
| Answers checked across 3 profiles | 69 | |
| Invented answers (filled with no evidence, or evidence that does not match) | 0 | 0 |
| EEO, ID or unknown answers filled | 0 | 0 |
| Values outside the form's options | 0 | 0 |

The labels were written by hand by the agent that wrote the classifier (see the corpus header). Treat the numbers as regression guards, not as measured accuracy on real forms.

## Related

- `docs/apply.md`: the swipe, the executor, receipts and the open items.
- `docs/eligibility.md`: the profile and the CGPA rules that the answers read.
- `docs/campus.md`: the campus CGPA rule.
