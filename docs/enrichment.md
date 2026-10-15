# Hirelane enrichment (Phase 2)

**Last Updated:** 2026-10-16
**Status:** Phase 2, uncommitted working tree. Engine and agent packages are built; the LLM path is not wired into the worker yet (see Known gaps).
**Source of truth:** `PLAN.md` §3.1 (salary), §2.2 to §2.8, and the Phase 2 acceptance list. Package layout is in `docs/architecture.md` §6.

Enrichment turns a raw ATS posting into a canonical job: normalised salary, structured requirements, skills, level, workplace, employment type, countries, visa, role family and a dedup cluster. Every derived field carries a `Trace`, a list of numbered rule steps with the exact source quotes they used.

Principles, from the engine code and tests:

- **Deterministic first.** The engine is pure and rule-based. Same input, same output. It has no clock or randomness, and no I/O (the clock ban is not yet enforced, see Known gaps).
- **Unknown beats a guess.** An unparseable salary is `null`, never estimated. Visa is `unknown` unless a positive or negative phrase is found.
- **Integer money.** Amounts are stored as integer minor units (`bigint` internally, `number` at the boundary, checked for safe-integer range).
- **Traceable.** Each step has a `ruleId`, `op`, `label`, `inputs`, `output` and `evidence`. A trace holds at most 64 steps. Overflow ends in a `trace.truncated` step. Evidence quotes are capped at 160 characters.

Code locations:

| Area | Path |
|---|---|
| Salary parser and normaliser | `/Users/aagarwal/hirelane/packages/engine/src/salary.ts` |
| Money tables and FX conversion | `/Users/aagarwal/hirelane/packages/engine/src/currency.ts`, `/Users/aagarwal/hirelane/packages/engine/src/fx.ts` |
| Requirements | `/Users/aagarwal/hirelane/packages/engine/src/requirements.ts` |
| Skills | `/Users/aagarwal/hirelane/packages/engine/src/skills.ts` |
| Classifiers | `/Users/aagarwal/hirelane/packages/engine/src/classify/` (`level.ts`, `workplace.ts`, `employment.ts`, `roleFamily.ts`, `visa.ts`) |
| Places and countries | `/Users/aagarwal/hirelane/packages/engine/src/places.ts` |
| Dedup and canonical titles | `/Users/aagarwal/hirelane/packages/engine/src/dedup.ts` |
| Trace model | `/Users/aagarwal/hirelane/packages/engine/src/trace.ts` |
| Data files | `/Users/aagarwal/hirelane/packages/engine/data/` (`skills.json`, `role-families.json`, `salary-bounds.json`, `fx_rates.json`, `places.json`) |
| Composition (worker side) | `/Users/aagarwal/hirelane/workers/runner/src/tasks/enrich-core.ts` |
| Eval scorer and runner | `/Users/aagarwal/hirelane/packages/engine/scripts/score.ts`, `/Users/aagarwal/hirelane/packages/engine/scripts/eval.ts` |

---

## 1. Salary

### 1.1 Precedence

`parseSalaryTraced(text, structured, ctx)` in `salary.ts`:

1. **ATS structured compensation** (`ashby.compensation`, `lever.salaryRange`, `greenhouse.pay`). Used first. Confidence is `1`, currency rule `structured`, period rule `structured`. It is dropped, with a reject step, and the text parser runs instead when any of these hold:
   - no currency (`salary.structured.currency_missing`);
   - currency not in the supported list (`salary.currency.unsupported`);
   - no positive min or max (`salary.structured.empty`);
   - `kind` is neither salary nor OTE (`salary.structured.kind_other`);
   - no period can be found (`salary.structured.period_unknown`). The period comes from the structured summary text first, then from an explicit period in the description.
   Reversed min and max are swapped (`salary.structured.swap`).
2. **Text parser.** Runs on `Doc.text`. Each candidate statement is checked in the steps below.

`parseSalary` returns only the parse. `parseSalaryTraced` also returns the trace when nothing passes, so a reader can see why.

### 1.2 Text parser steps

1. **Number and suffix.** Digits with western, Indian or European grouping (`parseDecimal` accepts `1,000`, `1,00,000`, `1.000`, and mixed separators with the last mark as decimal). Suffixes: `k`, `m`, `M`, `B`, `million`, `mn`, `billion`, `bn`, `lakh`/`lac`, `crore`/`cr`, `lpa`. A bare `L` counts as a lakh only with an INR prefix.
2. **Currency prefix or suffix.**
   - Symbols: `£ € ₹ ¥`, `Rs` and `Rs.` (INR), `US$ CA$ C$ AU$ A$ NZ$ SG$ S$ HK$`.
   - ISO 4217 code before or after the number (`USD 120,000`, `120,000 USD`).
   - Bare `$` is resolved in this order:
     1. a local-country word within a short window (`Canada`, `CAN`, `Australia`, `Singapore`, `New Zealand`, `US`), giving `symbol_by_country` at confidence cap 0.9;
     2. the resolved job countries (`US` gives USD; `CA`, `AU`, `SG`, `NZ`, `HK` give their dollars), also `symbol_by_country`;
     3. otherwise USD by default (`symbol_default_usd`, cap 0.8).
   - No currency at all means no statement. A lakh or crore word alone can imply INR (`inr_word`).
   - The supported ISO codes are the 21 keys of `CURRENCY_EXPONENT`: USD, CAD, AUD, SGD, NZD, HKD, GBP, EUR, CHF, SEK, NOK, DKK, PLN, CZK, INR, BRL, MXN, ILS, AED, ZAR, JPY, KRW. JPY and KRW use 0 decimal places, the rest 2.
3. **Bound.**
   - `a - b` or `a to b` is a `range` (`salary.range.dash`). Reversed values are swapped.
   - `up to`, `as high as`, `maximum`, `max` before the number give `up_to`. `minMinor` becomes null.
   - `from`, `starting at`, `minimum`, `at least` give `from`. `maxMinor` becomes null.
   - Otherwise `single`.
   - Single, `up_to` and `from` cap confidence at 0.9.
4. **Zero** is rejected (`salary.reject.zero`).
5. **Period.**
   - Explicit, after the amount: `/hour`, `per year`, `annually`, `p.a.`, and similar. Also explicit before it (`per annum`, `monthly`, `hourly`).
   - `lpa_crore`: an INR lakh, crore or LPA amount is a year figure.
   - `magnitude` (no period word): INR under 3,00,000 is a month, otherwise a year. For other currencies, a value of 1,000 or more is a year; under 300 is an hour. Between 300 and 1,000 is rejected as `salary.period.ambiguous`. JPY and KRW need at least 1,000,000 to be a year, otherwise rejected.
   - Magnitude inference caps confidence at 0.6.
6. **Pay cue.** A lone amount with no pay word (`salary`, `compensation`, `pay`, `base`, `OTE`, `CTC`, `package`, `range`, `up to`, and others), no period and no OTE marker is rejected (`salary.reject.no_pay_cue`).
7. **Plausibility.** The annualised amount must fall in `data/salary-bounds.json` for its currency. Examples: USD 8,000 to 2,500,000 per year. Outside that is rejected (`salary.plausible.annual_range`). These bounds are hand-set, not market data.
8. **Kind and CTC.**
   - `ote` when an OTE or on-target marker follows the amount or sits closer before it than a base-salary marker does, within the preceding sentence. Otherwise `base`.
   - `ctc` is set when `CTC` appears within 40 characters.
9. **Selection.** Base statements are preferred over OTE ones. If the job's first resolved country matches a statement's nearby country, that one wins (`salary.select.country_match`). Otherwise the first base statement wins (`salary.select.first_base`). Skipped statements get `salary.select.skipped` steps, capped at 8, then `salary.select.skipped_more`.

Confidence is the minimum of the caps applied (starting at 0.95). Confidence below `SALARY_LLM_BELOW = 0.7` makes the LLM fallback eligible. In Phase 2 that is only a recorded flag (see §5 and Known gaps).

### 1.3 Normalisation

`normalizeSalary(parse, fx)`:

- Annualise with `ANNUAL_FACTOR`: hour 2080, day 260, week 52, month 12, year 1. The multiplication is done in `bigint` and checked for safe range.
- Convert to USD and INR using the FX snapshot. The default is `data/fx_rates.json`, `as_of` 2026-10-15. The file says its rates are illustrative round numbers, not a market feed.
  - `minor_target = minor_native * perUsd[target] / perUsd[native] * 10^(exp[target] - exp[native])`, computed in `bigint` and rounded once, half up.
  - Same currency is an identity step. A missing rate leaves the target empty (`salary.fx.missing_rate`) and does not fail.
- Each annualisation and FX conversion is its own trace step, with the rate and `asOf`/`source` recorded.

### 1.4 Formatting

`formatMoney` and `formatSalary` are pure, with no `Intl`. Examples from the code comments: `₹18–25 L/yr`, `$257K–$335K/yr`, `$40–$55/hr`. INR uses Indian grouping and lakh or crore units for yearly ranges.

### 1.5 Trace example

The salary trace is stored with the job (`salary_trace`). Output of `parseSalaryTraced` and `normalizeSalary` for the text `Compensation: ₹18–25 LPA. This role is based in Bengaluru.`, run on 2026-10-16 against the committed code:

```
salary.num.lpa                  Read 18–25 LPA as ₹18,00,000–₹25,00,000
salary.currency.symbol          Currency INR (symbol)
salary.period.lpa_crore         Period year (lpa crore)
salary.range.dash               Bound range
salary.plausible.annual_range   Annualised amount is plausible for INR
salary.period.identity          Yearly ₹18,00,000–₹25,00,000: already per year
salary.fx.convert               INR → USD at 0.01129944 (fx_rates snapshot, 2026-10-15)
salary.fx.identity              INR is the stated currency; no conversion
```

Stored amounts are minor units: `minMinor` 180000000 and `maxMinor` 250000000 (paise), confidence 0.95. The USD figure is 2,033,898 per year.

The Phase 2 e2e item (`e2e/phase-2-job.spec.ts`, which should show `₹18–25 L/yr`) is not recorded as passing in this document. The engine trace above matches the period and FX steps that item expects.

---

## 2. Requirements

`extractRequirements(doc, skills)` in `requirements.ts`. Rule-only.

### 2.1 Sections

Headings are classified by lexicon, in this order:

1. Not-a-list headings (`statement`, `policy`, `EEO`, `how to apply`, `recruiting`, and similar) become `other`.
2. Compensation (`compensation`, `salary`, `pay range`, `total rewards`).
3. Benefits (`benefits`, `perks`, `what we offer`).
4. Responsibilities, anchored at the start (`what you'll do`, `responsibilities`, `in this role`, `day in the life`).
5. Nice to have (`nice to have`, `bonus`, `preferred`, `a plus`, `not required`, `optional`).
6. Requirements (`qualifications`, `requirements`, `looking for`, `what you'll bring`, `must have`, `about you`, `experience`, `education`, `minimum`).
7. About (`about`, `who we are`).
8. Anything else is `other`.

A section's body runs to the next heading of the same or higher rank.

### 2.2 Items

- Bullets are preferred. Paragraphs are used only in sections with no bullets.
- Label-only lines (a line ending in `:` with three words or fewer) are skipped.
- Items in `requirements` and `nice` sections are candidates. Other sections are ignored.

### 2.3 Must or nice

Parenthetical text is stripped before cue matching.

| Result | Rule id | Confidence |
|---|---|---|
| Both a nice cue and a must cue, with a strong must (`must`, `minimum`, `at least`) before the nice cue | `req.kind.cue_conflict` | 0.8, resolves to must |
| Nice cue (`a plus`, `nice to have`, `bonus`, `ideally`, `preferred`, `an advantage`, `an asset`) | `req.kind.cue_nice` | 0.95 |
| Must cue (`must`, `required`, `requires`, `minimum`, `at least`, `mandatory`, `essential`) | `req.kind.cue_must` | 0.95 |
| No cue | `req.kind.section_default_must` or `_nice` | 0.85 |

### 2.4 Years and category

- `parseYearsMin` finds the first `N+ years` (or `yrs`) phrase, with `N` as digits or words from one to fifteen, or twenty. It counts only when followed by an experience noun or a leading verb such as `in`, `as`, `building`. `years of age` and `years ago` are excluded.
- Category, first match wins:
  1. `authorization` (work authorisation, visa, sponsorship);
  2. `education` (degree names, BS, MS, MBA, coursework);
  3. `language` (a language name with a fluency cue, or `bilingual`);
  4. `location` (`based in`, `relocate`, `on-site in`, `hybrid`, `in-office`);
  5. `experience` (if `yearsMin` is set);
  6. `skill` (if the span contains at least one non-soft skill);
  7. `other`.
- Skills are restricted to the item's own span from the skills pass (§3).

### 2.5 Fallbacks and confidence

- With no requirements or nice section, only bullets that state experience (`N years`, `experience with/in`) are kept, as `must` at confidence 0.5 (`req.fallback.no_section`, `req.fallback.experience_bullet`).
- `lowConfidence` is true when there is no requirements or nice section, or when there are zero must items. That is the only LLM eligibility signal for requirements in Phase 2 (see §5).

Scores on the labelled corpus are in §6.

---

## 3. Skills taxonomy

`data/skills.json` has a `version` field and 1,182 skills. Each skill has an id, label, aliases, category, adjacency list and flags.

- **Categories:** `language`, `framework`, `database`, `cloud`, `tool`, `practice`, `domain`, `soft`.
- **Matching:** aliases go into a case-folded character trie and an exact-case trie. Leftmost-longest resolution applies. Boundaries are word-character based, with extra handling for `C++`, `.NET`, and file-like names such as `file.py`.
- **`caseSensitive`** skills match only their canonical case. `lowercaseOk` adds the lowercase form (`react`, `pandas`). `lowercaseNeedsContext` covers lowercase forms that are also English words (`react to`).
- **`requiresContext`** skills (Go, R, C, Swift, Rust, Spark, Excel, and similar) count only through context rules:
  - `skills.context.list`: the term appears in a skills list;
  - `skills.context.golang`: an unambiguous alias such as `Golang` or `pyspark` (`strongAliases`);
  - `skills.context.paren`: a parenthetical technology list;
  - `skills.context.rejected`: a bare ambiguous hit that is dropped.
- **Adjacency** (`adjacency`) returns `same`, `adjacent` or `none` for two skills. The taxonomy carries an `adjacent` list per skill.
- **Persistence:** `ensureReferenceData` in `enrich-core.ts` calls `seedSkills` with the taxonomy at the start of each enrichment run.

`extractSkills(doc, index, title)` takes the posting title as a second input.

---

## 4. Classifiers

All return a `Classified<value>` with `value`, `evidence` and `trace`.

### 4.1 Level (`classify/level.ts`)

- **Title rules**, with precedence `intern > executive > lead > senior > mid > entry`. The winner is chosen by precedence, not by position. Rule ids are `level.title.*`.
- **Exclusions.** Role names such as `Account Executive`, `Sales Executive`, `Executive Assistant to the CEO` are not executive-level (`level.exclude.*`).
- **Years band**, used only when no title rule matches. The band comes from the highest `yearsMin` among must requirements:
  - 0 to 1: entry;
  - 2 to 4: mid;
  - 5 to 7: senior;
  - 8 or more: lead.
- **Public level** collapses `senior`, `lead` and `executive` to `experienced`.

### 4.2 Workplace (`classify/workplace.ts`)

Candidates, in precedence order:

1. Structured `workplaceRaw` (mapped from ATS values; `workplace.structured_no_signal` and `workplace.structured_unknown` are rejects).
2. Location text: remote, hybrid or onsite markers in `locationsRaw`.
3. Description phrases, first match in document order (`workplace.description_phrase.*`).

The first candidate wins. Disagreement is recorded in `workplace.select`. An `isRemote` hint is ignored when the winner is not remote (`workplace.remote_hint_ignored`). A remote hint alone is recorded as `workplace.remote_hint`.

### 4.3 Employment (`classify/employment.ts`)

- Structured `employmentRaw` is mapped (for example, Ashby `FullTime`, Lever `full time`). An unknown value is rejected (`employment.structured_unknown`).
- Title words for intern, internship, co-op and working student (`employment.title_intern`) override a non-intern structured value (`employment.select`).
- Title words for contract and part-time (`employment.title`).
- Description phrases (`employment.description_phrase`), such as `this is a full-time position`.
- Otherwise `null` (`employment.none`).

### 4.4 Role family (`classify/roleFamily.ts`)

- 27 families, plus `null`. There is deliberately no `other` family. Unassigned is `null`.
- **Title lexicon** (`role.title_lexicon`): 30 patterns in `role-families.json`, specific before generic.
- **Department and team** (`role.department`): 21 patterns, applied after the title lexicon finds nothing.
- **Skill profile** (`role.skill_profile`): a fallback using the extracted skills, at confidence 0.5.
- Otherwise `role.none`.

### 4.5 Visa (`classify/visa.ts`)

Visa is `yes` only on an explicit positive phrase. Any negative phrase beats any positive one.

Sentence by sentence, over the description (quote-folded so that curly apostrophes match):

1. **Application questions are ignored.** A sentence ending in `?`, or starting with `Will you`, `Do you`, `Are you` and so on, is skipped (`visa.question_ignored`). So "Will you now or in the future require sponsorship?" does not count.
2. **Negative phrases** give `no`: `unable to sponsor`, `do not sponsor`, `no sponsorship`, `without sponsorship`, `not require sponsorship`, `sponsorship is not available`, and similar. (`visa.negative`)
3. **Hedged phrases** give `unknown`: `may sponsor`, `case-by-case`, `for exceptional candidates`, `depending on the role`. (`visa.hedged`)
4. **Positive phrases** give `yes` only in a sentence about visas or work authorisation: `visa sponsorship is available`, `we will sponsor`, `open to sponsoring`, `H-1B transfers are welcome`, `relocation and visa support`. A positive phrase negated within 8 tokens before it is reclassified as negative.
5. **Conflict.** If both negative and positive statements appear, the result is `no` (`visa.conflict_negative_wins`).
6. **Nothing found** gives `unknown` (`visa.none`).

Per the PLAN, `unknown` is the default. Nothing is guessed.

### 4.6 Places and countries (`places.ts`)

`resolveCountries(locationsRaw, places, workplace)` maps location strings to ISO country codes through the gazetteer in `data/places.json`. Region words (EMEA, EU, EEA, APAC, LATAM, Americas, North America) expand to member countries. Rule ids: `place.country_name`, `place.cc_prefix`, `place.region`, `place.remote_workplace`, `place.unresolved`, `place.countries`.
Coverage target: a country or `remote: worldwide` on at least 98% of open jobs (§7).

---

## 5. LLM modes

LLM use is optional. The app must run with no key. Modes are implemented in `packages/agent/src/llm/`.

### 5.1 Mode resolution

`resolveLlmMode(env)` in `factory.ts`. The variable is `HIRELANE_LLM_MODE`.

| `HIRELANE_LLM_MODE` | `ANTHROPIC_API_KEY` set | Resolves to |
|---|---|---|
| unset or blank | yes | `anthropic` |
| unset or blank | no | `off` |
| `anthropic` | yes | `anthropic` |
| `anthropic` | no | `off` |
| `fixture` | either | `fixture` |
| `off` | either | `off` |
| anything else, including `auto` and `live` | either | `off` |

The accepted values are `anthropic`, `fixture` and `off`. The `auto` and `live` values named in `docs/architecture.md` §5 are not recognised by the code. `.env.example` ships `HIRELANE_LLM_MODE=auto`, so a copy of that file turns the LLM off even with a key set. This is a known gap (see Known gaps).

### 5.2 Models

- `resolveModels(env)`: `HIRELANE_MODEL_DRAFT` and `HIRELANE_MODEL_BULK`. Blank or unset falls back to `DEFAULT_MODEL`.
- `DEFAULT_MODEL = 'claude-opus-5-5'` (`packages/agent/src/llm/types.ts`). Both tiers default to it. `.env.example` sets both to `claude-opus-5-5`.
- Tiers: `bulk` uses effort `low`; `draft` uses effort `medium`. Default `max_tokens` is 16,000.
- The `bulk` tier is the one `AnthropicProvider` uses for batched extraction and classification. `draft` is intended for later phases; no Phase 2 code path uses it.

`docs/architecture.md` §5 still lists `claude-sonnet-5-5` and `claude-haiku-5-5` as defaults. That is out of date, and the code and `CLAUDE.md` say opus.

### 5.3 Providers

- **`AnthropicProvider`** (`anthropic.ts`). Calls `messages.parse` with a zod output schema. The system prompt is stable and cached (`cache_control: ephemeral`). Job text goes only in the user message.
  - Result mapping: `refusal`, `max_tokens` and `parse_failed` become `unavailable` with the same reason.
  - Exceptions are classified as `rate_limited`, `connection_error`, `server_error` (5xx), `client_error` (other API errors) or `error`.
- **`FixtureProvider`** (`fixture.ts`). Deterministic. Fixtures are keyed by `purpose`. A missing fixture returns `no_fixture`. A fixture is validated against the zod schema. A failed check returns `parse_failed`.
- **`NullProvider`** (`null.ts`). Every call returns `unavailable: off`. Nothing is recorded and nothing leaves the process.
- **Batching.** `extractBatched` splits items into chunks (default 10 per call) and runs them in order.

### 5.4 Prompt construction (untrusted job text)

`buildUserMessage` in `prompt.ts`:

- Each posting goes into its own `<job_posting id="...">` block inside `<untrusted_postings>`.
- Ids must match `/^[A-Za-z0-9_.:-]{1,64}$/`, or the call throws.
- Any literal `job_posting` or `untrusted_postings` tag inside the text is neutralised with a zero-width space, so it cannot close or open a block.
- The message states that block contents are untrusted and must not be followed as instructions.
- The system prompt contains no job text.

### 5.5 What is logged, and what is never logged

Each provider call writes one `llm_calls` row through `createDbCallSink` (`db-sink.ts`). The row is the `LlmCallRecord` type:

- `purpose`, `model`, `mode`, `status`;
- `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`;
- `latencyMs`, `batchSize`, and `at` (set by the database).

The type has no field that could hold prompt, completion or job text.

Never logged, by design and by the code above:

- prompts, system text and completions;
- job description text or any posting content;
- the value of `ANTHROPIC_API_KEY` (the SDK reads it from the environment; no code path writes it out);
- resumes (no resume code exists yet).

Other points, from the code:

- `off` calls (NullProvider), `empty_batch` and `no_fixture` are not recorded. Those return before a row is written.
- Fixture calls are recorded with `model = claude-opus-5-5` (the default model, since the fixture has no model) and zero tokens.
- Sink errors are swallowed (`safeRecord`). Telemetry never breaks extraction.
- Engine traces are a separate store. They keep up to 160 characters of posting text per evidence quote, including in `salary_trace`. That is public job-posting text, not user data, and it is not in `llm_calls`.

### 5.6 Where the LLM is used in Phase 2

Phase 2 does not call the LLM from the worker. `enrichPosting` in `workers/runner/src/tasks/enrich-core.ts` only computes eligibility flags:

- `salary`: true when there is a salary cue but no parse (`salary.cue_without_parse`), or the parse confidence is below 0.7 (`salary.low_confidence`);
- `requirements`: true when `lowConfidence` is set;
- `skills`: always false in Phase 2.

`enrichPosting` returns them as `llmEligibility`. Nothing in `enrich-core.ts` uses them to make a call. The `llm_calls` count must stay at 0 for the Phase 2 coverage check (§7). The LLM validator named in the `salary.ts` header, `validateLlmSalary`, does not exist in the repo.

---

## 6. Dedup

Dedup clusters postings that are the same job. It runs in `dedup.ts` and is composed in `enrich-core.ts`.

### 6.1 Canonical title (`canonicalTitle`)

- Input is NFKC-normalised, lowercased, with `&` turned into `and` and punctuation removed (`+`, `#`, `.` kept inside tokens, so `C++`, `C#`, `.NET`, `node.js` survive).
- Trailing suffixes are stripped, repeatedly, up to 8 times:
  - `(Remote)`, `(London)`, `- New York`, `, Remote` (`title.strip.location`, `title.strip.work_mode`) when the part is a known place or a work-mode word;
  - requisition ids `(R12345)`, `#1234`, `Req-123`, and years in brackets (`title.strip.req_id`).
- Abbreviations are expanded: `sr` to `senior`, `jr` to `junior`, `swe` to `software engineer`, `eng`/`engr` to `engineer`, `mgr` to `manager`.
- Output is the `titleNorm` tokens joined by spaces.

### 6.2 Simhash

- `simhash64(text)`: 64-bit simhash over shingles of **2 words** (`SHINGLE_SIZE = 2`) of the lowercase tokens `[a-z0-9+#]+`. Hashing is FNV-1a 64-bit. Non-ASCII letters act as separators. The hash is stored as hex and as a signed bigint string.
- The code comment records why the shingle is 2, not the 3 the contract asks for. With 3-word shingles, one deleted word touches five features and recall on the labelled pairs is 0.88, under the 0.9 bar. With 2 it is 0.95, and the closest labelled distinct pair is still at Hamming distance 6, above the threshold of 3. With 1 word, boilerplate-heavy postings merge.

### 6.3 Merge rule (`dedupMatch`)

Two postings merge only when all of these hold, checked in order. Each failed check gives a reason:

1. **Same company** (`company_differs`). Different companies are never merged.
2. **Same canonical title** (`title_differs`).
3. **Both descriptions at least 40 tokens** (`insufficient_text`, `DEDUP_MIN_TOKENS`).
4. **Hamming distance at most 3** (`distance_exceeds`, `DEDUP_MAX_HAMMING`).

When a cluster forms, `pickPrimary` picks the member with the earliest `firstSeenAt`, with `postingId` as the tie-break. Other postings link to that job. The coverage report counts merged postings separately.

### 6.4 Evaluation

The labelled pairs are in `packages/engine/test/corpus/dedup.pairs.jsonl`: 200 pairs (`merge` and `distinct`), labelled 2026-10-16 by a Claude agent with a rule-based oracle. The file header describes how pairs were built.

The gate is in `packages/engine/test/dedup.test.ts`, lines 307 to 311. It requires 0 false merges and recall of at least 0.9. It runs under `vitest` in `pnpm --filter @hirelane/engine test`. It is **not** printed by `pnpm engine:eval`, and no `scripts/evals/` directory exists. The recall figure of 0.95 quoted above is the value recorded in the code comment at `SHINGLE_SIZE = 2`. This document did not re-run that test for the number.

---

## 7. Thresholds and how to check them

### 7.1 `pnpm engine:eval`

Runs `packages/engine/scripts/eval.ts` through `vite-node`. It exits 0 when every gate passes and 1 otherwise. Thresholds are in `packages/engine/scripts/score.ts`:

| Metric | Threshold |
|---|---|
| Salary precision | at least 98% |
| Salary recall | at least 95% |
| Salary period and currency accuracy | at least 98% |
| Requirements micro F1 | at least 85% |

Observed run on 2026-10-16:

```
salary  (420 snippets, 289 stated; labelled 2026-10-16 by Claude (Sonnet 5.5, tdd-guide agent) ...)
  precision 100.00%  (>= 98.00%)  PASS
  recall    100.00%  (>= 95.00%)  PASS
  period+currency accuracy 100.00%  (>= 98.00%)  PASS
requirements  (60 postings, 553 labelled items; labelled 2026-10-16 ...)
  micro F1 97.65%  (>= 85.00%)  PASS   P 97.48%  R 97.83%   must F1 97.75%  nice F1 97.36%
engine:eval PASS
```

The salary numbers are 100% on a corpus the same team labelled. They measure agreement with those labels, not independent accuracy (see Known gaps).

Residual requirements misses on the same run:

- `rq-8`: a 4+ years client-facing item, labelled must, extracted as nice.
- `rq-42`: a coursework item, labelled must, extracted as nice.
- `rq-46`: two items, one labelled must and extracted as nice, one likewise. Both are must/nice confusions.
- `rq-20`: an extra must, on a generative AI item.
- `rq-47`: an extra must, a location-tier list (`Tier 1: San Francisco, ...`).

Other suites run under `vitest`:

- `pnpm --filter @hirelane/engine test`: 675 tests in 10 files, all passing on 2026-10-16.
- `pnpm --filter @hirelane/agent test`: 31 tests in 4 files, all passing on 2026-10-16.
- Corpus provenance tests (`packages/engine/test/corpus.test.ts`) check labeller and date headers and corpus sizes.

### 7.2 `pnpm report:coverage`

Runs `scripts/report-coverage.ts` through `vite-node`. It reads the database in `DATABASE_URL` (from `.env.local`) and writes only SELECTs. It exits 1 when any check fails. The query is `coverageStats` in `packages/db/src/enrich/coverage.ts`. Open jobs only, unless stated.

Checks and targets, from `scripts/report-coverage-lib.ts`:

| Check | Target |
|---|---|
| Salary captured divided by salary stated anywhere (the ceiling) | at least 50% |
| Salaried jobs with no `salary_trace` | 0 |
| Jobs with at least one must-have requirement | at least 90% |
| Jobs with a country, or `remote_scope = worldwide` | at least 98% |
| Jobs with a role family | at least 95% |
| Open postings not linked to a job | 0 |
| `llm_calls` rows | 0 |

The report also prints the salary ceiling and the parsed share. The ceiling is the share of jobs whose text or structured data states pay anywhere. The parsed share is the share of all open jobs with a parsed salary. Reporting both shows how much of the gap is the parser's and how much is postings with no pay.

Observed on 2026-10-16 against the dev database, the run that created these figures (not the full committed fixture set, which is the PLAN wording):

```
Hirelane enrichment coverage (open jobs)

  open jobs                         16320
  postings                          18813 open / 18813 total, 18813 linked
  dedup clusters                    1503 jobs hold 2493 merged postings

  Salary
    stated anywhere (ceiling)       13120  80.4% of all jobs
    parsed into a salary            10663  65.3% of all jobs
    captured / ceiling              81.3%   <- gated at >= 50.0%

  workplace known                   63.0%
  level known                       79.2%

  PASS  Salary captured / stated-anywhere ceiling       81.3%   (target >= 50.0%)
  PASS  Salaried jobs missing a salary_trace                0   (target = 0)
  PASS  Jobs with >= 1 must-have requirement            95.9%   (target >= 90.0%)
  PASS  Jobs with a country or remote:worldwide        100.0%   (target >= 98.0%)
  PASS  Jobs with a role family                         98.6%   (target >= 95.0%)
  PASS  Open postings not linked to a job                   0   (target = 0)
  PASS  llm_calls rows                                      0   (target = 0)

  llm_calls=0
RESULT: PASS
```

Two notes. The run is against whatever data the dev database holds, so the figures will move as ingest and enrichment run again. And the PLAN's Phase 2 acceptance item for `report:coverage` is ticked in PLAN.md with figures recorded there, which this document does not reproduce.

### 7.3 Running enrichment

- `pnpm enrich:run [--concurrency=4] [--company=<uuid>] [--version=<n>]` runs the same enrichment code path as the `enrich:company` task, in-process. It never calls an LLM.
- The worker path is `enrich:schedule` (fan-out) and `enrich:company` (per company, serialised clustering). Postings are reselected only when their content hash or `ENRICH_VERSION` changes. `ENRICH_VERSION = 1` (`packages/engine/src/version.ts`). Bumping it re-enriches everything.

---

## 8. Known gaps

1. **The LLM is not called anywhere in enrichment.** `enrichPosting` only records eligibility. The providers exist and are tested, but nothing in `workers/` or `apps/` imports `@hirelane/agent` yet. Phase 2 acceptance requires `llm_calls = 0`, so this is consistent with the plan, not a regression.
2. **`validateLlmSalary` does not exist.** `salary.ts` says an LLM proposal enters through it. There is no such function in the repo. Treat it as planned.
3. **`HIRELANE_LLM_MODE=auto` in `.env.example` resolves to `off`.** The code accepts only `anthropic`, `fixture` or `off`. Copying the example file therefore disables the LLM even when `ANTHROPIC_API_KEY` is set. `docs/architecture.md` §5 says `auto` resolves to fixture when no key is present. Neither matches the code.
4. **Both labelled corpora were written by a Claude agent.** The salary corpus (420 snippets) and the requirements corpus (60 postings) were labelled 2026-10-16 by Claude (Sonnet 5.5, tdd-guide agent), per their headers. The 100% salary scores measure agreement with those labels, not independent accuracy. A human pass on a sample is still needed.
5. **Requirements misses** on the labelled corpus (§7.1): must and nice swaps on `rq-8`, `rq-42` and `rq-46`, and extra items `rq-20` and `rq-47`. Micro F1 is 97.65%, above the 85% gate.
6. **FX and salary bounds are hand-set.** `data/fx_rates.json` is an illustrative snapshot, not a market feed. `data/salary-bounds.json` is hand-set per currency. Converted USD and INR figures are only as good as those tables.
7. **Unsupported currencies return `null`.** Only the 21 ISO codes listed in §1.2 are parsed. A posting quoting, for example, `IDR` or `NGN` gets no salary parse. Structured compensation with an unsupported currency falls back to the text parser (`salary.currency.unsupported`).
8. **Dedup is gated only in `vitest`.** `pnpm engine:eval` does not print dedup results, and `scripts/evals/` does not exist. The recall figure in §6.4 comes from the code comment, not a run in this document.
9. **Shingle size is 2, not the contract's 3.** This is a documented deviation (§6.2), tested by the 200-pair gate.
10. **Engine clock and randomness ban is not enforced.** `docs/architecture.md` §7 item 5. Nothing in the dependency rules or a guard script blocks `Date.now`, `Math.random` or similar in `packages/engine/src`.
11. **Node builtins are not forbidden for the engine.** `.dependency-cruiser.cjs` forbids `pg`, `drizzle-orm` and `graphile-worker` in `packages/engine/src`, not Node builtins such as `net`.
12. **Phase 2 UI and e2e are not confirmed here.** `apps/web/app/job/`, `e2e/phase-2-job.spec.ts` and the screenshots are present as uncommitted files. This document did not run Playwright, and PLAN.md's e2e checkbox is still open.
13. **Engine coverage target is not measured here.** PLAN asks for at least 90% line coverage on `salary.ts`, `requirements.ts` and `dedup.ts`. Run `pnpm --filter @hirelane/engine test:coverage` to check.
14. **Classifiers outside Phase 2 are not built.** `match`, `autopilot`, `replies` and `questions` appear in `docs/architecture.md` §6 as planned.
15. **Trace evidence stores posting text.** Up to 160 characters per quote go into `salary_trace` and requirement evidence. That is public job text, and it is persisted in `salary_trace`. The PLAN's "no content in logs" rule covers logs and `llm_calls`, not traces. Confirm that is the intended reading.
