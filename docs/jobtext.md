# Paste a job, drive notices, and scam signals (Slice 3)

**Status:** engine code built, uncommitted, 2026-10-29. The parsers are pure, rule-only, with **0 LLM calls**. The engine functions are exported from `@hirelane/engine`, but **no route, server action or worker calls them yet**. A search of `apps/web`, `workers/` and `packages/` finds callers only inside `packages/engine` (tests and evals). The paste screen, `apps/web/app/(app)/paste`, is a re-export of `apps/web/app/dev/account/paste/page.tsx`, which uses `parseCriteria` and `evaluateEligibility`. It does not call `parsePastedJob`. Treat this as an engine capability, not a user-facing feature, until a caller ships.

**Owner files:** `packages/engine/src/jobtext.ts` (paste parse, source hint), `packages/engine/src/jobtext/score.ts` (eval scoring), `packages/engine/src/scam.ts` (scam signals), `packages/engine/scripts/evals/jobtext.ts` and `scam.ts` (gates).

## 1. What it does

A student pastes a job posting, a drive notice, or a forwarded message. The engine works out the fields and checks the text for scam signals. It does not fetch anything.

| Export | File | Purpose |
|---|---|---|
| `parsePastedJob(input, opts)` | `jobtext.ts` | Returns a `ParsedJob`: `title`, `company`, `locations`, `countries`, `workplace`, `level`, `fresher`, `salary`, `requirements`, `criteria`, `applyUrl`, `sourceHint`, `scamFlags` and per-field `evidence` |
| `sourceHintFromUrl(url)` | `jobtext.ts` | `naukri`, `linkedin`, `whatsapp` or `other`, from the host **string** only |
| `scoreForProfile(job, fit, eligibilityProfile, opts)` | `jobtext.ts` | Scores the parsed job against a student's profile. Uses `isWorthwhile` and `evaluateEligibility` from the existing engine |
| `detectScamSignals(text, opts)` | `scam.ts` | Returns `ScamResult`: a risk level and the signals that fired |

**Offsets.** Everything refers to `ParsedJob.text`, the normalised paste. Normalisation folds CRLF, removes zero-width characters and markdown emphasis, and collapses whitespace per line. Requirement and criterion evidence uses the same string. Signals that come from an option (`senderEmail`, a URL) carry null offsets, because they are not in the text.

**Links.** `sharedUrl` is parsed as a string. It is never fetched, resolved or opened. This is the legal guardrail in `CLAUDE.md`: no scraping of LinkedIn or Indeed, and no fetch of a job link a student shares.

**Limits.** The paste is capped at 100,000 characters (`MAX_CHARS`), with a per-line limit of 600 characters (`MAX_LINE`).

## 2. Scam signals

Risk is `none < low < medium < high`. A signal is `flagged` when the risk is medium or higher. A lone urgency phrase is `low`, because real drives say "last date" and "limited seats". A medium signal plus anything else escalates to high.

| Signal id | Severity | Fires on |
|---|---|---|
| `fee.upfront` | high | a fee the candidate must pay for a job or training. Negation-guarded |
| `fee.offer_letter` | high | a fee tied to an offer letter or joining. Negation-guarded |
| `contact.chat_only` | medium, or high when the text says "only" or names Telegram or t.me | the only contact route is a chat app. Skipped in a sentence that says the chat is not used or never used |
| `sender.freemail` | medium | a sender at a free-mail domain, when the company evidently has a domain of its own. The address is masked in the quote (`***@domain`) when it comes from the sender option |
| `pressure.urgency` | low (a lone phrase) | urgency language. Escalates when combined with another signal |
| `pay.unrealistic` | medium, or high for low-skill roles | a salary far above the role's norm. Uses `ANNUAL_FACTOR` and `parseSalary` |
| `link.shortened` | medium | a URL shortener host (`URL_SHORTENER_HOSTS`) |

The thresholds for unrealistic pay are exported as `FRESHER_UNREALISTIC_ANNUAL_INR` and `LOW_SKILL_UNREALISTIC_ANNUAL_INR`. The free-mail list is `FREE_MAIL_DOMAINS`.

Negation is guarded for the fee signals and for chat contact. The labelled scam corpus includes hard negatives (legit lines that mention fees, paid training and deadlines), so a false positive on them counts against the gate.

## 3. Evals (the gates)

`pnpm engine:eval` runs both. Both are part of `pnpm verify`.

| Gate | Threshold | Where |
|---|---|---|
| Pasted-job field accuracy: title, company, criteria | each at least 0.90 (`JOBTEXT_THRESHOLDS.fieldAccuracy`) | `packages/engine/scripts/evals/jobtext.ts` |
| Scam recall on scam lines | at least 0.95 (`scamRecall`) | `packages/engine/scripts/evals/scam.ts` |
| Scam false positives on legit lines | at most 0.05 (`scamFalsePositiveRate`) | same |

**Results from the integrate run (verify tail, exit 0):**

| Eval | Result |
|---|---|
| jobtext | PASS: title 100%, company 100%, criteria 100% |
| scam | PASS: recall 100%, 0 false positives |
| sensitive | PASS (22 of 22). This is the resume sensitive gate, listed here because the same `engine:eval` run reports it |
| eligibility | PASS |

**Caveat on the numbers.** The corpora were labelled by agents, and the parsers were written by agents too. The labels were written by the generator before the detectors existed, which reduces the risk of fitting the labels to the code. That is still not measured accuracy. The 100% figures are regression guards. A real measurement needs a corpus that people who did not write the code have labelled, using real notices with consent or from public sources.

- `packages/engine/test/corpus/pasted-jobs.labelled.jsonl`: about 78 synthetic pasted posts in Naukri-card, LinkedIn, WhatsApp-forward and drive-notice styles. Built from fixed title, company and city slots, plus the criteria phrasings of the drive corpus.
- `packages/engine/test/corpus/scam.labelled.jsonl`: about 70 synthetic notice lines, scam or legit, with the expected signal ids for scam lines.

Unit tests: `packages/engine/test/jobtext.test.ts`, `jobtext.corpus.test.ts`, `scam.test.ts` and `scam.corpus.test.ts`. All run in `pnpm test`.

## 4. Drive notices

The same parser handles drive notices (PRD S6). The criteria, such as CGPA cut-offs, backlog rules and branch lists, go through `parseCriteria` from `docs/eligibility.md`. Where a notice gives no value for a criterion, the verdict is `unknown` and never `fail`. This follows the Slice 1 rule that unknown never makes a role non-worthwhile.

## 5. What is not built

- No route or action calls `parsePastedJob`, `scoreForProfile` or `detectScamSignals`. Nothing shows the scam flags to a student.
- No stored result. Parsing runs on each call, and nothing is persisted.
- The scam signals are rule-based. Nothing is sent to an LLM, so the signals cannot catch a scam written in a way the rules do not anticipate. Expect false negatives on new phrasing.
- No real-world accuracy measurement (see the caveat in §3).

## Related

- `docs/eligibility.md` for the criteria parser and the verdict rules.
- `docs/resume.md` for the resume side of the same slice.
- `docs/design/campus-build-plan.md` for the Slice 4 "scam flags" task, which is listed there.
- `CLAUDE.md` for the legal rules on job sources and links.
