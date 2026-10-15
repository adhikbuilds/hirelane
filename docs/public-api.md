# Public jobs API

> Status: built (Phase 3), reconciled against the working tree on 2026-10-16. Sources: `apps/web/app/api/public/`, `apps/web/lib/public-api-params.ts`, `apps/web/lib/queries/jobs.ts`, `apps/web/lib/openapi.ts`, `apps/web/lib/llms.ts`, `apps/web/middleware.ts`.
> The machine-readable contract is `GET /openapi.json` (also rendered at `/api-docs`). Field-level JSON Schema for the list envelope and the job detail is `apps/web/lib/contracts/jobs.schema.json`.

Read-only JSON about open jobs, for people, scripts and AI agents. No key, no sign-in, no application submission.

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
