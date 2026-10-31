# Public jobs API

> Status: built (Phase 3), reconciled against the working tree on 2026-10-16. Sources: `apps/web/app/api/public/`, `apps/web/lib/public-api-params.ts`, `apps/web/lib/queries/jobs.ts`, `apps/web/lib/openapi.ts`, `apps/web/lib/llms.ts`, `apps/web/middleware.ts`.
> The machine-readable contract is `GET /openapi.json` (also rendered at `/api-docs`). Field-level JSON Schema for the list envelope and the job detail is `apps/web/lib/contracts/jobs.schema.json`.

Read-only JSON about open jobs, for people, scripts and AI agents. No key, no sign-in, no application submission.

This file covers the public jobs surface (§1 to §13). The signed-in **v1 API** (accounts, resumes, eligibility, builder, consent, export and delete, the campus student side, the TPO console and auto-apply) is a separate surface with its own OpenAPI document, described in §14.

---

## 1. Endpoints

Only the two job endpoints below exist today. PLAN §7.1 also lists companies, facets and status; none of those routes is built (see §12).

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/public/jobs` | Paginated list envelope (§3, §4) |
| `GET` | `/api/public/jobs/{slug}` | One job with description, requirements, salary trace and sources (§5) |
| `OPTIONS` | either path | `204`, CORS preflight only (§8) |
| `GET` | `/openapi.json` | OpenAPI 3.1 document for the two operations above |
| `GET` | `/api-docs` | HTML page that summarises the same API |
| `GET` | `/llms.txt` | Plain-text guide for agents, including the parameter list (§10) |
| `GET` | `/sitemap.xml` | Sitemap index (§10) |

The public API defines no `POST`, `PUT`, `PATCH` or `DELETE` on these paths. Nothing in it writes data.

`HEAD` is not documented. Do not rely on it until it is tested.

---

## 2. Base address

The origin comes from the `APP_ORIGIN` environment variable (default `http://localhost:3001`, trailing slashes removed). It is used in `links`, `url`, `markdownUrl`, the OpenAPI `servers` entry, `llms.txt` and the sitemap. Set it in production, or those links point at localhost. `/openapi.json` is statically generated and `/api-docs` is revalidated hourly, so for those two the value is read when the page is built, and a change needs a rebuild or the revalidation window. The other endpoints read it per request.

---

## 3. `GET /api/public/jobs`: parameters

Parameters are query-string values. Names and vocabulary match the `/jobs` page, plus four API-only parameters (`company`, `min_pay`, `currency`, `page_size`). The order below is the order in `API_PARAM_ORDER`, and it is the order used by `/openapi.json` and `/llms.txt`.

| Name | Type and allowed values | Default | Meaning |
|---|---|---|---|
| `q` | string, 1 to 100 characters after trimming | none | Free text. See the rules below. |
| `role` | a role family slug, for example `data-engineer` | none | Must be one of the 27 role families. Other values give `400`. |
| `country` | ISO 3166-1 alpha-2, for example `IN` | none | Must be in the places gazetteer. Case does not matter. The job must name this country. Worldwide-remote jobs are reached with `remote=1`. |
| `remote` | `1`, `true`, `0`, `false` | off | `1` or `true` keeps remote jobs only. `0` or `false` is the same as omitting it. |
| `salary` | `1`, `true`, `0`, `false` | off | `1` keeps jobs that state pay. |
| `workplace` | `remote`, `hybrid`, `onsite` | none | Workplace type. |
| `employment` | `fulltime`, `contract`, `parttime`, `intern` | none | Employment type. |
| `level` | `entry`, `mid`, `experienced`, `intern` | none | `experienced` covers senior, lead and executive. |
| `visa` | `1`, `true`, `0`, `false` | off | `1` keeps jobs that mention visa sponsorship. |
| `posted` | integer 1 to 365 | none | Posted (or first seen, when the posting has no date) within this many days. |
| `page` | integer 1 to 100 | `1` | 1-based page. Pages past the last return an empty list with the true `total`. |
| `sort` | `fresh`, `pay` | `fresh` | `fresh` is newest first. `pay` is highest annual pay floor first, in `currency`. Jobs with no stated pay come last. |
| `company` | company slug, `^[a-z0-9][a-z0-9-]{0,199}$` | none | Jobs from one company. Must be a slug, not a display name. |
| `min_pay` | integer 1 to 1,000,000,000 | none | Annual pay floor in whole major units (dollars, rupees). Keeps jobs whose top of range is at or above it. Jobs with no stated pay are excluded. |
| `currency` | `USD`, `INR` | `USD` | Currency used by `min_pay` and `sort=pay`. Case does not matter. |
| `page_size` | integer 1 to 100 | `50` | Jobs per page. |

### 3.1 Parsing rules

- **Strict.** An invalid value returns `400` and names the parameter. Invalid values are never dropped silently.
- **Unknown parameters are ignored.** Tracking parameters such as `utm_source` do no harm.
- **First occurrence wins.** `?role=a&role=b` uses `role=a`. The check does not look at later occurrences.
- **Empty values are invalid.** `q=` returns `400`. A parameter that is absent is not validated.
- **`q` normalisation.** The value is NFKC-normalised, trimmed, whitespace runs are collapsed to one space, and it is lower-cased. The 100-character limit applies after trimming.
- **`q` matching.** The text is split on whitespace. Words shorter than 2 characters are ignored. Only the first 4 words are used. Each remaining word must appear (case-insensitive substring match) somewhere in the job's searchable text, which covers title, company and skills. A `q` made only of 1-character words does not filter. Words after the fourth are ignored, not rejected. LIKE wildcards in the input are escaped and match literally.
- **`country` and `currency` are upper-cased** before checking.
- **`remote=1` with `workplace=remote`** collapses to one filter. Any other combination that contradicts itself (for example `remote=1&workplace=onsite`) is kept and returns an honestly empty list.
- **`page` above 100** returns `page_out_of_range`. A non-numeric or `0` value returns `invalid_param`.

### 3.2 Example

```
GET /api/public/jobs?country=IN&remote=1&sort=pay&currency=INR&min_pay=2500000&page_size=20
```

---

## 4. List response

Status `200`, `Content-Type: application/json; charset=utf-8`.

```json
{
  "jobs": [ { "slug": "...", "title": "...", "salary": { "...": "..." }, "...": "..." } ],
  "page": 1,
  "pageSize": 20,
  "pages": 7,
  "total": 131,
  "links": {
    "self": "/api/public/jobs?country=IN&remote=1&sort=pay&min_pay=2500000&currency=INR&page_size=20",
    "next": "/api/public/jobs?country=IN&remote=1&page=2&sort=pay&min_pay=2500000&currency=INR&page_size=20",
    "prev": null
  }
}
```

- `total` is the true number of matches. `pages` is `ceil(total / pageSize)`, at least 1, and never more than 100 (`pages` is capped at the page limit even when `total` is larger).
- `links` are relative paths in canonical form (defaults dropped, booleans written as `1`). `next` is `null` on the last page; `prev` is `null` on page 1.
- Each job in `jobs`:

| Field | Notes |
|---|---|
| `slug` | Stable identifier, used in `/api/public/jobs/{slug}` |
| `url` | Absolute HTML page, `{origin}/job/{slug}` |
| `markdownUrl` | Absolute markdown form, `{origin}/job/{slug}.md` |
| `title`, `company` | `company` is `{ slug, name, logoUrl }`; `logoUrl` is `null` when the company has no logo |
| `roleFamily`, `level`, `workplace`, `employment` | Classified values; may be `null` when the posting does not say |
| `remote`, `remoteScope`, `countries`, `locations`, `visa` | Location and eligibility facts from the posting |
| `salary` | `null` when no pay is stated. Otherwise `min`, `max` (integer minor units), `currency`, `period`, `kind`, `display` (formatted string), `annualUsd` and `annualInr` (each `{min, max}` or `null`, converted at the dated rate), `source`, `fxDate` |
| `skills` | Skill labels in posting order |
| `postedAt`, `firstSeenAt`, `lastSeenAt`, `freshAt` | ISO 8601 timestamps. `freshAt` is `postedAt`, or `firstSeenAt` when there is no posted date |
| `ats` | Source board: `greenhouse`, `lever` or `ashby` |
| `fixture` | `true` for jobs from recorded fixture data, not live boards |

The full field list and types are in `apps/web/lib/contracts/jobs.schema.json` (the list envelope) and `/openapi.json`.

### Money

Amounts are integers in minor units of the stated currency (cents, paise). `display` is the human string. Pay is shown only when the posting states it. Nothing is estimated. `annualUsd` and `annualInr` are conversions made at the rate dated `fxDate`.

---

## 5. `GET /api/public/jobs/{slug}`

- `slug` must match `^[a-z0-9][a-z0-9-]{0,199}$`. A value that does not match gets `404`, not `400`.
- Returns a job in the same shape as §4, plus:

| Field | Notes |
|---|---|
| `descriptionMd` | Cleaned description as markdown, or `null` |
| `requirements` | `[{ kind: "must" \| "nice", text, category, yearsMin, spanStart, spanEnd }]` in posting order |
| `salaryTrace` | Steps that show how the pay was read, or `null` |
| `sources` | `[{ ats, url }]` for every open posting of the job. The URL is the apply link when the board provides one, otherwise the posting URL |
| `closedAt` | ISO 8601 when the job has closed, otherwise `null` |

- **Closed jobs are served.** A closed job returns `200` with `closedAt` set, so links from search results do not break. The list endpoint never returns closed jobs.
- Unknown slugs return `404` with code `not_found`.

---

## 6. Errors

Every error body has this shape:

```json
{ "error": { "code": "invalid_param", "message": "page_size must be an integer from 1 to 100", "param": "page_size" } }
```

`param` is present only for parameter errors.

| Status | `code` | When |
|---|---|---|
| `400` | `invalid_param` | A parameter value is not allowed. `param` names it. |
| `400` | `page_out_of_range` | `page` is above 100. |
| `404` | `not_found` | No job with that slug (job endpoint only). |
| `429` | `rate_limited` | Over the request limit (§7). `Retry-After` is set. |
| `500` | `internal_error` | Unexpected failure. The message is generic and no detail leaks. |

Error responses carry `Cache-Control: no-store` and the CORS headers of §8.

---

## 7. Rate limits

- **Limit:** 60 requests per minute per client. Fixed one-minute windows, counted in the `rate_limits` table with one atomic upsert.
- **Counted before validation.** The limit check runs before parameters are parsed, so a `400` also uses one request. `OPTIONS` requests are not counted.
- **Headers on every `200`, `304`, `400` and `429` from the list and job endpoints** (omitted only when the limiter is unavailable, see below):
  - `RateLimit-Limit`: the limit (`60`)
  - `RateLimit-Remaining`: requests left in the current window
  - `Retry-After` (only on `429`): seconds until the window resets, at least 1
- **Client identity** comes only from the configured proxy depth, `TRUST_PROXY_HOPS` (0 to 10, default `0`).
  - `0` (default): `X-Forwarded-For` is never read. Every client shares one bucket, which is safe against spoofing but makes the limit global.
  - `N >= 1`: the address N places from the right of `X-Forwarded-For` is used. Entries to its left are ignored because the client controls them.
  - IPv6 clients are bucketed by their `/64` prefix.
- **Operators:** running `next start` without a proxy in front, with `TRUST_PROXY_HOPS` unset, gives one shared bucket. Set the hop count to match the real proxy chain.
- **Fail open.** If the limiter cannot reach the database, the request is served and the error is logged. This is a public, read-only API.

---

## 8. CORS

Applies to every public API response, including errors, `304` and `/openapi.json`:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, HEAD, OPTIONS
Access-Control-Allow-Headers: If-None-Match, Accept
Access-Control-Expose-Headers: ETag, Retry-After, RateLimit-Limit, RateLimit-Remaining
Access-Control-Max-Age: 86400
```

- Any origin may call the API from a browser. Credentials are never sent or accepted (no `Access-Control-Allow-Credentials`).
- `OPTIONS` returns `204` with the headers above and no body.
- `ETag`, `Retry-After` and the rate-limit headers are readable from browser code because they are exposed.

---

## 9. ETag and caching

- Every `200` and `304` from the two JSON endpoints carries `ETag`. The value is a weak validator: `W/"<sha1 of the JSON body>"`.
- Send it back as `If-None-Match`. An unchanged body returns `304` with no body. The `ETag`, `Cache-Control`, rate-limit and CORS headers are still sent on `304`.
- Comparison is weak (RFC 9110 §13.1.2): the `W/` prefix is ignored. `*` matches any representation. A comma-separated list is accepted.
- `Cache-Control: public, s-maxage=300, stale-while-revalidate=60` on `200` and `304`. Errors use `no-store`.
- `/openapi.json` is static (`Cache-Control: public, s-maxage=3600`).

---

## 10. Markdown, llms.txt and sitemaps

### 10.1 Markdown negotiation for jobs

The HTML job page is `/job/{slug}`. The same job is available as markdown in two ways:

- `GET /job/{slug}.md`
- `GET /job/{slug}` with an `Accept` header that prefers `text/markdown`

Rules (`apps/web/lib/negotiate.ts`, applied in `apps/web/middleware.ts`):

- Markdown is served only when `text/markdown` has a **strictly higher** q-value than `text/html`. A tie, a wildcard (`*/*`, `text/*`) or a missing header gives HTML.
- A q-value is taken from the most specific matching range: exact type, then `type/*`, then `*/*`. A malformed q-value makes that range ignored.
- The markdown response has `Content-Type: text/markdown; charset=utf-8`, `Vary: Accept`, `X-Robots-Tag: noindex`, `X-Content-Type-Options: nosniff`, `Cache-Control: public, s-maxage=300, stale-while-revalidate=60`, a weak `ETag` (`W/` plus a base64url SHA-1 of the body) and `Link: <{origin}/job/{slug}>; rel="canonical"`.
- `If-None-Match` that matches the ETag (or `*`) returns `304` with no body. `HEAD` is implemented for the markdown route: same status and headers, no body.
- The HTML response for `/job/{slug}` gets `Vary: Accept` and `Link: </job/{slug}.md>; rel="alternate"; type="text/markdown"`. The HTML page stays the canonical address.
- Direct requests to `/md/*` return `404`. That path is internal.
- Unknown or invalid slugs return a markdown `404` body.
- Closed jobs have a markdown form too.

### 10.2 llms.txt

- `GET /llms.txt`: `text/plain; charset=utf-8`, `Cache-Control: public, s-maxage=3600`.
- It follows the llmsTxt shape: an H1, a blockquote summary and H2 sections.
- Its parameter list is generated from the same `API_PARAM_ORDER` constant as the API, and the test in §11 compares it with `/openapi.json`.
- It says that Hirelane does not submit applications and that agents must not apply for a person without that person's approval.

### 10.3 Sitemaps

- `GET /sitemap.xml` is an index. Entries point to `/sitemaps/jobs/{n}.xml`, `/sitemaps/companies.xml` and `/sitemaps/lists.xml`.
- Job chunks hold up to 50,000 URLs each. Members are open jobs only, ordered by primary key, so a job's chunk is stable while the data is. Closed jobs never appear.
- `lastmod` comes from `content_updated_at`. A re-check that changes nothing does not move it.
- `companies.xml` lists company pages that have at least one open job.
- `lists.xml` lists `/lists` and only the lists with at least 20 open jobs.
- Chunk names are `{n}.xml` with a 1-based number of up to four digits. Anything else returns `404`. A chunk past the last returns `404`.
- Responses are `application/xml; charset=utf-8` with `Cache-Control: public, s-maxage=3600, stale-while-revalidate=600`. A database error returns `503` with `Retry-After: 300` and no error text.

### 10.4 robots.txt

Allows the public board and `/api/public/`. Disallows `/api/` (other than `/api/public/`), `/ops/`, `/applications`, `/triage` and `/md/`. Points to `/sitemap.xml`.

---

## 11. Keeping llms.txt and openapi.json in sync

`apps/web/tests/llms-openapi-sync.test.ts` reads the list endpoint's query parameters from the `/openapi.json` route handler and the parameter bullets from `llmsTxt()`, then requires the same names in the same order. It fails on a renamed, dropped, added or reordered parameter. It also includes negative cases that prove the comparison can fail.

Run it with:

```
pnpm --filter @hirelane/web exec vitest run tests/llms-openapi-sync.test.ts
```

The parameter list has one source (`API_PARAM_ORDER` in `apps/web/lib/public-api-params.ts`), so the test guards against edits to the descriptions or to `llms.ts` that would reintroduce a stale name.

---

## 12. Known gaps

These are described in PLAN §7.1 but are not built. Do not document them as available.

| Item | Status |
|---|---|
| `GET /api/public/companies`, `GET /api/public/companies/{slug}` | Not built. The company pages exist as HTML only. |
| `GET /api/public/status` | Not built. |
| `GET /api/public/facets` | **Not built, but advertised.** `/llms.txt` lists it under "Public API" as "Facet counts". Requests return `404`. Either build the route or remove the line from `apps/web/lib/llms.ts`. This is outside the Phase 3 docs scope and is not fixed here. |
| `HEAD` on the JSON endpoints | Not verified. |

---

## 13. Related

- `docs/architecture.md` §6: codemap for the board and the API routes.
- `PLAN.md` §7: intended API surface. Where this file and PLAN differ, this file describes the code.
- `docs/ingest.md`: where job data comes from and how closed jobs are detected.

---

## 14. v1 API (signed in, accounts)

> Status: the base routes (§14.1 to §14.5) were built in Slice 3, uncommitted, 2026-10-29. The campus, TPO and apply routes (§14.6 to §14.8) were added in Slice 4, uncommitted, 2026-10-31. Sources: `apps/web/app/api/v1/**` (43 route files, including `openapi.json`), `apps/web/lib/openapi-v1.ts` (the operation list), `apps/web/lib/http` (the v1 wrapper, problem responses), `packages/services/src` (the logic). The route files are thin adapters: they parse, call a service, and map the result (`api-v1-thin` in `.dependency-cruiser.cjs`).

This surface is for the signed-in student and their own data. It is **not** the public jobs API above. It has its own OpenAPI document, served at `GET /api/v1/openapi.json`. That document is built from the zod schemas. It does not include `/openapi.json`, which describes only the public jobs endpoints.

### 14.1 Operations

Every server action that changes data has a v1 twin. `apps/web/tests/api-v1-parity.test.ts` enforces this: each exported action maps to a v1 operation, or to a written exemption.

| Method | Path | `operationId` | Mutation | Notes |
|---|---|---|---|---|
| `GET` | `/api/v1/resumes` | `listResumes` | no | Summaries only |
| `POST` | `/api/v1/resumes` | `uploadResume` | yes | Raw body, PDF or DOCX, 5 MiB. Returns 202 |
| `GET` | `/api/v1/resumes/{id}` | `getResume` | no | Opened, masked parse |
| `DELETE` | `/api/v1/resumes/{id}` | `deleteResume` | yes | Soft delete, purge within 24 h |
| `POST` | `/api/v1/resumes/{id}/confirm` | `confirmResume` | yes | New version, made default, eligibility upserted |
| `GET` | `/api/v1/resumes/{id}/file` | `downloadResume` | no | Original bytes, audited |
| `GET` | `/api/v1/eligibility` | `getEligibility` | no | Profile or null |
| `PUT` | `/api/v1/eligibility` | `saveEligibility` | yes | Counts as confirmation |
| `POST` | `/api/v1/builder/steps` | `saveBuilderStep` | yes | One builder answer |
| `POST` | `/api/v1/builder/finish` | `finishBuilder` | yes | Queues the render. Returns 202 |
| `GET` | `/api/v1/me` | `getMe` | no | The signed-in user |
| `DELETE` | `/api/v1/me` | `deleteMe` | yes | Needs `confirm: true`. Removes files, then the account |
| `POST` | `/api/v1/me/consents` | `setConsent` | yes | Append-only. Unknown kinds are refused |
| `GET` | `/api/v1/me/export` | `exportMe` | no | Everything held about the user. No blob key and no file hash |

The OpenAPI document is `GET /api/v1/openapi.json`. Like every v1 route, it returns 404 while the accounts flag is off, so the surface is not published before launch.

### 14.2 Authentication

- **Session cookie only.** Requests are authenticated by the `__Host-` session cookie (`withAuth`, `lib/auth/session.ts`). No cookie, a garbage cookie, or a `Bearer` header each return 401 (`api-v1.test.ts`, "no session, a garbage cookie and a Bearer header are all 401").
- **Bearer tokens are not built.** Opaque Bearer tokens for Android are designed in the plan and are scheduled for C3 (`sessions.client` ships in migration 0008). Do not document them as available.
- **Flag off.** Every v1 route returns 404 as `problem+json` (`api-v1.test.ts`, "flag off: 404 problem+json").

### 14.3 Requests

- **Mutations** need an `Origin` header that matches the app origin, and an `Idempotency-Key` header. Reads need neither (`api-v1.test.ts`, "mutations need the same Origin and an Idempotency-Key; reads need neither").
- **Idempotency.** A replayed key returns the stored response, and no second job is queued. The same key with a different body is `idempotency_key_reuse` 422. A key that is still in progress is `idempotency_in_progress` 409. A key that is reused with a different `?label=` is a client bug, so it is 422 and not a replay. Keys are swept after 24 hours (`idempotency:sweep`).
- **Bodies.** Input schemas are strict. An unknown field such as `userId` is a 400, so a client cannot name another user. A non-JSON body, or one over its limit, is refused.
- **Rate limits** are per user, and a limited response carries `Retry-After`.

### 14.4 Responses and errors

- Every error is `application/problem+json` and carries a request id. Issue paths name the field, not the value (`api-v1.test.ts`, "every error is problem+json with a request id").
- An unknown failure is a bare 500 with no message. The message is never sent.
- Cross-user access is **404**, not 403. A resume, version or draft that belongs to someone else looks the same as one that does not exist. This is covered for get, delete, download and builder steps (`api-v1.test.ts`, "a forged user id in a body or a blob key cannot reach another user", and the builder "only the owner's draft can be edited or finished").
- Other codes used by the v1 services: `invalid_input` 400 with issues, `file_too_large` 413, `bad_file_type` 415, `duplicate_resume` 409, `too_many_resumes` 409, `stale_parse` 409, `not_confirmable` 409, `incomplete_draft` 422, `queue_unavailable` 503 (the row exists and can be re-queued).

### 14.5 Known gaps

- Bearer auth for Android (C3).
- Actions that have no v1 twin are listed as written exemptions in `apps/web/lib/api/parity.ts` (`ACTION_EXEMPT`). Each exemption needs a reason there.
- The "every action has a v1 twin" check is a test, not a dependency rule. A new action file is caught only when the test runs in `pnpm verify`.

### 14.6 Campus (student)

Membership, joining, the share level, the access log, the drive inbox and outcomes. Every route here follows §14.2 to §14.4. The rules behind them are in `docs/campus.md`.

| Method | Path | `operationId` | Mutation | Success | Notes |
|---|---|---|---|---|---|
| `GET` | `/api/v1/campus/me` | `getMyCampus` | no | 200 | My membership, or `null` |
| `DELETE` | `/api/v1/campus/me` | `leaveCampus` | yes | 200 | Leaves the campus. `false` when I had no seat |
| `POST` | `/api/v1/campus/join` | `joinCampusByCode` | yes | 200 | Body `code` (8 characters) and optional `cohortId`. Without a cohort it returns the cohorts to choose from |
| `POST` | `/api/v1/campus/join/email` | `startCampusEmailJoin` | yes | 200 | Body `email`. Mails a six-digit code to a registered college domain |
| `POST` | `/api/v1/campus/join/email/verify` | `verifyCampusEmailJoin` | yes | 200 | Body `email`, `code` (six digits), `cohortId`. Joins as `email`, or as `roster` when the mailbox is on the roster |
| `PUT` | `/api/v1/campus/share` | `setShareLevel` | yes | 200 | Body `level`: `aggregate`, `outcomes` or `full`. Recorded as a consent |
| `GET` | `/api/v1/campus/access-log` | `listAccessLog` | no | 200 | Every TPO read of my data, newest first. Shows no reader |
| `GET` | `/api/v1/campus/drives` | `listMyDrives` | no | 200 | My drive inbox: drives I am eligible for or not yet known to fail, with the reasons |
| `GET` | `/api/v1/campus/outcomes` | `listMyOutcomes` | no | 200 | My reported interviews and offers |
| `POST` | `/api/v1/campus/outcomes` | `reportOutcome` | yes | 201 | Body `kind` (`interview` or `offer`), `employer`, optional `roleTitle` and `packageLpa`. Starts as `student_reported` |
| `POST` | `/api/v1/campus/outcomes/{id}/letter` | `attachOutcomeLetter` | yes | 200 | Offer letter as a raw PDF, at most 2 MiB. Sealed |

Errors: `invalid_code` 400, `invalid_cohort` 400, `invalid_email` 400, `rate_limited` 429, `try_again_shortly` 429, `already_member` 409, `seat_taken` 409, `not_in_campus` 409, `too_many_outcomes` 409 (50 per student), `not_a_college_email` 422, `mail_unavailable` 503, `file_too_large` 413, `bad_file_type` 415.

### 14.7 TPO console

Staff only. A caller who does not staff the campus gets the same 404 as a stranger, on every route here. Every call first claims a pending invite for the caller's verified email. Where a route takes `campusId`, it is a query parameter or a body field. If the caller staffs several campuses and omits it, the answer is `400 campus_required`. The owner-only rules are in `docs/campus.md` §6.

| Method | Path | `operationId` | Mutation | Success | Notes |
|---|---|---|---|---|---|
| `GET` | `/api/v1/tpo/me` | `getTpoMe` | no | 200 | Campuses I staff, empty for a student. Writes when an invite is claimed |
| `GET` | `/api/v1/tpo/cohorts` | `listTpoCohorts` | no | 200 | `campusId`. Cohorts with the joined count, rounded and suppressed |
| `POST` | `/api/v1/tpo/cohorts` | `createTpoCohort` | yes | 201 | Body `passoutYear`, `programme`, optional `campusId`. 200 when it already existed |
| `GET` | `/api/v1/tpo/cohorts/{id}/stats` | `getCohortStats` | no | 200 | Fixed metrics from the latest snapshot. Optional `metric` |
| `POST` | `/api/v1/tpo/cohorts/{id}/roster` | `importRoster` | yes | 200 | Raw CSV body, at most 1 MiB. Stages the roster only |
| `GET` | `/api/v1/tpo/drives` | `listTpoDrives` | no | 200 | `campusId`. Drives published for the campus |
| `POST` | `/api/v1/tpo/drives` | `publishDrive` | yes | 201 | Body `cohortId`, `title`, `noticeText`, optional `link` (stored, never fetched). Returns the parsed criteria and scam flags |
| `GET` | `/api/v1/tpo/drives/{id}` | `getDriveCounts` | no | 200 | Eligible, unknown and ineligible counts. Suppressed like the stats. A drive whose counts were not released (see `docs/campus.md` §5) shows no numbers |
| `GET` | `/api/v1/tpo/outcomes` | `listTpoOutcomes` | no | 200 | Outcomes of students at `outcomes` or `full`. Optional `cohortId`. Writes one access-log row per student listed |
| `POST` | `/api/v1/tpo/outcomes/{id}/verify` | `verifyOutcome` | yes | 200 | Marks the outcome `tpo_verified` |
| `GET` | `/api/v1/tpo/outcomes/{id}/letter` | `downloadOutcomeLetter` | no | 200 | PDF, only when the student has consented to share the letter. Writes a `letter_view` row |
| `GET` | `/api/v1/tpo/export/naac` | `exportNaac` | no | 200 | CSV in the shape of criterion 5.2.1. Writes one `naac_export` row per student. The headers are not checked against the NAAC manual |
| `POST` | `/api/v1/tpo/staff` | `inviteStaff` | yes | 201 | Owner only. Body `campusId`, `email`. 200 when already invited |
| `GET` | `/api/v1/tpo/staff` | `listStaff` | no | 200 | Owner only. No email addresses |
| `DELETE` | `/api/v1/tpo/staff/{id}` | `removeStaff` | yes | 200 | Owner only. `campusId` as a query parameter. Removes a seat or an open invite |
| `POST` | `/api/v1/tpo/staff/{id}/transfer-ownership` | `transferOwnership` | yes | 200 | Owner only. Body `campusId`. The target must be a claimed staff member. The caller becomes staff |

Errors: `campus_required` 400, `invalid_email` 400, `empty_file` 400, `bad_csv` 400, `missing_email_column` 400, `no_valid_rows` 400, `too_few_rows` 400 (fewer than 10 valid rows), `file_too_large` 413, `too_many_rows` 413, `import_rate_limited` 429 (one import per cohort per 24 hours), `drive_limit` 429 (10 drives per cohort in 30 days), `last_owner` 409, `not_found` 404 for anything outside the caller's staff.

### 14.8 Apply

The right swipe, the tracker, the answer bank, the employer inbox and auto-apply consent. Nothing is sent unless the student has granted auto-apply, the day has a free slot, the platform is enabled and `HIRELANE_AUTO_APPLY` is on. Today the only transport is the fixture (`docs/apply.md`).

| Method | Path | `operationId` | Mutation | Success | Notes |
|---|---|---|---|---|---|
| `POST` | `/api/v1/apply/swipe` | `swipeRight` | yes | 201 (200 when the application already exists) | Body `jobId`, optional `resumeId`. Creates the application with a 4 second undo window. Returns the application, the apply address and `autoApply` |
| `GET` | `/api/v1/apply/applications` | `listApplications` | no | 200 | The tracker, newest first. Optional `status`, and `limit` (1 to 100, default 50) |
| `GET` | `/api/v1/apply/applications/{id}` | `getApplication` | no | 200 | Answers (with `needsYou` and the reason), receipt, apply address and matched employer messages |
| `POST` | `/api/v1/apply/applications/{id}/undo` | `undoApplication` | yes | 200 | Only inside the 4 second window |
| `POST` | `/api/v1/apply/applications/{id}/rearm` | `rearmApplication` | yes | 200 | Only for `blocked_fallback` with reason `needs_you`. Puts the application back to `ready` with a new window and queues the submit again |
| `POST` | `/api/v1/apply/applications/{id}/finish` | `markFinishedByStudent` | yes | 200 | Only for `blocked_fallback`. Marks it `submitted` by me. Nothing was sent by Hirelane |
| `GET` | `/api/v1/apply/inbox` | `listInbox` | no | 200 | Employer messages forwarded to me, newest first, with the unread count |
| `PUT` | `/api/v1/apply/inbox` | `markInboxRead` | yes | 200 | Marks every notification read |
| `GET` | `/api/v1/apply/answers` | `listAnswers` | no | 200 | My answer bank |
| `PUT` | `/api/v1/apply/answers` | `saveAnswer` | yes | 200 | Body `questionKey` (`a-z0-9_.:-`, up to 80 characters), `answer` (up to 2,000 characters), optional `labelSeen` and `sensitive`. Creates or replaces the answer for that key |
| `DELETE` | `/api/v1/apply/answers/{id}` | `deleteAnswer` | yes | 200 | Deletes one answer |
| `GET` | `/api/v1/apply/consent` | `getApplySettings` | no | 200 | Auto-apply state, the time it was decided, and the apply address |
| `PUT` | `/api/v1/apply/consent` | `setAutoApply` | yes | 200 | Body `granted`. Recorded as an append-only consent |

Errors: `auto_apply_off` 503, `job_closed` 409, `job_not_applicable` 409, `undo_window_closed` 409, `not_rearmable` 409, `not_blocked` 409, `conflict` 409, `not_found` 404 for an application or answer that is not mine.
