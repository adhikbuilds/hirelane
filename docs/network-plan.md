# Network: warm intros for job matches (plan, 2026-10-16)

**Owner decision (2026-10-16):** Hirelane becomes a warm-intro job agent. Its jobs are combined with a relationship graph
ported from WarmPath (github.com/adhikbuilds/warmpath and warmpath-intelligence), giving "jobs where you have a warm
path in". This plan was produced by read-only ECC agents (code-explorer twice, architect). The lead verifies vendor
claims before building.

## Recommendation

Yes, but reuse WarmPath's parts, not the app. Recommend Option A: port WarmPath's scoring logic into the Hirelane TypeScript monorepo and build the ingestion layer new. This goes in as a plan amendment for you to approve.

What carries over:
- the edge-warmth formula
- the relationship-type taxonomy
- the coverage and gap-type logic (no_path, stale_path, cold_path, warm)
- the "why this intro" explanation builder
- the warm-intro draft prompt and its output schema (intro_request, personalization_reason, factual_claims, risk_flags)
- the approve-before-send pattern

Do not adopt the WarmPath app, and do not run warmpath-intelligence as a sidecar. Both copies have no real data intake: edges come only from seed data or a manual POST, and the enrichment code is stubbed. Their security model breaks Hirelane's rules in four ways:
- the getWorkspaceId fallback to 'ws-1'
- an auth check that is skipped when the shared secret is empty
- trusting the X-User-Id header
- edges shared across a workspace instead of per user

The product value lives in the ingestion layer, and that layer has to be built new either way.

**Be honest about hops.** A LinkedIn Connections.csv gives only your first-degree contacts, with their company and title as of the export. Its "Connected On" column is the date you connected, not the last time you talked. So v1 is "you, then a contact at this company". That is a join on the canonical company_id from PLAN §3.2, not a graph search. Strength should come from your own rating of each contact, not from recency guessed off the connect date. Keep the path-finding code, but 2-hop intro paths are not a v1 feature. They only become real with a later two-sided, opt-in sharing feature.

**Package placement:**
- **packages/engine (pure code).** A new network.ts holds warmth, coverage and explanation. A new contacts-import.ts holds the CSV/vCard parser and company resolution against the companies table. Both follow the engine rules: no dependencies, `now` passed in, no randomness, and a Trace on every result.
- **packages/network (new).** It imports db and engine and handles persistence plus the import task. The worker calls it. apps/web only enqueues work.
- **.dependency-cruiser.cjs** needs updating for the new package.

**Engine rules the port must fix:**
- **Missing dates.** Both WarmPath versions read the system clock, and the Python one treats an unparseable date as "now", which means maximum recency. A missing date must show as "recency unknown" in the Trace.
- **Unknown relationship types.** These silently get a 0.5 weight today. Make the type an exhaustive union.
- **Which constants to use.** Take the TypeScript BASE weights, recency steps and hop penalty, plus the Python coverage, gap-type and staleness logic. Tag the constants [assumption] and give their calibration an owner, the same way PLAN §3.4 treats the S-term constants.

**Keep warmth out of the §3.4 match score.** The score measures fit; warmth measures access. Folding warmth in would also break the Phase 4 property test (displayed terms sum exactly to the score) and the ±1 golden tests. Expose warmth as:
- a filter
- a secondary sort
- an Autopilot rule option

**Where it fits.** This is not part of the Definition of Done. It depends on:
- Phase 4: auth, row-level security (RLS), envelope encryption, BlobStore, the canonical companies table
- Phase 5: the draft validator, approval flow, copy panel and the `referral` question_key

Slot it as a new Phase 6N between Phases 6 and 7. That way Phase 7 Autopilot can filter on it and Phase 8 privacy operations cover it. The pure engine module can land earlier, test-first.

## Options considered

### A. Port the scoring logic and edge model into Hirelane as TypeScript packages (recommended)
- Effort: Medium. About 2 to 3 weeks for the CSV-only slice with the ECC agent loop:
- engine port and tests: 3 days
- schema, RLS and encryption: 3 days
- import and company resolution: 3 to 4 days
- UI surfaces: 4 to 5 days
- intro drafts and approval: 2 to 3 days

Google People import adds about 1 week of build, plus Google's OAuth app-verification lead time.
- How: **Engine (pure code).**
- Write `/Users/aagarwal/hirelane/packages/engine/src/network.ts` test-first, porting from WarmPath's `src/lib/graph/index.ts` and `services/graph_engine.py`. It covers:
  - `computeEdgeWarmth(edge, now)`: type base × recency step × (0.4 + 0.6 × strength/100), returning a Trace.
  - `bestContactsForCompany(edges, companyId)`.
  - `computeCoverage(matches, edges)`, returning a gap_type per match: no_path, stale_path, cold_path or warm.
  - `explainPath()`.
  - `findPaths()`, kept with a deque, a degree cap and a hop cap of 1 in v1. Swap in best-first search on -log(warmth) only once 2 or more hops exist.
- Write `/Users/aagarwal/hirelane/packages/engine/src/contacts-import.ts`: a Connections.csv and vCard parser, plus `resolveCompany(text, emailDomain, companiesIndex)` against canonical companies. It handles suffixes like Inc and Pvt Ltd, and uses aliases and domains.
- Infer ex-coworker edges from your own parsed resume: a contact's company matches one of your past employers, and the connection date falls within your tenure there. Record the evidence.

**Persistence.** A new package, `/Users/aagarwal/hirelane/packages/network`, imports db and engine. It owns the `contacts:import` worker task and the edge writes.

**Migration.** Take the next free number; 0005 is already used by 0005_public_board, while PLAN Phase 4 assumes 0005_auth. It creates:
- `contact_imports`: id, user_id, source of `linkedin_csv`, `vcard`, `google_people` or `manual`, counts, created_at.
- `contacts`: user_id, import_id, encrypted name and profile URL, `email_hmac`, `company_id`, encrypted title, `connected_on`, `user_strength` as close, know or barely, `deleted_at`.
- `relationship_edges`: user_id, contact_id, company_id, type, strength, evidence jsonb, source, `last_interaction_at` (nullable).
- `intro_requests`: user_id, application_id, contact_id, draft, status.
- All four tables get FORCE RLS on user_id.

**Web.** Upload goes to an encrypted blob, then enqueues the import, then the blob is deleted after parsing.
- Pros: - Fits every Hirelane rule natively:
  - a pure engine with Traces, so the maths can be shown
  - per-user FORCE RLS
  - envelope encryption reused from Phase 4
  - enqueue-only web
  - pnpm verify, verify-rls and offline e2e with no API key
- One runtime and one database, so contact PII never crosses a service boundary.
- Joins directly on the canonical companies and jobs tables, so the job board ledger, triage docket, company page and Autopilot all get the signal cheaply.
- Reuses WarmPath's best ideas (warmth formula, gap types, explanation strings, intro prompt schema, approval pattern) without importing its security debt.
- Cons: - The ingestion layer has to be written from scratch.
- WarmPath's react-force-graph page and its Zustand/demo-data wiring are not reused as-is.
- The two WarmPath engine versions disagree on constants, so one set has to be chosen and calibrated. The constants stay [assumption] until then.
- v1 is honest but modest: first-degree contacts only.
- Adds a new PII category (third parties who never consented) that Phase 8 privacy operations must cover.

### B. Run warmpath-intelligence (FastAPI) as a sidecar service
- Effort: Small to stand it up (about 2 to 3 days). Large to make it acceptable (about 2 or more weeks):
- fix the auth that is skipped when the secret is empty
- fix the SERVICE_SECRET vs INTELLIGENCE_SERVICE_SECRET name mismatch
- add a constant-time compare
- remove the trust in the X-User-Id header
- make the synchronous calls async
- add Alembic migrations
- drop the in-process scheduler
- add a Trace output
- wire the service into Docker for offline e2e
- How: Deploy the Python service next to Hirelane. The workers or server actions would POST each user's edges to /graph/compute-paths and /graph/coverage. Intro drafts would go to /agents/generate, and replies to /classify/reply. Persistence would stay in Hirelane Postgres, using WarmPath's relationship_edges shape.
- Pros: - The graph maths and the Claude prompts already exist and run.
- The reply classifier and intro-draft endpoints are available right away.
- Keeps Python available if relationship-strength scoring later becomes machine-learned.
- Cons: - Adds a second runtime and language to a pnpm TypeScript monorepo. That breaks PLAN §5.2 package boundaries, dependency-cruiser and the single `pnpm verify`.
- The offline, no-key e2e run must now boot it.
- It is stateless and takes edges in the request body, so every call ships a user's contact PII across a service boundary in plaintext.
- It has no RLS and no Trace, and its LLM calls bypass the HIRELANE_LLM_MODE fixture/off modes and the llm_calls logging.
- Its hard-coded model and prices conflict with the rule that the default is `claude-opus-5-5`, overridable by env.
- It still solves zero ingestion.
- It duplicates logic Hirelane will own anyway (reply classification is already Phase 6.4).

### C. Keep WarmPath as a separate product and link to it by API or deep link
- Effort: Large, about 4 to 6 weeks before it could carry real user data. WarmPath would first need:
- the ws-1 fallback and the demo-data-on-error routes removed
- the middleware matcher fixed
- the Credentials demo backdoor removed
- auth added on the Twenty, discovery and Happenstance routes
- RLS added
- field encryption added
- the same ingestion layer built

Hirelane would then need cross-product SSO, a data-sharing agreement between the two products, and two privacy notices.
- How: WarmPath (the Next.js app plus Prisma) becomes the network product. Hirelane would call its /api/warm-paths and /api/contacts with a service token, or deep-link to WarmPath's relationship-graph page with company context. Users would import their network into WarmPath, and Hirelane would show the summarised results.
- Pros: - No scope creep in Hirelane's MVP.
- WarmPath could keep evolving as its own B2B sales tool, with its accounts, campaigns and sequences.
- The force-graph UI is reused as-is.
- Cons: - Two databases hold the same third-party PII. Export, deletion and retention obligations double, and Hirelane's Phase 8 guarantees can't cover data it doesn't hold.
- The B2B domain model (BizAccount, ICP fit, campaigns, sequences) does not map to job search.
- Workspace-level tenancy is wrong for a single job seeker.
- It is the largest effort, and most of it is hardening a different product.

## User-facing features

- **Job board ledger** (/jobs, signed-in only). Add a 'Network' column next to 'Match', reading for example '2 at Stripe'. It is rendered per user on the server, outside the public cache. It is never in the /jobs ISR or s-maxage cache, /api/public, markdown, sitemaps or JSON-LD. Add a filter-rail toggle, 'Companies where I know someone'.
- **Triage docket** (Hirelane's one-card-at-a-time 'swipe stack'). Add a 'Your network' row under the match ledger. It shows the strongest contact with name, title and relationship type. Warmth is written as its equation, like the match ledger, for example 'coworker 86 × your rating close 1.0 × recency unknown'. The row expands to list the other contacts. No heat colours, ring gauges or floating chips.
- **Company page** (/company/[slug], signed-in only). A private 'People you know here' ledger, ranked by warmth. It shows the source ('LinkedIn export, 12 Oct') and the evidence ('Connected while you both worked at Acme, 2020').
- **Intro and referral request draft.** From a match or an application, Hirelane drafts a short message asking the contact for a referral or an introduction to the hiring team. Under the hood it reuses WarmPath's warm_intro prompt and the factual_claims and risk_flags schema, gated by the Phase 5 evidence validator. With no API key it uses a deterministic template. You edit and approve it, then copy it and send it from your own LinkedIn or email. Hirelane never sends it. The send is recorded as an `intro_requested` event on the application's lane timeline.
- **Referral question in application forms.** When a form asks about a referral, the Phase 5 `referral` question_key can suggest the contact. It stays Needs you until you confirm a referral actually happened. It is never auto-filled from the graph alone.
- **Ranking by warmth.** A secondary sort, 'Match, then warmth', plus a 'Has a contact' filter. Warmth stays separate from the PLAN §3.4 fit score.
- **Network coverage view.** Shows how many of your top 50 matches have a contact. It lists gaps as no contact, stale ('connected 2019, rating unknown') or cold, using WarmPath's coverage and gap-type logic. It prompts you to rate a contact or add one.
- **Autopilot rule option** (Phase 7). 'Only companies where I know someone', or 'draft an intro request alongside the application'. It still only drafts and queues.
- **Contact strength ratings.** A one-key close / know / barely rating on contacts at your matched companies. Hirelane cannot see your messages, so your rating is the honest strength input. The UI says so.
- **Optional route-map view** (/network). An interactive graph styled with Hirelane's lane tokens, for you, companies and contacts. It adapts WarmPath's react-force-graph-2d page into small components and uses API data instead of demo data. This fits the stated preference for richer interactive UI. It must pass the §4.1 banned-trope review: no decorative blobs and no heat palette.

## Data and legal constraints

- **Sources: user-provided only.**
- Your own LinkedIn data export (Connections.csv, uploaded by you).
- A vCard or CSV from your phone or address book.
- Manual add.
- Later, Google Contacts through the People API with OAuth consent.

Never:
- scraping LinkedIn or any site
- Proxycurl
- Playwright crawling
- inferring people from job postings
- **Rejected for v1:**
- **Happenstance API.** It would send your contacts to a competitor and add a subprocessor, and the network becomes its moat, not Hirelane's.
- **Crustdata enrichment.** Its data is derived from LinkedIn, which conflicts with Hirelane's no-LinkedIn-scraping rule.

Also never name Happenstance or WarmPath on product surfaces. Extending brand-guard to cover them is optional.
- **Verify these vendor claims before building ([assumption: verify]).** ECC agents have no web access, and CLAUDE.md requires vendor claims to be verified:
- the exact Connections.csv column set (First Name, Last Name, URL, Email Address, Company, Position, Connected On), and that Email Address is usually blank
- that Google People `contacts.readonly` is a sensitive scope needing OAuth app verification
- that Gmail or Calendar metadata scopes are restricted and need an annual third-party security assessment

Until verified, Gmail and Calendar-derived edges are out of scope.
- **Third-party PII.** These contacts never consented to Hirelane. Hirelane processes their data on your behalf, so collect as little as possible:
- **Encrypted:** names, profile URLs and titles, with the Phase 4 envelope design (per-record data key, AES-256-GCM wrapped by HIRELANE_MASTER_KEY).
- **Email addresses:** keep only a keyed HMAC for dedup, or drop them.
- **In clear:** only company_id and dates, which joins need.
- **Unresolved companies:** decide whether to keep contacts at companies not on the board, encrypted, or discard them. This is an open choice for the architect.
- **Isolation.**
- contact_imports, contacts, relationship_edges and intro_requests get ENABLE plus FORCE RLS on user_id through withUser.
- verify-rls gains cross-user read checks for each table.
- No workspace sharing.
- No cross-user aggregates such as '3 Hirelane users know someone at Stripe' or 'people you may know'. Multi-hop sharing would need a later, explicit two-sided opt-in feature with its own review.
- **Upload pipeline.**
- Accept CSV or vCard only. No zip, to avoid zip bombs.
- Cap the size (for example 5MB) and the rows (for example 35,000; [assumption] near LinkedIn's connection limit).
- Check encoding and parse strictly.
- Store the raw file only as an encrypted blob, parse it in the worker, and delete the blob immediately after parsing, so raw files are never retained.
- Guard against CSV formula injection on re-export.
- The web layer only enqueues.
- **LLM boundary.**
- Contact data reaches the model only with a separate 'use my contacts in drafts' consent toggle, distinct from the resume consent.
- Send only the contact's first name, company, title and relationship type. Never URLs, emails or the full list.
- Delimit everything as untrusted data.
- The model gets no side-effecting tools.
- llm_calls stores no content.
- The no-key fallback template must pass e2e.
- **Data-subject rights and retention.** Contacts are included in:
- GET /api/me/export
- DELETE /api/me
- a per-import 'delete everything from this upload' action
- per-contact delete

Add rows to the §10 retention table:
- raw uploads: deleted after parse
- intro drafts never sent: 90 days
- deleted contacts: hard-deleted

Also honour a suppression list keyed by HMAC of URL or email, for third parties who ask through /contact to be excluded.
- **Logs and audit.**
- Extend the pino redaction paths to contact names, URLs, titles and draft bodies.
- The Phase 8 log PII scan includes the synthetic contact fixture.
- audit_log records contact exports and deletes.
- **Repository.** Commit only a synthetic Connections.csv fixture, for example under /Users/aagarwal/hirelane/packages/network/fixtures/. Never commit your real export or real contacts. Run security-reviewer for a deep review before push: upload parsing, RLS, encryption, the LLM path, and leaks through cached public pages.
- **Honesty rules.**
- Warmth constants are heuristics, tagged [assumption] with a calibration owner.
- An unknown last-interaction date is shown as 'recency unknown', never treated as recent.
- Inferred edges such as ex-coworker carry their evidence.
- Nothing claims Hirelane knows how close you are unless you rated it.

## Phasing (architect's proposal; owner direction moves Network earlier, see PLAN amendment)

**Where Hirelane is now:** in Phase 3. Migrations reach /Users/aagarwal/hirelane/packages/db/migrations/0005_public_board.sql, and the packages are engine, ingest, agent, db, workers/runner and apps/web. The network feature is outside PLAN §11's Definition of Done, so it should not delay the MVP loop.

**Proposed plan amendment** (needs your approval in /Users/aagarwal/hirelane/PLAN.md):

**(1) Optional, any time from Phase 4 on: engine pre-work.** tdd-guide writes /Users/aagarwal/hirelane/packages/engine/src/network.ts and contacts-import.ts test-first. They are pure, with `now` passed in and a Trace on every result. Golden tests cover warmth, gap types, company resolution against the companies fixture, and ex-coworker inference. No UI or database yet.

**(2) Hard dependencies:**
- Phase 4: auth, FORCE RLS, envelope encryption and BlobStore, canonical companies, the triage docket
- Phase 5: the draft validator, approve and copy-panel handoff, the `referral` question_key

**(3) New Phase 6N, 'Network'**, between Phase 6 and Phase 7. Placing it there lets Phase 7 Autopilot take a 'has a contact' rule, and lets Phase 8 privacy operations (export, delete, retention, log PII scan) cover contacts.

Tasks:
- **6N.1 architect:** /Users/aagarwal/hirelane/docs/network.md and the privacy-model additions (encryption, HMAC keys, RLS, consent toggle, retention, suppression), the package boundary for packages/network, and the dependency-cruiser rules.
- **6N.2 migration and verify-rls:** next free number, at least 6 new cross-user checks.
- **6N.3 contacts:import worker:** encrypted blob, parse, resolve, write edges, delete blob.
- **6N.4 UI:** the Network column and filter on /jobs, the docket 'Your network' row, the company-page ledger, the coverage view and contact rating.
- **6N.5 intro-request draft:** approve, copy, then the `intro_requested` event.
- **6N.6 security-reviewer** deep review.
- **6N.7 doc-updater.**

Acceptance:
- [ ] The synthetic CSV import resolves ≥ 95% of fixture contacts at board companies, with 0 false company merges.
- [ ] verify-rls shows 0 cross-user contact reads.
- [ ] The stored blob is deleted after parse, and a grep for fixture names in the database and storage finds 0 plaintext hits.
- [ ] Public and cached pages contain 0 network data (test).
- [ ] With no API key, intro drafts use the template and make 0 LLM calls.
- [ ] Export and delete row counts match.
- [ ] e2e/phase-6n-network.spec.ts passes (upload the synthetic CSV, see '2 at <company>' on /jobs and in triage, draft, approve and copy an intro request), and docs/screens/phase-6n.png is saved.

**(4) Later, separate phases:**
- Google People import, after OAuth verification is confirmed.
- Two-sided opt-in sharing between users, which is the only route to real 2-hop paths.
- Gmail and Calendar edges, deferred until the scope and security-assessment cost is verified.

## WarmPath source map (for porting)

### Frontend (warmpath)

WarmPath (/private/tmp/.../scratchpad/warmpath-src/warmpath) is a Next.js 15 / React 19 / Prisma 7 / Postgres prototype. It is a "warm-path-first" outbound GTM tool, a B2B variant of Happenstance. CLAUDE.md is stale. It says there is no DB, no auth and no API routes, but the repo now has about 47 route.ts files, a Prisma schema, NextAuth v5 and a Stripe webhook. The gap is real, though. Almost every data path falls back to hardcoded DEMO_* fixtures. No real ingestion exists: no LinkedIn CSV, no Gmail/Google contacts sync, no enrichment APIs. The one genuinely valuable and portable piece is the graph engine, src/lib/graph/index.ts (about 240 lines of pure TypeScript). Everything else is either a thin CRUD scaffold or a mock. The planned Python "intelligence service" does not exist. Verdict for Hirelane: reuse the graph engine, the edge-type taxonomy, the force-graph visualisation and the AI provider and approval-queue patterns. Do not adopt the app wholesale. Hirelane will have to build its own ingestion, which is where the product value sits.

Graph logic:
Source: src/lib/graph/index.ts. It is a pure in-memory TypeScript class, RelationshipGraph, with no DB or framework dependencies.

Build: buildRelationshipGraph(edges, teamNodes) creates an adjacency map. Every edge is added bidirectionally (undirected). Nodes are derived from the edge from/to fields, plus optional teamNodes so people with no edges still appear.

Edge warmth, computeEdgeWarmth: round(BASE[type] * recencyFactor * (0.4 + 0.6 * strength/100)), capped at 100.
- BASE values: intro_history 92, coworker_connection 86, calendar_meeting 82, warm_path 74, email_history 70, crm_owner 62, linkedin_connection 44.
- Recency steps on days since lastInteractionAt: <7d 1.0, <30 0.92, <90 0.78, <180 0.60, <365 0.42, otherwise 0.25.

Path finding, findPaths(from, to, maxHops=3, maxResults=3):
- It is a breadth-first search that enumerates every simple path up to maxHops. It copies the visited Set and the path arrays per frame.
- Path score = min edge warmth along the path (weakest link) * lengthPenalty. The penalty is 1.0 / 0.94 / 0.84 / 0.70 for 1 / 2 / 3 / 4+ hops.
- It also returns avgWarmth, weakestLink and a string explanation ("A → B via coworker connection → ...").
- Results are sorted by warmth and sliced.

findBestPathToContact(sourceIds, targetId) takes the best path across all team members.

Callers: all client-side. They are relationship-graph/page.tsx (react-force-graph-2d, about 1000+ lines), warm-leads/page.tsx and audience-builder/page.tsx. Each page builds the graph in useMemo from the Zustand salesStore edges. There is no server-side or batch path computation. The WarmPath table and /api/warm-paths exist but are not populated by the engine.

Limits:
- Path enumeration is exponential on dense graphs, and there is no node cap.
- The scoring constants are hand-tuned, not learned.
- Edge direction and asymmetry are ignored.
- There is no multi-signal fusion: one edge per pair per type, with no aggregation of several touchpoints.
- There is no company-level inference such as "shared past employer" or "same school". Those must exist as pre-materialised edges.
- It is one hop out from the user or team to an account, so account nodes work as targets but there is no person-to-account affiliation edge generation.

Reusable:
- src/lib/graph/index.ts: copy as-is into Hirelane. It is dependency-free apart from the RelationshipEdge type. Retarget node types to candidate / recruiter / hiring_manager / company / referrer, and rename the BASE_WARMTH keys to hiring-relevant edge types (ex-coworker, school/alumni, referral_history, email_history, calendar_meeting, linkedin_connection). Then fix the scaling problems: run it on the server, cap fan-out, and replace full path enumeration with best-first search (Dijkstra on -log(warmth)) or k-shortest paths.
- The edge-warmth formula (type base x recency step x strength 0.4-1.0 scaling) and the weakest-link x hop-penalty path scoring: good, explainable heuristics for a v1. Also reuse the explanation string builder for 'why this intro' UI.
- RelationshipEdge schema shape (from/to type+id+name, relationshipType, strengthScore, evidence, source, lastInteractionAt) as the starting point, but add FKs or a unified Node table, indexes on (workspaceId, fromId) and (workspaceId, toId), a source-provenance table and a confidence column. Keep workspace-scoped tenancy (Workspace and WorkspaceMember) and the query-helper pattern.
- src/app/(app)/relationship-graph/page.tsx: the react-force-graph-2d visualisation with path highlighting (from/to selection, top-3 paths). Needs splitting into components and moving off Zustand to API data, but the UX is directly reusable.
- AI provider abstraction (mock/local/remote) with prompt-cached KB system prompt, structured JSON output (factual_claims, personalization_reason, risk_flags), cost estimation per token class, and the rule-based analyzeRisk. Move it server-side, drop NEXT_PUBLIC key fallback, validate with Zod, persist AIUsageLog with the right workspaceId, and (for Hirelane) swap templates for candidate-outreach and 'ask the connector for an intro' prompts. Consider routing through Forgebench's gateway.
- Approval queue pattern (Approval, Message, CampaignAsset models; edit-and-approve; keyboard shortcuts) plus AuditLog, AIUsageLog, ConsentRecord: a sensible compliance layer to keep for Hirelane's outbound.
- Twenty CRM client/mapper (src/lib/twenty/*) only if Hirelane wants a CRM sync. The Happenstance client (src/lib/happenstance/client.ts) is a small wrapper reusable for network search and person research, with the mock fallback pattern useful for demos.
- Landing, onboarding, billing (Stripe checkout and webhook) and Radix UI wrappers in src/components/ui: generic scaffolding. Note the user's preference for rich, interactive UI over flat minimal UIs; WarmPath's design system (DESIGN.md) may need upgrading.
- What NOT to reuse: the demo-data files as runtime data, /api/discovery stub, the getWorkspaceId fallback, the client-side-only auth guard and middleware matcher, the Credentials demo backdoor. For Hirelane, the missing core to build fresh is the ingestion layer: LinkedIn export CSV parser, Google OAuth (contacts, Gmail headers, calendar) -> edge builder with entity resolution (email/LinkedIn URL as the identity key), and a licensed enrichment source.

Risks:
- ToS and scraping: the entire value (a real relationship graph) depends on LinkedIn connections, Gmail and calendar. None of that is implemented here. PRODUCT_PLAN names Proxycurl and Playwright scraping of LinkedIn, which violates LinkedIn ToS and carries legal risk. Per the user's existing 'legal routes only' stance, Hirelane should use user-consented sources: LinkedIn data export CSV, Google OAuth contacts and calendar, and licensed APIs (Crustdata, Happenstance).
- Dependence on Happenstance: the warm-path search and research are a third-party paid API that is also a competitor. Using it as the backbone makes it a reseller, with no moat and vendor lock.
- PII and privacy: the graph is people-about-people data (third-party contacts, emails, phone numbers, WhatsApp/Telegram handles, conversation text). The repo has ConsentRecord and consentStatus, but no deletion/retention workflow, no field encryption, no GDPR/DPDP handling, and no consent gating on ingestion. For recruiting use (candidates and referrers) this is higher-sensitivity data.
- Tenant isolation: the getWorkspaceId() fallback to 'ws-1', routes that fall back to DEMO data on error, and no DB-level RLS. The Twenty sync route has no session check and returns CRM data to any caller. /api/discovery and Happenstance routes are unauthenticated, so anyone can burn the API quota.
- Secrets: .env.example contains only placeholders (INTELLIGENCE_SERVICE_SECRET=change-me-in-production, NEXTAUTH_SECRET instructions). I saw no committed live secrets in the files read, but .env.example and a git history are only a shallow clone, and a full secret scan (e.g. trufflehog over all commits) was not run. The code accepts NEXT_PUBLIC_ANTHROPIC_API_KEY, which would ship the key to browsers if used. Integration OAuth tokens have nowhere safe to live (Account stores refresh/access tokens in plaintext columns).
- Hardcoded demo credentials (demo@warmpath.ai / demo123) in auth.ts, and the placeholder pricing and claims in AI templates (e.g. '5x higher reply rate (Gartner, 2025)', mock case studies) that could be presented as facts if the fallback-to-mock path fires silently in production.
- Stale and misleading docs: CLAUDE.md says there is no backend. The graph runs on the client and is O(b^k) path enumeration on the main thread, so it will not scale beyond a few thousand edges without moving to a server with pruning, k-shortest paths or precomputation.
- License and provenance: the repo is the user's own (private=true), but pitch-deck assets and 'Twenty' (AGPL-3.0 CRM, run via docker-compose) have licensing implications if embedded or hosted for others; using it through its API is generally fine.

### Backend (warmpath-intelligence)

WarmPath intelligence is a small FastAPI (v0.2.0) backend with a clean, reusable core: a pure-Python weighted BFS warm-path engine (services/graph_engine.py), a rules-based account scoring router, and Claude Sonnet 4.6 outreach, research, classify and signal-detect endpoints behind one cached-prompt client. It is multi-tenant by workspace_id on SQLAlchemy 2. Its relationship-graph input is a single manually or CSV-fed `relationship_edges` table. There is no real ingestion: every enrichment and scraper function is a stub, and discovery falls back to AI-fabricated leads. So the graph math and AI plumbing port to Hirelane well. The data-acquisition layer, the part that makes a Happenstance-style product work, does not exist here and must be built, ideally from consented sources. I read all of main.py, models, graph_engine, ai_client, scheduler, database, auth_context, requirements, .env.example and .gitignore. I read agents, signals, graph, scoring, enrich, discovery, sequences, classify and auth in full. I read warm_paths, relationship_edges and integrations in the data package, and the first 120 lines of seed.py plus grep hits. I did not open the other data routers: accounts, contacts, campaigns, approvals, messages, knowledge_base, tasks, dashboard, ai_usage, audit_log, workspace.

Graph logic:
**Path finding (services/graph_engine.py, about 290 lines, no I/O, pure Python)**
- `build_graph(edges, team_nodes)` takes camelCase dicts (fromId, strengthScore, lastInteractionAt). It is a Python port of a TypeScript `src/lib/graph/index.ts` and builds an undirected adjacency list. Edges are sent in the request body of POST /graph/compute-paths and /graph/coverage, so the engine is stateless and does not read the DB.
- `find_paths(source, target, max_hops=3, top_k=3, min_warmth)` is a plain breadth-first enumeration of simple paths.
  - Cycles are rejected per path (`nid in path`). There is no global visited set, so it enumerates all simple paths up to the hop limit.
  - Queue.pop(0) is O(n), and the search stops once it has found top_k*3 paths.
  - Complexity is exponential in branching factor ^ hops. That is fine at 3 hops on small graphs but needs a degree cap or pruning at scale.
  - Path warmth is the weakest-link minimum of edge warmths, multiplied by a hop penalty of 0.9^(hops-1).
  - A path is flagged `is_stale` if any edge's last interaction is more than 90 days old.
  - Results are sorted by warmth and the top_k are kept.
- `compute_coverage(sources, targets)` finds the best path from any source to each target and assigns a gap_type: no_path, stale_path, cold_path (warmth below 60) or warm. It returns coverage_pct.

**Relationship strength scoring**
- Edge warmth is `type_weight × recency × (strength/100) × 100`.
- Type weights are intro_history 1.0, coworker_connection 0.85, calendar_meeting 0.8, email_history 0.75, warm_path 0.7, crm_owner 0.65, linkedin_connection 0.55, and default 0.5.
- Recency is 1.0 for 30 days or fewer, then a linear decay to 0.3 at 90 days or more.
- strength_score is an input (default 50) set by whoever creates the edge, so nothing in the repo computes strength from interaction data. Strength is not derived from signals such as frequency or reciprocity.
- Bug or mismatch: seed data and the edges router use relationship types (worked_together, conference_met, colleague) that are not in TYPE_WEIGHTS, so they all silently get 0.5. The same applies to any type not in the table.
- Another quirk: an unparseable date is treated as now, which means maximum recency.
- Note that `WarmPath` in the engine is a dataclass and is separate from the ORM model of the same name.

**Account scoring (routers/scoring.py, DB-backed, workspace-scoped)**
- POST /scoring/account/{id} and /scoring/batch recompute and persist three scores on each BizAccount.
- Intent = 0.5×max + 0.5×mean of (signal_weight × recency bucket × 100). Recency buckets are 7, 30 and 90 days at 1.0, 0.85, 0.65, and 0.40 beyond that. The default with no signals is 30.
- Warmth = 20 + 0.5×avg(WarmPath.warmth_score) + 0.3×avg(edge strength) for edges whose to_id is one of the account's contacts. It uses stored WarmPaths and raw strength, not the BFS engine.
- Fit = 40 + an ICP employee-count bonus (50-500 gives +20, 500-2000 gives +12, under 50 gives +8) + 25×max seniority weight + 5 for a description + 5 for a domain.
- These are hand-set heuristics with no learning. The code comment says ML is to come in production.

**Signals (routers/signals.py)**
- Hard-coded urgency base table: pricing_page_visit 95, champion_job_change 92, funding 88, intent_topic_surge 85, and so on down to 48.
- Confidence is 90 if there is a source_url, otherwise 70.
- Each type maps to a canned "recommended_action" string.
- POST /signals/detect asks Claude to infer 3-5 plausible buying signals from only the company name and description. The prompt itself says "REALISTIC, PLAUSIBLE signals... infer from typical patterns", so the output is hallucinated and can be persisted as real Signal rows with source "AI inference". This is a trust and quality problem.

**Sequences (routers/sequences.py)**
- Mautic-style drip logic. POST /sequences/advance finds active campaigns and accounts with at least one approved or sent message, works out the next step, checks the delay since the last message, and creates a rep Task. The title is used for deduplication (`Task.title.contains("Step N")`), which is fragile.
- It never auto-sends; it only creates tasks.

Reusable:
- `/services/graph_engine.py` (copy nearly verbatim, about 290 lines, pure Python, zero deps): edge warmth (type_weight × recency × strength), weakest-link path scoring with hop penalty, staleness flag, and the coverage and gap-type classification (no_path, stale_path, cold_path, warm). For Hirelane, retarget the nodes to you, connections and target-company employees, add the missing relationship types (alumni, former_coworker, github_collab, etc.), and replace list.pop(0) with a deque. Add a top-degree cap or Dijkstra/k-shortest on -log(warmth) before using it on a large graph.
- The RelationshipEdge schema (/models/all_models.py): polymorphic from/to, relationship_type, strength_score, evidence, source, last_interaction_at. Add a user_id owner, a canonical identity key (normalised linkedin_url or email hash), a direction or reciprocity field, a consent flag and a deleted_at timestamp. The WarmPath table (path_json, explanation, warmth/confidence, recommended_intro_person, recommended_channel, status) works as the cached-result table for an 'intro paths to this role' feature.
- The AI client pattern (/services/ai_client.py): the prompt-caching wrapper and cost estimator. Reusable idea only: update the model, make it async or threaded, and route it through your existing provider layer, since Hirelane can use the model gateway already in use rather than a direct Anthropic key. Also log into usage tables (the AIUsageLog design is good).
- The warm-intro message generator prompt and schema (routers/agents.py): system prompt with banned words, a single-question rule, KB-only facts, and JSON output containing intro_request, personalization_reason, factual_claims and risk_flags. Adapt it to 'ask mutual connection X to intro me to Y at company Z for role R', and add a verification step on factual_claims.
- The approval workflow pattern: Message.approval_status, the Approval table with edited_body and feedback, and CampaignStep.approval_required. This is the human-in-the-loop gate to keep for any automated outreach.
- The reply classifier (routers/classify.py): intent, sentiment, stage and next_action JSON. It is directly reusable for classifying recruiter or referrer replies, with a small prompt change.
- Utility patterns: the workspace-scoped CRUD routers (filter by workspace_id on every query) as a template for per-user scoping, the camelCase edge payload and stateless /graph/compute-paths endpoint shape, and the Google Places REST integration if Hirelane needs company discovery (respect its storage terms).
- Do NOT reuse as-is: the auth middleware and X-User-Id context, the enrich stubs, the AI-hallucination signal detector and AI lead stub, the scheduler (stubs, hard-coded workspace), the lead and fit scoring heuristics (B2B sales ICP), and the seed credentials.

Risks:
- ToS and legal risk of the intended data sources: the stubs and comments point at Proxycurl and LinkedIn profile or job scraping, with weekly checks on named individuals. Proxycurl scraping LinkedIn violates LinkedIn's terms and has drawn litigation (LinkedIn sued Proxycurl in 2025), so do not build Hirelane's graph on it. The discovery module's lineage (Omkarcloud and Gosom Google Maps scrapers) is also scraper-based. Only the Google Places REST call is a legitimate API, and it has caching and storage limits on place data.
- Relationship-graph PII: a graph of who knows whom, plus emails, phones and LinkedIn URLs, is sensitive personal data under GDPR, CCPA and India's DPDP Act. Contact.consent_status is stored but never checked or enforced. There is no data-subject delete or export path, no retention policy, no encryption of PII columns and no provenance beyond a free-text `source`. Hirelane needs an explicit consent basis (user-uploaded own contacts, a LinkedIn data-archive export, OAuth Gmail or Calendar) and per-user ownership of edges so one user's contacts are not exposed to others. The WarmPath model is workspace-shared, which is a privacy problem for a consumer or job-seeker product.
- Hallucinated data presented as fact: /signals/detect can persist invented 'buying signals', and /discovery AI mode invents companies, emails, phones and LinkedIn URLs. /enrich returns fake profiles with `enriched: True`. Confidence scores are self-reported by the model. Outreach to fabricated people or emails could harm sender reputation and invite CAN-SPAM or GDPR complaints.
- Auth is fail-open and trusting: the empty-secret bypass, the SERVICE_SECRET vs INTELLIGENCE_SERVICE_SECRET mismatch, non-constant-time comparison, X-User-Id impersonation, and unauthenticated LLM-cost routes (no rate limits). The unauthenticated /register and /auth/me endpoints would be dangerous if the service were exposed publicly.
- Secrets committed: none found. .env, *.env and *.db are in .gitignore, and .env.example holds only placeholders (`change-me-in-production`, empty ANTHROPIC_API_KEY). Weak spot: seed.py hard-codes demo accounts with the password 'demo123' (demo@warmpath.ai and others), which should never run against production. The author's real name appears in seed data. I did not check git history for older commits (the clone is shallow).
- Algorithm scalability and correctness: BFS enumerates all simple paths (exponential), uses O(n) list.pop(0), and has no degree cap. Edge types in seed/DB fall back to a 0.5 weight because they are missing from TYPE_WEIGHTS. Strength is entirely caller-supplied, and the graph is rebuilt per request from the posted edges, so large networks mean large payloads. There are no DB indexes on from_id or to_id.
- Operational: no tests, no migrations, an in-process scheduler that duplicates across workers, a hard-coded default workspace, a sync LLM and DB call blocking the async event loop, a hard-coded model id and prices that will drift, and no AIUsageLog writes in the AI routes, so cost tracking is not wired up server-side.
- Product-fit risk: this is a B2B sales tool (accounts, ICP fit, campaigns). Hirelane's 'who do I know at company X, who can intro me' is the same core path problem, but the surrounding domain model (BizAccount, campaigns, sequences) does not map to job search and would be dead weight if copied wholesale.
