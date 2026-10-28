# Hirelane: website, student app and console plan

Plan for the owner's review, 2026-10-29. Planning only: nothing below is built, and no UI gets built until this plan is approved (owner decision 3, DECISIONS-2026-10-29-night). This document merges two drafts. Draft A covers information architecture and pages. Draft B covers the visual system, wireframes, component system and build order. Where the drafts disagree, the conflict is listed in Appendix A with the resolution used here.

**Sources:**
- docs/product/CAMPUS-PRD.md
- docs/product/CAMPUS-FIRST.md
- docs/product/DECISIONS-2026-10-29-night.md
- docs/design/screen-audit-2026-10-29.md
- DESIGN.md
- PLAN.md (`reply_handle`, `inbound_messages`)
- docs/design/auto-submit-opt-in.md
- the captures in docs/screens: main-landing, students-page, landing-colleges, home-a, campus-console, campus-drives, campus-students, picks-drag, auth-1, auth-2b, auth-3, auth-4-you

Route names reuse the existing `apps/web/app` tree wherever a route already exists. New routes are marked **new**. Wireframes are marked **Wireframe** and keep the numbering of Draft B (2.x for the student app, 3.x for the console, 1.10 for the home page).

---

## Summary

Hirelane is an off-campus job product for Indian freshers and the placement cells that serve them. A student checks each role against their own marks, backlogs and batch, then swipes right to apply from a Hirelane apply address. Placement cells see cohort totals, paste drive notices, and verify off-campus offers for NAAC 5.2.1. This plan sets the page map for the public website, the student app and the placement console, and fixes the copy and numbers that are now false or rejected. The public site moves to a light, calm, typographic register with real product components instead of screenshots. The student app keeps its approved direction (calm chrome, colour only on role cards). The console keeps its approved dark analytics register but gets k ≥ 10 suppression, a full-height sidebar and one primary action per page. Apply copy is written in two versions, because submission stays fixture-only until the owner runs a supervised pilot. Nothing is built until the six decisions below are answered.

---

## Decisions needed from the owner

1. **Apply copy before the pilot.** Draft A's replacement copy says Hirelane sends the application now. Draft B's rule is that submission stays fixture-only until the supervised pilot, so public copy must not claim it is live. Recommendation: ship the "Today (pre-pilot)" copy in section 0.1 and switch to the "At pilot launch" copy when the pilot flag turns on. (See 0.1 and Appendix A.)
2. **Student tab set.** Recommended: Home, Picks, Drives, Tracker, You. Alternative (DESIGN.md and the Draft B shell): Home, Discover, Swipe, Tracker, You, with Drives as a section of Home. See section 6.1.
3. **Replies to employers.** Today the reply is a prepared draft sent by `mailto:` from the student's own mail, so the employer sees a personal address. Replying from the apply address needs a warmed sending domain and an amendment to PRD M1 ("never sent by Hirelane"). See 6.2.
4. **Live count floor and event-count privacy.** Set the minimum live count below which the public stat strip is hidden. Also decide whether weekly application counts fall under k ≥ 10. Recommendation: yes, treat them as k-bound until the security reviewer says otherwise. (See 0.3 and open items.)
5. **Daily cap and refresh time.** Set the per-student daily auto-apply cap, the time picks refresh (9:00 is a placeholder), and whether a capped right swipe queues for tomorrow or goes straight to the fallback.
6. **Fonts and the auth register.** Draft A specified Bricolage for the public site; Draft B specifies Geist everywhere except the approved auth screens. Decide: one font (Geist) across site, app and console, and whether the approved night-background auth screens move to paper. Recommendation: Geist everywhere, auth layout and colours unchanged until you say otherwise. Nothing changes until you decide.

---

## Further open items (not in the top six)

These come from the two drafts, or were found while merging them. None blocks the review, but each needs an answer before the slice that depends on it.

- **Pilot page prices.** Prices in CAMPUS-FIRST §9 are tagged [assumption]. Decide whether W4 Pilot lists prices once §9 is decided. Until then, no prices on the public site.
- **About page team names and photos.** Show them only if the owner provides them (W5).
- **Logo wall.** None until there are signed pilots with written permission. Confirm.
- **Push notifications.** Web push on the PWA at the pilot, or in-app only until the sending domain is warm.
- **Stale documents.** PRD §5 non-goal "Hirelane submitting applications or messaging employers", the "Until then" section of auto-submit-opt-in.md, and the student-page hint "We never open it ourselves" should be marked superseded by DECISIONS-2026-10-29-night §1. The hint is still true for our servers' fetching, but a submission does open the apply page. Owner note needed so later agents do not follow them.
- **New colour tokens.** Draft A asked for `--color-ink-muted` and `--color-line` in DESIGN.md. Draft B already defines `--color-ink-3` and `--color-rule`. Decide whether to use Draft B's names (recommended) or add Draft A's names as aliases.
- **Primary CTA name on /colleges.** Draft A says "Request a pilot" (W3). Draft B's copy table says "Book a demo". Pick one. This plan uses "Request a pilot" as the primary and keeps "Book a demo" only if the owner wants a demo-first funnel.
- **Students page primary label.** Draft A says "Check a drive notice" (W2). Draft B's site map says "Check my eligibility". This plan uses "Check a drive notice" because the form is the thing the button opens.
- **Share-level wording for outcomes.** Draft A says the outcomes level shows "interview and offer status". Draft B's copy says "they see your offer, nothing else". This plan uses Draft A's wording, because A-6 and 4.4 show interviews counting in aggregates. Confirm with the share-level table in W3.
- **Grievance officer (launch blocker).** W6 shows a placeholder until a grievance officer is named (A5). Production sign-up stays off until then.
- **Event-count k** and the time-series granularity: see decision 4.

---

## Part 0. Fixes before any new page

These conflicts block everything below. They are settled here so the wireframes can be trusted.

### 0.1 Copy that is now false

Decision 1 replaces three things: the "student presses submit" rule, the PRD non-goal "Hirelane submitting applications", and auto-submit-opt-in.md's "not approved". Submission stays fixture-only until the owner runs a supervised pilot, so each line below has two versions. "Today (pre-pilot)" is what ships now. "At pilot launch" is the Draft A replacement, which assumes the flag is on.

| Where (capture) | Current line | Today (pre-pilot) | At pilot launch |
|---|---|---|---|
| main-landing, "How applying works", step 4 | "You press submit. Hirelane never applies for you." | "Your answers are ready on the company's own form. You press submit." | "Swipe right and Hirelane sends your application on the company's own site, from your Hirelane apply address. If their site blocks us, you finish it there with your answers ready." |
| main-landing, stat strip | "0 applications sent without the student" | Remove. (It reads as a dig at ourselves once auto-apply ships.) | Remove. Replace with nothing, or with a live count that has a stated basis (see 0.3). |
| students-page, "What Hirelane never does" | "Never applies for you. Students press submit on the employer's own site." | "Never submits without you. You press submit on the employer's own site." | "Never applies without your say. You agree once, every right swipe is your instruction, and you can switch to submitting yourself any time." Stops at CAPTCHAs and logins; you finish those yourself. |
| students-page, "How it works" step 3 | "Your answers are ready. You press submit. Reply tracking opens with early access." | "Your answers are ready. You press submit. Reply tracking opens with early access." | "Swipe right to apply. Replies come to your Hirelane address and show up in your inbox." |
| landing-colleges, "Built so students trust it" / trust line | "Hirelane never applies for them or charges them." | "Students apply on the employer's own site. Hirelane never charges students." | "Students choose to let Hirelane apply for them, and can see a receipt for every application. Hirelane never charges students." |
| auth-4-you, "What Hirelane never does" | "Apply or send anything in your name. You press submit on the company's own site." | Delete this line. | Delete this line. |
| auth-4-you, "What Hirelane never does" | "Your placement cell only sees totals, never you." | "Your placement cell sees totals. If you share outcomes, they see your interview and offer status." | "By default your placement cell sees only totals. If you share outcomes, they see your interview and offer status." |
| auth-1-signin, hero | "...and apply on the company's own site." | "...and get ready to apply in one swipe." | "...and apply with one swipe." |
| main-landing FAQ, "Does Hirelane apply for me?" | (answer text) | Use the answer in W7 with the pre-pilot wording. | Rewrite as in W7 (Help and FAQ). |

Notes:
- The "never sees you" line is false at the *outcomes* share level (screen audit). Say what each level shows, do not promise "never you".
- Pre-pilot copy names the employer's own form and does not claim a submission has happened. It does not promise a receipt for each application until the pilot runs.

### 0.2 Rejected patterns and time-cost copy

**Time-cost copy goes.** Draft A lists these, and Draft B's copy table replaces the first four:

| Where | Current | Replace with |
|---|---|---|
| main-landing, closing CTA | "Check which roles you qualify for in under a minute." | "See which roles you qualify for." |
| main-landing, resume feature | "...and fix it in minutes." | "...and fix it." |
| landing-colleges, hero CTA | "Book a 20-minute demo" | "Book a demo" (or "Request a pilot", see open items) |
| landing-colleges, form | "A 20-minute call with your placement team." | "A call with your placement team. We set up a pilot for one programme." |
| auth (approved onboarding) | "Three quick checks" | "Before we start" |

Also remove: "Book a 20-minute demo", "A 20-minute call", "Check which roles you qualify for in under a minute", "fix it in minutes", "Three quick checks". Functional limits stay, because they are facts the user acts on: "the code works for 10 minutes", "deleted within 24 hours".

**Other rejected patterns:**
- **Destructive action on a first-run screen.** auth-4-you shows "Delete your account" right after sign-up. Move it to Settings, Data (A-11 is the console equivalent; the student version is S-12 Settings, section 6, Account). The first-run screen keeps only "Next: your resume".
- **Screenshots of dev previews.** The main landing hero (console plus phone), the colleges page (three console screenshots) and the "For universities" band are all captures of dev pages. Replace them with server-rendered components (see 1.6).
- **Small floating cards.** The main landing phone mock overlapping the console, and the 4-up "How applying works" mini-cards. Replace them with full-width product moments, ruled rows or full-column panels.
- **Cards inside cards.** Use ruled rows.
- **Middle-dot meta.** Do not use joined meta strings anywhere. Job meta is separate chips or separate lines, as home-a already does ("Hyderabad", "On-site", "Rotational shifts"). Meta strings are commas or stacked lines, never middle dots.
- **Uppercase tracked labels and eyebrows.** No eyebrow labels above headings; the H2 does the work.
- **Streaks, flame counters, "N others applied", fake scarcity, badges for things that need no action, emoji counters** (the old mocks' "🔥 5 days" goes).
- **Score rings.** A score ring conflicts with "no fake score". The rule list replaces `ui/MatchRing`.

### 0.3 Numbers that break the honesty rule

- **Main landing: "16,828 open roles / 127 company career pages / 10,822 roles that state their pay."**
  - Problems: PRD says 129 companies. Most of those roles are not visible or relevant to an Indian fresher. CAMPUS-FIRST [db] counts 75 India entry or intern roles, which is what a tier-3 fresher can use.
  - Replace with live, dated queries scoped to what a student can actually be shown: roles in India plus remote-for-India (S7), entry or intern level, open, with an "as of {date}" line.
  - Candidate lines: `{india_entry_roles}` entry-level roles in India, open now; `{career_pages}` company career pages read daily; `{pay_roles}` roles that state their pay. Each has a basis line and "Updated {date}".
  - Counts are rendered on the server and cached hourly. They are never typed into copy.
  - If the scoped count is below the floor the owner sets (decision 4), show no stat strip at all. If a query fails, the line is hidden, not frozen at an old value. The page never shows "0".
  - The "₹0 charged to students, ever" cell is a fact, not a count. It can stay in the strip with the basis "No fee to apply, ever. A job that asks for one is flagged."
- **Console overview.**
  - "Smaller programmes (2, combined) 4 applied" shows a number under 10 (k violation). It must read "under 10", and the combined row is handled by the complementary rule in 3.8.
  - "45% of offers" in the list and "47%" in the breakdown table are two different bases shown side by side. Label each base explicitly ("share of offers" vs "share of applications") or use one.
  - "BBA, under 10" beside "26% of offers" lets the hidden value be recovered (26% of 31 is 8). A hidden count also hides its share (3.8).
- **Colleges page "38% NAAC 5.2.1 figure".** This is sample data inside a screenshot, and the screenshot goes anyway. The NAAC figure on the public site comes only from the labelled sample.
- **Outcomes figure.** Every stat in A-6 needs its basis written under it. Any stat without a basis is removed.

### 0.4 One register per surface

DESIGN.md says "playful, never toned down". The owner's verdicts approved calm chrome and rejected colour-heavy pages. The table below resolves this per surface.

| Surface | Register | Tokens used | Notes |
|---|---|---|---|
| Public website | **Light, calm, typographic.** Paper background, ink type, one lime accent per section at most | `--color-paper` background, `--color-ink` text, `--color-lane` for ✓, `--card-lime` nowhere on the site; `--color-lane` on the primary pill and the APPLIED stamp only | Giant display type is kept (at weight 600, see 1.2). Colour blocks are dropped. The colour-heavy Gen-Z pages are rejected. |
| Sign-in and onboarding | **As approved:** night background, cream tilted card, lime shadow block | as captured | Keep it. Only add steps. Bricolage stays here until decision 6. |
| Student app | **Direction A:** calm chrome (paper/sheet surfaces, ink text), colour only on role cards and stamps | role cards use `--card-lime`, `--card-sun`, `--card-blue`, `--card-pink`; status uses `--color-lane` ✓, `--color-sun-ink` ~, `--color-stop` skip | As home-a. |
| Admin console | **Dark analytics:** `--console-bg` background, lime series, one hero number | as campus-console; `--console-*` and `--series-*` | Approved. Fixes in A-2. |

Draft A's token names (`--color-cream`, `--color-lime`, `--color-line`, `--color-ink-muted`) map onto Draft B's tokens in section 1.3. Draft B's names are used throughout this plan.

### 0.5 Console privacy leaks

The approved overview leaks in three places: the "BBA, under 10" beside "26% of offers" pairing, the "Smaller programmes (2, combined) 4 applied" row (a count of 4), and the 45% vs 47% share mismatch. Rules for every console component are in 3.8. Fix list in A-2.

### 0.6 DESIGN.md: which parts this plan replaces

DESIGN.md says it is "locked" to Wrapped/playful. The owner has since approved calm chrome and rejected colour-heavy pages.

| DESIGN.md section | Status |
|---|---|
| Genre "playful", Theme "Wrapped stories", Feel refs Spotify Wrapped/Duolingo | **Replaced.** Genre: calm product. Feel refs: Linear, Ramp, Mercury, Vercel, Deel (craft only) |
| Material, "Colour: bold, flat blocks. Never toned down." | **Replaced.** Colour lives only on role cards (student) and data series (console). |
| Tokens: `--font-display/body: Bricolage` | **Replaced** by Geist (see 1.1). Bricolage on the approved auth screens is decision 6. |
| Tokens: ink, night, cream, lane, lime, pink, blue, sun, coral | **Kept** as brand and role-card hexes, renamed into the scopes in 1.3. |
| Detailing: real numbers, maths with misses, source and freshness line, undo, timestamps | **Kept** |
| Interaction: every gesture has a button; arrows and Space; undo lasts 4 s | **Kept** |
| House rules never-list (pure #fff text, `transition: all`, glass, resting shadows, invented stats, drawn browser window, emoji icons) | **Kept** |
| Open conflicts 1–3 (uppercase labels, emoji, middle dots) | **Closed in favour of the Hallmark Floor.** None of the three appear anywhere. |
| Shadow "none, depth from tilt" | **Changed.** Depth comes from 1px rules and surface steps. One pop shadow is allowed, for menus and sheets only. |

### 0.7 Fonts are split four ways today

- `app/layout.tsx` loads Overpass and `globals.css` maps `--font-sans` to it.
- `landing/Main.tsx` loads Geist.
- `student/Shell.tsx` and `campus/Console.tsx` load Public Sans.
- `account/AccountShell.tsx` loads Bricolage.

Plan: one load of Geist Sans and Geist Mono in the root layout. Overpass and Public Sans are removed. Bricolage stays on the approved auth screens until decision 6 is answered.

### 0.8 Owner notes and stale documents

Listed in the open items. Action: add the superseded notes before any new agent works from these files.

---

## Part 1. Visual system

The target is the calm confidence of a well-funded product site. It gets there through these choices:
- Real product, shown big and sharp.
- One claim per section.
- Hairline structure.
- Generous space.
- Numbers that carry a date.

We take craft from Linear, Ramp, Mercury, Vercel and Deel, never their assets, layouts or illustrations.

### 1.1 Fonts

- **Geist Sans**, variable, the only text face on the site, student app and console (pending decision 6).
- **Geist Mono**, only for identifiers, never for prose or headline numbers:
  - campus codes
  - the apply address (`rahul.k3x@apply.<domain>`)
  - receipt hashes
  - CSV column names in help text
- Tabular figures (`font-variant-numeric: tabular-nums`) on every number in tables, totals, prices and countdowns.
- Load with `next/font` in `app/layout.tsx`, Latin subset, `display: swap`, preloaded once. Draft A asked for a subset variable file with `font-display: swap` on the website; this is the same rule applied to Geist.
- **Check that ₹ (U+20B9) is in the subset**, or every price falls back to a different face.

### 1.2 Type scale

At most five sizes per surface. Sizes are written desktop / phone and set with `clamp()` between 390 and 1440. Line height and tracking follow each size.

**Public site**

| Token | Size | Line height | Weight | Tracking | Use |
|---|---|---|---|---|---|
| `--text-display` | 64 / 40 | 1.02 | 600 | -0.04em | hero H1 only, at most 2 lines, `text-wrap: balance` |
| `--text-title` | 40 / 30 | 1.08 | 600 | -0.03em | section H2, at most 2 lines |
| `--text-lede` | 20 / 18 | 1.5 | 400 | -0.005em | hero lede, section subtitles, H3 at weight 600 |
| `--text-body` | 16 / 16 | 1.6 | 400 | 0 | paragraphs, FAQ, nav |
| `--text-small` | 13 / 13 | 1.45 | 500 | 0.005em | captions, footnotes, "Updated" lines, table heads |

Draft A asked for "giant display type (weight 800)". This plan uses weight 600 from Draft B, which is the Geist scale. If the owner wants 800 on the H1 only, that is a one-line change in the token.

**Student app**

| Token | Size | Weight | Use |
|---|---|---|---|
| `--text-app-hello` | 28 / 24 | 600 | greeting, page title |
| `--text-app-role` | 26 / 22 | 700 | role title on the card |
| `--text-body` | 16 | 400/600 | rows, buttons |
| `--text-app-meta` | 14 | 400 | row second lines |
| `--text-small` | 13 | 500 | captions, freshness |

**Console**

| Token | Size | Weight | Use |
|---|---|---|---|
| `--text-hero-metric` | 96 / 1.0 | 600, -0.04em, tabular | one hero number per page |
| `--text-console-title` | 24 | 600 | page title (cohort name) |
| `--text-console-h` | 16 | 600 | section headings |
| `--text-console-body` | 14 | 400/500 | tables, lists |
| `--text-small` | 12 | 500 | axis labels, footnotes |

Rules:
- Headings never take an uppercase tracked label above them.
- Meta strings are commas or stacked lines, never middle dots.
- Every edge of a heading block is set with `text-wrap: balance`; body paragraphs use `text-wrap: pretty`.

### 1.3 Colour tokens

All tokens go in one Tailwind v4 `@theme` block in `apps/web/app/globals.css`. They replace the dark-green v3 values and the shadcn `@theme inline` duplicates. Surfaces are switched with `data-surface="site|app|console"` on the shell. Contrast on its own background must be at least 4.5:1 for text and 3:1 for UI. The security reviewer re-measures each pair.

**Site and student app (light)**

| Token | Hex | Use |
|---|---|---|
| `--color-paper` | #FAFAF8 | page background (Draft A's "cream") |
| `--color-sheet` | #FFFFFF | raised panels and image wells (background only, never text) |
| `--color-ink` | #0B0B0F | text, primary button fill |
| `--color-ink-2` | #45474D | secondary text |
| `--color-ink-3` | #6B6D73 | tertiary text, captions (≥ 4.5:1 on paper). Serves the role of Draft A's `--color-ink-muted`. |
| `--color-on-ink` | #FAFAF8 | text on ink buttons (no pure #fff text) |
| `--color-rule` | #E6E6E1 | hairlines, borders. Serves the role of Draft A's `--color-line`. |
| `--color-rule-strong` | #CFCFC8 | input borders, table head rule |
| `--color-lane` | #0F5C45 | brand: links, ✓ pass, focus ring on light, wordmark "lane", the primary pill, the APPLIED stamp |
| `--color-lane-soft` | #E8F3EE | pass chips |
| `--color-sun-ink` / `--color-sun-soft` | #8A5A00 / #FFF4D6 | "couldn't check", warnings, deadlines |
| `--color-stop` / `--color-stop-soft` | #B42318 / #FEF3F2 | fail rules, scam flags, errors |

**Role-card fills (student app only; the only saturated colour in the app)**

| Token | Hex | Text on it |
|---|---|---|
| `--card-lime` | #C8FF3D | ink |
| `--card-sun` | #FFC83D | ink |
| `--card-blue` | #3D5AFE | cream #FFF6E8 |
| `--card-pink` | #FF4FA3 | ink |

Cards rotate through lime, sun, blue, pink. Draft A's direction A lists lime, sun and blue; pink is added by Draft B's rotation.

**Console (dark analytics, also used for the dark band on the site)**

| Token | Hex | Use |
|---|---|---|
| `--console-bg` | #0E0F12 | page |
| `--console-panel` | #15171B | sidebar, panels |
| `--console-raised` | #1C1E23 | inputs, hover rows, active nav |
| `--console-rule` | #26282E | hairlines |
| `--console-ink` | #EDEDE9 | text |
| `--console-ink-2` | #A3A5AB | secondary |
| `--console-ink-3` | #7A7C82 | axis labels (verify ≥ 4.5:1) |
| `--console-signal` | #C8FF3D | chart line, active filter, action links |
| `--series-1..5` | #C8FF3D, #7C9CFF, #FFB547, #FF6B9A, #8A8D93 | stacked bar and breakdown dots; series 5 is "other / combined" |

- Never colour alone: every series also has a label and a fixed order.
- The site stays light. The console appears inside it as **captures** and as **one dark band** (section S6 of the home page) that uses the console tokens, so the hand-off from site to console feels like one product.

### 1.4 Spacing, grid and radius

- Base 4px. Scale: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128.
- **Website grid:** max width 1120 px, 12 columns on laptop, single column under 768 px. (Draft A.) Draft B's system sheet gives 1200 px and 24 px gutters; this plan uses 1120 px for the site and keeps Draft B's gutter and margin rules: 24 px gutters, side margins 32 px at ≥ 1024, 24 px at 640–1023, 20 px under 640, 4 columns on phones.
- **Section rhythm:** 120 px between sections on laptop, 64 px on phone (Draft A). Draft B says 128 / 72. Either is fine; this plan uses Draft A's numbers. Inside a section, heading to body is 16 px and body to media is 48 px.
- Must work at 320, 360, 390 and 430 px with `overflow-x: clip` on html and body (kept from DESIGN.md).
- Every edge (text column, image, rule) lands on a column line. There are **no small floating cards**: grouped content sits in ruled rows or full-column panels.
- Radius:
  - 10 px controls
  - 14 px panels and image frames
  - 999 px pills (buttons, chips)
  - 28 px phone-screen captures
- Hairlines are 1 px `--color-rule`. Depth comes from paper → sheet steps, not shadows.

### 1.5 Controls

- **Primary:** ink pill, `--color-on-ink` text, weight 600, 44 px tall (48 px on phones). One per screen, meaning one per viewport-height section and at most two per page (hero and closing CTA, never both visible at once). On the site, the primary pill is the one place `--color-lane` appears as a fill, per 0.4; Draft B has ink as the fill colour. Owner check: confirm ink or lane for the site primary.
- **Secondary:** 1 px `--color-rule-strong` outline pill of the same height, or a text link with an arrow glyph (SVG).
- **Nav CTA:** secondary style, so the hero primary stays the only primary above the fold.
- **States:**
  - hover darkens 6%
  - `:active` translateY(1px)
  - `:focus-visible` is a 2 px `--color-lane` ring with a 2 px offset, shown instantly
  - disabled is 40% opacity, plus a reason underneath when one exists

### 1.6 How product imagery is produced

1. **Real UI only.** Every image is a capture of the actual app running on the **single sample fixture**: one cohort, one student "Rahul", one Process Associate drive at 55% everywhere (audit item 1). No HTML mock-ups of the product, no Figma renders.
2. **Capture pipeline.** A Playwright script (proposed `pnpm capture:site`):
   - renders each route at `deviceScaleFactor: 2`, at 1440 and 390
   - adds `?capture=1`, which hides the Next.js dev indicator, any dev or build banner, the cookie prompt and the dashed "Sample" box
   - writes AVIF and WebP to `apps/web/public/product/` with fixed names
   - is re-run in CI when a captured route changes, with the image diff reviewed in the PR
3. **Sample label as a caption, not a banner.** Under each image: "Sample cohort and student. Real numbers come from your students' activity." in `--text-small`, `--color-ink-3`. (Demo builds show the sample caption under the page title instead.)
4. **Framing:**
   - 14 px radius, 1 px `--color-rule` border, no shadow
   - **no drawn browser chrome, no phone bezel, no fake address bar**
   - phone captures are the bare screen with a 28 px radius
   - dark console captures sit straight on paper with their own edge
5. **Zoomed details.** Each feature row uses one crop at 3x that proves one claim, for example:
   - the "show the maths" line
   - "3 of 9 checks pass" with its first fix
   - the scam flag on a pasted job
   - the k ≥ 10 footnote
   - the NAAC export button

   The crop is taken from a 2x capture of the real screen, not rebuilt.
6. **Weight:**
   - `<picture>` with AVIF, then WebP, with `srcset` 1x/2x and explicit `width`/`height` (no layout shift)
   - `loading="lazy"` everywhere except the hero, which gets `fetchpriority="high"`
   - no chart JS on the site: charts appear only inside captures
   - no images above the fold on the website pages other than the hero capture of the home page
7. **Product moments, not screenshots (Draft A, applied to every site page).** Every visual of the product is the real component (pick card, verdict line, health list, console hero number, breakdown row) rendered on the server from a fixed **labelled sample**: "Sample student" or "Sample cohort". It is static HTML/CSS, never a PNG of a dev page, and has no drawn browser or phone chrome. It is big: 7 to 8 of 12 columns on laptop and full width on phone. The capture pipeline above is for the zoomed crops and the console captures inside the app; the product moments on the site use the components directly. Both rules stand; the crops are the fallback where a component cannot be rendered on the site.

### 1.7 Motion

- **Public site and student app:**
  - CSS only, no animation library
  - animate only `transform` and `opacity`, never `transition: all`
  - durations: 120 ms (state), 200 ms (enter), 280 ms (card exit)
  - easing: `--ease-out-expo` for enters, `--ease-exit` for exits
- **No count-ups, marquees or scroll-jacking.** Numbers render at their final value. Delete `ui/CountUp.tsx` and `ui/Marquee.tsx`.
- **One allowed scroll effect:** media fades up 8 px once, via CSS `animation-timeline: view()` where supported. Content is fully visible without it (no JS, no hidden-until-observed state). The sticky header hairline appears after 8 px of scroll via CSS `animation-timeline: scroll()`.
- **Swipe:** the card follows the finger 1:1. On release it eases out over 280 ms. The "Applied" stamp scales 1.08 → 1 over 120 ms. The undo bar slides up over 200 ms.
- **Console (laptop, staff):**
  - the chart crosshair follows the pointer with no transition
  - the tooltip fades in over 120 ms
  - toggle-table rows cross-fade over 120 ms
- **Reduced motion** (`prefers-reduced-motion`): every duration is 0. A swipe becomes an instant state change, and the toast still appears.

### 1.8 Craft details that separate a 9/10 site from a 3/10 one

1. **Typography that has been set, not just chosen.**
   - display tracking tightened per size
   - `text-wrap: balance` on headings, `pretty` on paragraphs
   - tabular figures in every number column
   - real ₹, en dashes in ranges ("2025–26"), curly apostrophes
   - no orphaned single words in the H1 at 390, 1024 or 1440
2. **One grid, one hairline.**
   - Every text column, image edge and rule lands on the same 12 columns.
   - One rule colour and one radius per element type.
   - Cards-in-cards and floating mini-cards are gone; grouping is done with ruled rows.
   - The 3/10 tell is a dozen boxes of slightly different radius and shadow.
3. **Product shown at full size and sharp.**
   - One big 2x capture, with zoomed crops that each prove one sentence next to them.
   - Nothing blurry, nothing at 60% scale, no dev banners, no drawn chrome.
   - The image *is* the argument.
4. **Every state designed:**
   - hover, `:active` and focus-visible on every link
   - an active nav item
   - a real 404
   - per-page Open Graph images, made from the same captures
   - favicon and Apple touch icon
   - a complete footer
   - a form success and error state on the demo or pilot form
   - Missing states are where cheap sites show their seams.
5. **Copy discipline with dated numbers.**
   - Headings of 8 words or fewer, each making one specific claim.
   - No adjectives like "powerful" or "seamless".
   - Every number carries a source or an "Updated" date, and anything without a basis is removed (audit item 9).
   - Plain statements of what we never do.
   - This is the main thing that makes funded sites sound sure of themselves.

Performance counts as craft too. Targets on a mid Android over 4G: LCP ≤ 2.0 s, CLS ≈ 0, and zero client JS on `/` apart from the native `<details>` FAQ. These are targets to measure, not claims.

---

## Part 2. Public website

### 2.0 Rules for every website page

- **Weight.**
  - Server-rendered with 0 KB of client JS by default.
  - FAQ uses `<details>`.
  - The eligibility try-it is a plain `<form method="post">` that returns a server-rendered verdict.
  - Fonts: one variable Geist file, subset, `font-display: swap` (see decision 6).
  - Images: none above the fold, except the home hero capture.
- **Product moments, not screenshots.** (See 1.6, item 7.)
- **Copy and layout.**
  - One primary button per page: an ink pill on paper.
  - The header "Sign in" is a text link, not a second primary.
  - No eyebrow labels above headings; the H2 does the work.
  - Grid, rhythm and breakpoints as in 1.4.
- **Honest data.**
  - Live counts come from the DB with an "as of" date.
  - Every sample is labelled "Sample".
  - No logos, testimonials, "trusted by" rows or partner names until real ones exist in writing.

**Global header.**
- Left: wordmark.
- Centre (laptop): For students, For placement cells, Pilot, Help.
- Right: "Sign in" text link.
- Phone: wordmark plus "Sign in", with a menu button that opens a full-height sheet with the four links. The sheet is CSS-only, using `:target` or `<details>`.
- Signed-in students who visit `/` see "Open Hirelane" → `/home` in place of "Sign in". Nothing is personalised on public pages.

**Global footer** (four columns on laptop, stacked on phone):
- Product: For students, For placement cells, Open roles, Pilot.
- Company: About, Contact.
- Trust: Security and privacy, Terms, Privacy notice, Grievance officer.
- Sign in: Student sign in, Placement cell sign in.
- Last line: "Hirelane never charges students."

### 2.1 Site map (both audiences)

| Route | For | Primary button |
|---|---|---|
| `/` | both; students first, placement cells second | Get started, it's free |
| `/students` | students; includes the no-sign-in eligibility check | Check a drive notice |
| `/colleges` | placement cells | Request a pilot |
| `/pilot` (new) | placement cells | Request a pilot |
| `/about` (exists) | all | Contact us |
| `/security` (new) | all | none (contact link) |
| `/help` (new) | all | none (footer contact link) |
| `/jobs` | signed-out and under-18 visitors (public roles page) | none (browse) |
| `/signin` (approved) | students | Send me a code |
| `/campus/signin` (new) | placement staff | Send me a code |
| `/privacy`, `/terms`, `/contact`, 404 | all | none |

### W1. Home (`/`)

- **Single job:** within one screen, make a fresher believe "these are jobs I can actually get, and applying is one swipe", and give a placement officer an obvious door.
- **Sections, in order:**
  1. **Hero.**
     - H1: "Off-campus jobs, matched to your marks." (keep; the owner has not objected to the line).
     - One sentence (pre-pilot, see 0.1): "Hirelane checks every role against your percentage, backlogs, batch and branch, and gets your application ready on the company's own site." At pilot launch: "Hirelane checks every role against your percentage, backlogs and batch, then applies for you when you swipe right."
     - Primary: **Get started, it's free** → `/signin`.
     - Secondary text link: "I run a placement cell" → `/colleges`.
  2. **One product moment.** The real pick card for the sample student, shown large: role, company, pay with its source, "You qualify: 3 of 3 rules", and the maths line. Beside it on laptop (below it on phone) are three lines that explain it:
     - "Checked against your marks"
     - "Applied from your Hirelane address" (pre-pilot: "Ready for your Hirelane address")
     - "Replies land in your inbox"
  3. **Live count strip.** Only if the floor is met (0.3, decision 4). Two or three numbers, each with a basis line and "as of {date}".
  4. **How applying works.** Three full-width rows, each pairing a short paragraph with one real component:
     1. "Every role is checked against your marks." Shows the verdict list with ✓, ~, ✕ and the maths.
     2. "Swipe right to apply." Shows the APPLIED stamp and a receipt row: apply address, resume version, time. (Pre-pilot: the stamp reads READY and the row shows "Ready to submit on their site".)
     3. "If a site blocks us, you finish it there." Shows the fallback row: "Finish on their site, answers ready".
  5. **Resume a hiring system can read.** The real health list ("6 of 9 checks pass", failing first, each with a fix). No score out of 100.
  6. **Found a job somewhere else?** The paste-a-job verdict, with the scam flags shown in their real form.
  7. **For placement cells band.** Dark-register band with the console hero-number component ("Sample cohort"), the breakdown list of 3 rows, and one line: "Off-campus outcomes your placement cell can file for NAAC 5.2.1." Link: "See how it works for placement cells" → `/colleges`.
  8. **What we do and don't do.** Four plain statements:
     - apply only when you swipe right
     - never charge students
     - placement cells see totals unless you share
     - delete everything within 24 hours
  9. **Questions.** Five `<details>` items; "All questions" → `/help`.
  10. **Closing line and footer.** No second primary button; a repeated "Get started" text link is fine. Closing line: "See which roles you qualify for."
- **Primary action:** Get started, it's free.
- **Data:** counts are live queries (jobs table filtered by India or remote-for-India, entry or intern, open). All cards are the fixed labelled sample, shared with the onboarding demo so the numbers match across pages (audit item 1).
- **Interactions:** none beyond links and `<details>`. The pick card is static; it does not swipe on the website.
- **States:**
  - Count query fails or is below the floor: the strip is omitted. The page never shows "0".
  - No loading state, because the page is server-rendered.
- **Phone vs laptop:**
  - Phone: the hero H1 is two lines at most and the product moment follows it.
  - Laptop: the hero is split 5/7 with the card on the right.
  - The placement-cell band is full-bleed dark on both.

**Wireframe 1.10 (home page, Draft B layout).** The section order below is Draft B's layout. Draft A's W1 order (sections 1–10 above) is the content order. Mapping: W1.1 hero = S1; W1.2 product moment = S1 image side and S4 row 1; W1.3 count strip = S2; W1.4 how applying works = S3 and S4; W1.5 resume = S4 row 2; W1.6 paste = S4 row 3; W1.7 cells band = S6; W1.8 never list = S5; W1.9 questions = S7; W1.10 closing = S8 and S9. Decision on the final order is part of the review; this plan defaults to Draft A's order and uses Draft B's wireframes for the layout.

**S0. Nav (sticky, 64 px, paper with a bottom hairline after 8 px of scroll, via CSS `animation-timeline: scroll()`)**
```
+------------------------------------------------------------------------------------------------+
| hirelane         For students    For placement cells    Jobs                Sign in  (Get started) |
+------------------------------------------------------------------------------------------------+
  wordmark          text links, ink-2, active = ink + 2px lane underline           secondary pill
```
Phone: wordmark, "Sign in", and a menu button (native `<details>` disclosure, no JS).

**S1. Hero (left-aligned, cols 1–8 for text)**
```
|                                                                                                |
|   Off-campus jobs,                                                                             |
|   matched to your marks.                                    <- --text-display, 2 lines max     |
|                                                                                                |
|   Hirelane checks every role against your percentage, backlogs, batch and branch,              |
|   and gets your application ready on the company's own site.     <- --text-lede, ink-2         |
|                                                                                                |
|   ( Get started, it's free )     For placement cells  ->                                       |
|                                                                                                |
|   +------------------------------------------------------------------+  +------------------+   |
|   |                                                                  |  |                  |   |
|   |   CONSOLE CAPTURE (dark), overview at 1440 @2x, cols 1-9         |  |  PHONE CAPTURE   |   |
|   |   hero number, breakdown list, area chart visible                |  |  Home at 390 @2x |   |
|   |   14px radius, 1px rule, no browser chrome                       |  |  cols 10-12      |   |
|   |                                                                  |  |  28px radius     |   |
|   |                                                                  |  |  same top edge   |   |
|   +------------------------------------------------------------------+  +------------------+   |
|   Sample cohort and student. Real numbers come from your students' activity.                   |
```
- The phone sits **in the grid on the same top edge**, never overlapping or floating over the console.
- Phone: text, then the phone capture only (full width minus margins). The console capture appears later, in S6.
- At pilot launch, the lede becomes: "…and applies on the company's own site when you swipe right."
- Draft A's W1.2 product moment (the pick card, large) is the hero's image side on laptop. Use the real pick card component, not the console capture, if the owner accepts Draft A's order. Both are shown here because Draft B's layout uses the console capture.

**S2. Proof strip (4 columns, hairline above and below)**
```
|---------------------------------------------------------------------------------------------- |
|   75                       129                       {n}                      ₹0                |
|   entry-level roles        company career pages      roles that state         charged to        |
|   in India, open now       read daily                their pay                students, ever    |
|---------------------------------------------------------------------------------------------- |
|   Counts from our own index, updated 29 Oct. We never scrape job boards.                        |
```
- Live values, tabular figures. No invented numbers, logos or testimonials, and no logo wall until there are signed pilots with written permission.
- The "75" and "129" values in this wireframe are the figures from Draft B and CAMPUS-FIRST. They are shown as placeholders; the live query and floor in 0.3 decide what renders. The 129 figure is a company count, not a role count.
- Phone: a 2×2 grid.

**S3. "From swipe to submitted" (four steps, each a zoomed crop)**
```
|   From swipe to submitted,                                                                    |
|   without retyping.                                       <- --text-title                      |
|                                                                                                |
|   +--------------------+  +--------------------+  +--------------------+  +--------------------+|
|   | crop: pick card    |  | crop: Needs you    |  | crop: receipt /    |  | crop: reply in     ||
|   | "You qualify:      |  | answered once,     |  | company form       |  | tracker            ||
|   |  3 of 3 rules"     |  | from answer bank   |  | with answers ready |  |                    ||
|   +--------------------+  +--------------------+  +--------------------+  +--------------------+|
|   Swipe roles you          Answer once           Apply on their site      Replies come to you   |
|   qualify for              Questions only you    (pre-pilot text from     at your Hirelane      |
|   Every pick passes your   can answer are asked  table 0.1)               apply address         |
|   marks, rule by rule.     once and reused.                                                     |
```
- Crops are full column width, joined by a hairline (not separate boxed cards). Captions are H3 plus one sentence.
- Phone: one column, crops at full width.

**S4. Feature rows (three alternating rows; text cols 1–5, image cols 7–12, then flipped)**
```
|   Know before you apply.                         +------------------------------------------+ |
|   Every role and drive is checked against        | 3x crop: show-the-maths line             | |
|   your own marks. When a CGPA is converted,      | "8.1 CGPA = 73.5% by your university's   | |
|   you see the rule and where it came from.       |  rule, needs 60%: you qualify"           | |
|                                                  | + source and checked-date line           | |
|   See the eligibility check  ->                  +------------------------------------------+ |
|                                                                                                |
|   +------------------------------------------+   A resume hiring software can read.            |
|   | 3x crop: "3 of 9 checks pass", first fix |   See what an applicant tracking system sees,  |
|   | "An ATS can't read this file" + 2 fixes  |   fix the first two problems, or build one     |
|   +------------------------------------------+   from 8 questions.                             |
|                                                                                                |
|   Scam check on anything you paste.              +------------------------------------------+ |
|   Got a job on WhatsApp? Paste it. We flag       | 3x crop: paste-a-job verdict with fee    | |
|   fee requests, Telegram-only HR and free-mail   | flag, from the real paste screen         | |
|   recruiters.                                    +------------------------------------------+ |
```
- Each row links (text link, not a button) to `/students#…`.
- The referral row ("See who you know") is left out until R10 ships, so the site never shows a feature that isn't real.
- Phone: text, then image, for each row.

**S5. What Hirelane never does (ruled list, not cards)**
```
|   What Hirelane never does                                                                     |
|   ---------------------------------------------------------------------------------------------|
|   Charge students.               No fee to apply, ever. A job that asks for one is flagged.     |
|   ---------------------------------------------------------------------------------------------|
|   Show marks to colleges.        Placement cells see totals; groups under 10 are hidden.        |
|                                  Outcomes only if a student shares them.                         |
|   ---------------------------------------------------------------------------------------------|
|   Scrape job boards.             Roles come from company career pages and your college's drives.|
|   ---------------------------------------------------------------------------------------------|
|   Submit without you.            (pre-pilot / pilot text from table 0.1)                        |
```
Draft A's "What we do and don't do" (apply only on swipe, never charge, totals unless shared, delete within 24 hours) is used as the final list in W1.8. Use both lists: this S5 row set plus the 24-hour deletion line, with the final wording set in 0.1.

**S6. For placement cells (full-bleed dark band, console tokens)**
```
|##############################################################################################|
|#  Placement help after the drives end.                      +-------------------------------+#|
|#                                                            | console capture: overview      |#|
|#  For the students your on-campus drives don't place:       | hero metric + totals row       |#|
|#  eligible off-campus roles, resumes software can read,     | (dark on dark, 1px rule)       |#|
|#  and offers you can file for NAAC 5.2.1.                   |                                |#|
|#                                                            +-------------------------------+#|
|#  ----------------------------------------------------------                                   #|
|#  See where unplaced students stop.     Paste a drive, reach only eligible students.          #|
|#  Verify off-campus offers and download the 5.2.1 list.                                       #|
|#                                                                                              #|
|#  ( See how placement cells use it -> )   secondary on dark; the primary lives on /colleges   #|
|##############################################################################################|
```
- This band shows the dark console inside the light site. The Draft A version of this band uses the hero-number component ("Sample cohort"), the breakdown list of three rows, and the one-line NAAC statement; the capture above is the Draft B alternative. Use the component.
- It works alongside the placement ERP; mention the import from Superset or any ERP in one line.
- Phone: text, then the component (scaled to its phone layout), then the link.

**S7. Questions (native `<details>`, zero JS)**

Questions:
- Does Hirelane apply for me?
- Where do the jobs come from?
- Is it free for students?
- Can my college see my marks?
- What if I don't qualify for a role?
- What is my Hirelane apply address?

Answers follow 0.1 and the share-level copy. Full answers are in W7.

**S8. Closing CTA**
```
|   See which roles you qualify for.                                                             |
|   ( Get started, it's free )     Try the eligibility check without signing in ->               |
```

**S9. Footer (4 columns, hairline above)**
- Wordmark and one line
- Product: For students, For placement cells, Jobs
- Company: Contact, Privacy, Terms, Grievance officer (when named)
- "Hirelane never charges you to apply."

**Phone stack (390)**
```
+--------------------------------------+
| hirelane              Sign in  [=]   |
|--------------------------------------|
| Off-campus jobs,                     |
| matched to your marks.               |
| Hirelane checks every role against   |
| your percentage, backlogs and batch. |
| ( Get started, it's free )           |
| For placement cells ->               |
| 75 entry-level roles in India...     |
| +----------------------------------+ |
| |      phone capture, Home @2x     | |
| +----------------------------------+ |
| Sample student. Real numbers come... |
|--------------------------------------|
| 75          | 129                    |
| roles       | career pages           |
| {n}         | ₹0                     |
|--------------------------------------|
| S3 steps, one per row                |
| S4 rows, text then crop              |
| S5 ruled list                        |
| S6 dark band                         |
| S7 questions, S8 CTA, S9 footer      |
+--------------------------------------+
```

### W2. For students (`/students`)

- **Single job:** let a student test the core promise (eligibility honesty) before signing in.
- **Sections:**
  1. H1 "Jobs you can actually get." One line. Primary: **Check a drive notice** (jumps to the form). Draft B's site map calls this "Check my eligibility"; the label is an open item.
  2. **Try it.**
     - Paste a drive notice or job post, enter 10th, 12th or diploma, graduation % or CGPA, degree, passout year and active backlogs, then press Check (form POST).
     - The result renders server-side under the form: each rule with ✓/✕/unknown and the maths.
     - Line: "Nothing you type here is saved."
  3. **What you get after signing in.** Four rows with real components:
     - picks you qualify for
     - resume health
     - swipe to apply with your Hirelane address (pre-pilot: "ready to apply from your Hirelane address")
     - inbox with replies and scam flags
  4. **Your apply address.** What it is (`yourname.x3k@apply.<domain>`), why replies come to us, that every message is forwarded to you right away, and that it keeps working after you leave.
  5. **What we do and don't do** (rewritten per 0.1).
  6. **Under 18?** One line: "Hirelane accounts are for 18 and over. You can still browse open roles." Link → `/jobs`.
- **Primary:** Check a drive notice. "Sign in" stays in the header.
- **Data:**
  - Rule parsing uses `engine/eligibility.ts`.
  - CGPA conversion: if the student picks a university, the converted value cites the rule table row (source URL and date checked). Otherwise the line reads "unknown: pick your university".
- **Interactions:** form POST only, and the result page is shareable without the student's numbers (no query string).
- **States:**
  - Empty notice: inline error "Paste the notice text first".
  - Unparseable notice: "We couldn't find any rules in this text. Paste the eligibility part."
  - Parser down: a 500 page with "Try again", and the form keeps its values.
- **Phone vs laptop:**
  - Phone: the form fields are one column. Numeric fields use `inputmode="decimal"`.
  - Laptop: the form and result sit side by side.
- **Eligibility try-it (component `EligibilityCheck`):** idle, checking, result (pass / fail / unknown), error.

### W3. For placement cells (`/colleges`)

- **Single job:** get a placement head or TPO to request a pilot, and give existing staff a sign-in door.
- **Sections:**
  1. H1 "Placement help after the drives end." One sentence. Primary: **Request a pilot** (anchor to the form). Text link: "Placement cell sign in" → `/campus/signin`.
  2. **The console, rendered.** One large dark component built from the real overview pieces (hero number, breakdown list, totals row), labelled "Sample cohort". It is not a screenshot.
  3. **Three capabilities**, one row each with its real component:
     - "See where unplaced students stop": stacked bar plus blocker list.
     - "Paste a drive notice; only eligible students see it": the parsed-rules block and the "Who this reaches" count, with the unknown-verdict count shown.
     - "Verified off-campus offers, exported for NAAC 5.2.1": the offer-review row and the export button.
  4. **Works next to your ERP.** Roster CSV import from Superset or any export. We store an email hash and a placed flag, not names or roll numbers.
  5. **What students control.** Share levels in a 3-row table (aggregate, outcomes, full), what the cell sees at each level, k ≥ 10, and the view log students can read.
  6. **Request a pilot.**
     - Fields: name, college, role, work email, programmes of interest (optional).
     - Copy: "We set up a pilot for one programme for one semester." No duration of the call.
- **Primary:** Request a pilot.
- **Data:** all samples are labelled. The form writes to the existing contact pipeline.
- **Interactions:** the form POSTs and returns a thank-you state on the same URL.
- **States:**
  - Submitted: "Thanks. We'll reply to {email} from a hirelane address."
  - Invalid email: inline error.
  - Server error: the form is kept, plus a "write to us" mailto.
- **Phone vs laptop:** the console component scales down to its phone layout (the real responsive component) instead of a shrunken screenshot.
- **Share-level table (sections 5 and A-10 contract):**

  | Share level | What the cell sees |
  |---|---|
  | Aggregate (default) | Counts in totals only. Nothing per student. |
  | Outcomes | Totals, plus your interview and offer status. Your offer can be verified and exported for NAAC 5.2.1. |
  | Full | Outcomes, plus the other fields the student chose to share. Shown in A-3 and A-7 only as the console allows. |

  The "Full" row is not defined in either draft beyond the level name. Confirm the contents with the owner before W3 is built.

### W4. Pilot (`/pilot`, **new**; no public prices)

- **Single job:** explain what a pilot asks of the college and what it gets, without prices. Prices in CAMPUS-FIRST §9 are tagged [assumption], so they stay owner-only.
- **Sections:**
  1. H1 "Run a one-semester pilot."
  2. **What you get.** Cohort dashboard, drive paste and publish, outcome verification and the NAAC 5.2.1 export, plus free accounts for your students.
  3. **What we need from you.**
     - a cohort CSV
     - IT to allowlist our sending domain (M3)
     - one named staff owner
     - a student announcement (we draft it)
  4. **How we decide together.** The written success bar is agreed at the start; the bar is not published here.
  5. **After the pilot.** "Pricing is agreed per college." Contact.
  6. Request a pilot (same form component as W3).
- **Primary:** Request a pilot.
- **States:** as in W3.
- **Owner decision:** whether this page lists prices once §9 is decided (open item).

### W5. About (`/about`, exists)

- **Single job:** show who is behind Hirelane and how it gets jobs legally.
- **Sections:**
  1. Why we built it (the unplaced tail, in plain words).
  2. Where roles come from: company career pages on public ATS boards, plus drives your placement cell pastes. We never scrape job boards.
  3. Who we are: names and photos only if the owner provides them. Otherwise omit the section.
  4. Contact.
- **Primary:** Contact us.
- **States:** none.

### W6. Security and privacy (`/security`, **new**)

- **Single job:** answer a TPO's, a parent's or a cautious student's "is this safe?" in one place.
- **Sections:**
  1. **What we keep, and for how long.** Resume files are encrypted, downloads are logged, and everything is deleted within 24 hours of a request.
  2. **What your placement cell sees.** The share-level table and the k ≥ 10 rule. Students can read the log of every staff view of their data.
  3. **Applying for you.** Covers:
     - the one-time consent
     - the apply address
     - receipts (what was sent, when, and the result)
     - switching it off
     - that we never get past CAPTCHAs or logins
  4. **Your apply address and messages.** Covers:
     - we receive employer mail and forward it to you
     - raw messages are stored encrypted
     - scam flags on replies
  5. **AI use.** We make no AI calls on your resume unless you turn it on (`llm_resume` consent).
  6. **Grievance officer.** Name and contact.
     - **Placeholder state** while unnamed (A5): "Accounts open once our grievance officer is appointed." Production sign-up stays off until then.
- **Do not mention:** Aadhaar or PAN (R4 de-scoped).
- **Primary:** none. A "Contact the grievance officer" link is enough.
- **Phone vs laptop:** single column on both, with a sticky in-page contents list on laptop only.

### W7. Help and FAQ (`/help`, **new**)

- **Single job:** answer the questions that block sign-up or adoption.
- **Sections:** two groups, each a list of `<details>`, plus a search box (form GET filtering on the server).
  - **Students:**
    - Does Hirelane apply for me? (Pre-pilot: "Not yet. When you swipe right, Hirelane gets your application ready on the company's own site, with your Hirelane address ready to use. Once the pilot is live, Hirelane sends it for you when you swipe right, and you can switch to submitting yourself any time.")
    - What is my apply address?
    - Where do the jobs come from?
    - Is it free?
    - Can my college see my marks?
    - What if I don't qualify?
    - I didn't get the sign-in code
    - How do I delete my account?
  - **Placement cells:**
    - What do we see?
    - How does the roster import work?
    - What goes in the NAAC 5.2.1 export?
    - Do we need to change our ERP?
    - How do students join?
- **Primary:** none. The footer contact link is enough.
- **States:** search with no results shows "No answer for that yet" plus a contact link.

### W8. Sign in (`/signin`, `/signin/code`, `/welcome`; approved, keep)

- **Keep:** the night register, tilted cream card, email code first, the Google button, and the in-app-browser note.
- **Add:** "Continue with LinkedIn" (A6, OIDC) under Google, as a secondary outline pill.
- **Change:**
  - Remove the "Find jobs you can actually get" hero repeat on phone above the card if it pushes the email field below the fold at 360 px.
  - The progress bars on the card become **5 segments** to cover the onboarding additions (S-0).
- **Inside the Instagram or WhatsApp in-app browser:** the email code is the default (Google is blocked there). Keep the in-app-browser note.
- **Staff:** do not mix staff into this page. Placement staff use `/campus/signin`, and the footer links both.

### W9. Open roles, public (`/jobs`, exists; added because under-18 and signed-out visitors land here)

- **Single job:** a read-only list of open entry-level roles, with no account.
- **Sections:** filters form (city, role family, remote-for-India), then a result list with source and freshness per row, paginated.
- **Primary:** "Sign in to check if you qualify" on each row's detail page (`/job/[slug]`), not on the list.
- **States:**
  - Empty filter: "No open roles match. Clear filters."
  - Zero rows for India: say so honestly.

---

## Part 3. Student app

### 3.0 Rules for every student page

- **Weight.**
  - Server-rendered, at most 100 KB of client JS per page (P2).
  - The swipe deck is the only page with gesture JS, and every gesture has a button.
  - Async work (resume reading, submission, CSV) uses a server-rendered status page. A `<meta http-equiv="refresh" content="3">` fallback polls it, plus a progressive script of at most 2 KB.
- **Shared building blocks** (used everywhere, one source of truth):
  - **Verdict line:** "You qualify: 3 of 3 rules", "We couldn't check: your CGPA scale", or "Needs 60% in 12th, you have 58%".
  - **Maths line (E6):** "8.1 CGPA = 73.5% by {University}'s rule, needs 60%". Links to the rule source and its date checked.
  - **Source line:** "From {Company}'s careers page, checked {relative time}" or "From your placement cell, published {date}".
  - **Receipt row:** apply address used, resume version, time, result.
  - **Undo toast:** 4 seconds.
- **One sample data set.** The labelled sample student and cohort are one fixture, so a drive has one rule set on every page (audit item 1).
- **Layout.**
  - Phone: bottom tab bar, 56 px in Draft A and 64 px in Draft B's shell; this plan uses 64 px with labels always shown, and safe-area padding.
  - Laptop: the left rail as in home-a (full height, fixed, 240 px), content at most 1040 px. Pages with a detail view use a two-pane layout.
  - No dashed "Sample" box in real use. Demo builds show the caption line under the page title instead.

### S-0. Onboarding (approved; extend, don't redesign)

Steps, each on the approved cream card with a 5-segment progress bar:

1. **Sign in.** Email code, Google or LinkedIn (exists, plus LinkedIn).
2. **Code** (exists).
3. **Create your account** (exists): 18+, terms, privacy.
   - Copy change: "Three quick checks" becomes "Before we start". This is no longer the last step.
   - "I'm under 18" → `/welcome/under-18` (exists; primary "Browse open roles" → `/jobs`). Under 18 → "Come back at 18", with nothing stored.
4. **How applying works (new).**
   - **Heading:** "When you swipe right, Hirelane applies for you." (Pre-pilot heading: "When you swipe right, Hirelane gets your application ready.")
   - **Body:** "We fill the company's form from your resume and your answers, and send it from your Hirelane address: `{handle}@apply.{domain}`. Replies come to your inbox here. If a site blocks us, you finish it there with everything ready. You'll see a receipt for every application."
   - **Primary:** **Turn on swipe to apply**. This records consent kind `auto_apply` with a timestamp.
   - **Secondary:** "I'll submit myself", which records the choice. Swipe right then opens "finish on their site" every time.
   - Line: "You can change this any time in Settings."
   - One-line link to `/security` for what we never do. The "What Hirelane never does" list moves there.
5. **Join your college (new; skippable).**
   - Two tabs: college email (send a code to `@college.edu`) or campus code.
   - Then pick a cohort: passout year and programme, shown as radio rows.
   - Then the share level, with three radio rows; default *aggregate*. Each row says exactly what staff see.
   - Primary: **Join**. Secondary text: "Skip, I'm not with a college on Hirelane".
6. **Your resume (new).** Three choices as full-width rows; the first is the primary:
   - **Upload PDF or Word file** (primary)
   - Upload your LinkedIn data ZIP
   - Build one from questions

   Then come Reading, Health and Confirm (S-9), then the Eligibility profile (S-10) with the university CGPA picker, then Home.

- **Removed from first run:** "Delete your account" (moved to S-12) and the "What Hirelane never does" list. The list moves to `/security`, with a one-line link on step 4.
- **Auth copy:** the onboarding steps keep the approved night card. The student app that follows is on paper.
- **States:**
  - College email domain unknown: "Your college isn't on Hirelane yet. Ask your placement cell, or skip."
  - Code wrong or expired: as in auth-2b.
  - Upload failed: S-9 states.
- **Phone vs laptop:** the same card. On laptop the left half keeps the giant H1 of each step.

### S-1. Home (`/home`)

- **Single job:** show what changed since yesterday and the one next thing to do.
- **Sections:**
  1. Greeting, plus the honest line "{n} new roles you qualify for since yesterday". If 0, say "No new roles since yesterday".
  2. **Needs you strip.** Only rendered if items exist, at most 3, newest first:
     - security code from an employer (pinned, with a copy button)
     - "finish on their site" items
     - interview asks
     - round reminders with documents to carry
  3. **Today's picks.** The top card of the deck with its action row. "1 of {n}" with story bars.
  4. **Drives from your college.** Eligible and unknown only, at most 3 rows. Each row shows the verdict line and a deadline chip. "All drives" → `/drives`.
  5. **Your resume.** Only shown while health is below 9 of 9. Shows "{k} of 9 checks pass" and the top failing check.
  6. **More ways in.** Paste a job; people you know at {n} companies hiring (only if network data exists).
- **Primary:** Apply (✓) on the top pick.
- **Data:**
  - picks: worthwhile gate plus eligibility engine
  - drives: campus drives published to the student's cohort where the verdict is pass or unknown
  - needs-you: `inbound_messages` (classification `security_code`, `interview_ask`) and the applications state machine (`blocked_fallback`)
  - health: the latest resume's checks
- **Interactions:** the card actions as in S-2; rows link to their pages.
- **States:**
  - Loading: none, because it is server-rendered.
  - No resume confirmed yet: sections 3 to 5 collapse into one card, "Add your resume to see roles you qualify for" (primary).
  - No picks today: the card is replaced by "You've seen today's picks" plus the next refresh time and a "Paste a job" row.
  - Not joined a campus: the drives section becomes "Join your college to see its drives" (secondary).
  - Error loading a section: that section shows "Couldn't load this. Refresh." and the others still render.
- **Phone vs laptop:**
  - Phone: one column in the order above.
  - Laptop: picks on the left (7 columns); needs-you, drives, resume and more-ways on the right (5 columns), as in home-a.

**Wireframe 2.1 Home: phone (390).**
```
+--------------------------------------+
| hirelane                        (R)  |
|--------------------------------------|
| Good morning, Rahul                  |   --text-app-hello
| 3 new roles you qualify for          |   count = roles that became eligible since
| since yesterday                      |   the student's last visit; 0 has its own copy
|                                      |
| +----------------------------------+ |   top slot only when it exists, newest first:
| | Reply from Zenoti                | |   1 reply  2 round tomorrow  3 drive closing today
| | "Can you do a call Thursday?"    | |
| | to rahul.k3x@apply.<domain>      | |   Geist Mono for the address
| |                         Open  >  | |
| +----------------------------------+ |
|                                      |
| Today's picks                 1 of 3 |
| ======------  ----------  ---------- |   story-bar progress, lane on rule
| +==================================+ |
| |  LIME ROLE CARD                  | |   the only saturated block on the page
| | [Z] Zenoti                       | |
| | Software that salons and spas    | |
| | run on                           | |
| |                                  | |
| | Customer Support Associate       | |   --text-app-role
| | Hyderabad, on-site               | |   comma meta, no dots
| | Rotational shifts                | |
| | +------------------------------+ | |
| | | ₹3.6 LPA                     | | |
| | | about ₹30,000 a month        | | |
| | | before tax                   | | |
| | +------------------------------+ | |
| | You qualify: 3 of 3 rules        | |
| | 4 of 5 must-haves  ========--    | |
| | Posted 2h ago, careers.zenoti.com| |   source and freshness line
| | Why you fit, the day, the rounds>| |
| +==================================+ |
|                                      |
|     ( X )     ( + )     ( ✓ )         |   pass, save, apply; 56px; ✓ = primary
| Drag the card, use the buttons, or   |
| press the arrow keys.                |
|--------------------------------------|
| Drives from your college   All drives|
| Process Associate        2 days left>|   sun chip; 55% rule, same as console
| You meet all 4 rules                 |
|--------------------------------------|
| Relationship Officer     5 days left>|
| We couldn't check: your CGPA rule    |
|--------------------------------------|
| Your resume                          |
| 3 of 9 checks pass          Fix next>|
| It runs to 2 pages. Fix that first. |
|--------------------------------------|
| Add your CGPA scale: 3 more drives   |   unlock row; count is real
| you can check                      > |
|--------------------------------------|
| [Home] [Discover] [Drives] [Tracker] [You]
+--------------------------------------+
```
Fixes from the home-a capture:
- "6 new roles this week" and "Posted 2h ago" are no longer chips on the card. They become one freshness line.
- The tab bar no longer covers the card: the deck height is `100dvh` minus bar and header.
- The "Sample" banner becomes a caption.
- The tab labels in this wireframe follow Draft B's shell (Discover tab). Decision 2 decides between this and Draft A's Picks tab.

**Wireframe 2.2 Home: laptop (1440).**
```
+--------------+----------------------------------------------------------------------------------+
| hirelane     |  Good morning, Rahul                                                       (R)  |
|              |  3 new roles you qualify for since yesterday                                     |
| > Home       |                                                                                  |
|   Discover   |  +------------------------------------+   +-----------------------------------+  |
|   Drives     |  | Today's picks              1 of 3  |   | Reply from Zenoti           Open >|  |
|   Tracker  2 |  | =====----- ---------- ----------   |   | "Can you do a call Thursday?"     |  |
|   You        |  | +================================+ |   |-----------------------------------|  |
|              |  | | LIME ROLE CARD (as phone)      | |   | Drives from your college All drives| |
|              |  | |                                | |   | Process Associate    2 days left >|  |
|              |  | |                                | |   | Relationship Officer 5 days left >|  |
|              |  | +================================+ |   |-----------------------------------|  |
|              |  |    ( X )    ( + )    ( ✓ )          |   | Your resume                       |  |
|              |  |  Arrow keys: left pass, right      |   | 3 of 9 checks pass       Fix next>|  |
|              |  |  apply, Space to open details      |   |-----------------------------------|  |
|              |  +------------------------------------+   | This week                         |  |
|              |                                           | 4 applied, 1 reply      Tracker > |  |
|  Hirelane    |                                           | Found a job elsewhere? Paste it > |  |
|  never       |                                           +-----------------------------------+  |
|  charges you |                                                                                  |
+--------------+----------------------------------------------------------------------------------+
```
- Rail badge "2" counts unread replies plus items that need the student. Nothing else.
- The right column is one ruled panel, not separate floating cards.

### S-2. Picks and apply (`/picks`, the swipe deck)

- **Single job:** decide on each pick in one gesture.
- **Sections:**
  1. Story bars plus "{i} of {n}".
  2. **Role card** (direction A colour).
     - Header: company and one line about them.
     - Chips: "Posted {t}" and "{n} new roles this week" (in the freshness line on phone, per wireframe 2.1).
     - Role title.
     - Place, work mode and shifts as separate chips.
     - Pay block: "₹3.6 LPA total", then "about ₹{x} a month before tax", then the source of the pay.
     - Verdict line.
     - Must-haves, "{k} of {m}".
     - Network line, if any.
     - "Why you fit, the day, the rounds" → `/pick/[id]`.
  3. **Apply mode line** under the card: "Applies from {handle}@apply.{domain}" or, if auto-apply is off, "You'll finish on their site". Pre-pilot, the first form reads "Ready from {handle}@apply.{domain}".
  4. **Action row:** Skip (✕, coral), Save (+), Apply (✓, ink circle; primary). Below it: "Drag the card, use the buttons, or press the arrow keys."
- **Primary:** Apply (✓).
- **Interactions:**
  - **Left (Skip):** the card leaves. Toast: "Skipped. Undo". The pick moves to the "Not this time" list in Discover.
  - **Up or "+" (Save):** goes to Tracker, Saved.
  - **Right (Apply):** first a pre-check on the server (see 4.3).
    - Unanswered needs-you fields: a bottom sheet opens with only those questions, with answers suggested from the answer bank and their evidence shown. Primary: **Apply**. An answer with no evidence is marked "Needs your words" and blocks auto-submit for this role only. It does not block the swipe; the swipe falls through to the fallback (wireframe 2.3(e)).
    - Once answers are complete: an APPLIED stamp-in, then a 4-second toast "Applying to {role}. Undo".
    - After the undo window: the job is queued and the card shows "Sending…" until the next card replaces it.
    - The tracker row moves from `queued` to `submitting` and then to `applied` (receipt) or `finish_on_site` (fallback; see flow 4.3).
  - **Keyboard:** ← Skip, → Apply, ↑ Save, Space opens details. No single-letter shortcuts.
- **States:**
  - Empty deck: "That's today's picks. {n} roles you qualify for this week." Links: Discover and Paste a job.
  - **Daily cap reached:** the right swipe still saves an "applied by you" intent and shows "You've reached today's {cap} applications. This one is saved and goes tomorrow, or finish it on their site now." Secondary: "Finish on their site". (Decision 5 sets the cap and the queueing rule.)
  - **Platform paused** (kill switch on): the apply mode line reads "{Platform} applications are paused. You'll finish on their site." The swipe still works and goes straight to the fallback.
  - **Auto-apply off:** the same fallback for every right swipe.
  - **Feature flag off** (today: fixtures only, no live submissions until the supervised pilot): every right swipe goes to the fallback. Fixture-mode copy is not shown to real users.
  - Error queuing: toast "Couldn't apply. Try again", and the card returns.
- **Phone vs laptop:**
  - Phone: the card is full width and the action row is fixed above the tab bar.
  - Laptop: the card is centred at 520 px with a right-hand panel showing the job-detail summary of the top card, so no extra click is needed.

**Wireframe 2.3 Picks: right swipe = applied, with its states (phone).**

(a) Dragging right
```
| +==================================+ |
| |  card tilts 6deg, follows finger | |
| |   +------------+                 | |
| |   |  APPLY     |  <- lane stamp fades in with distance (≥ 35% width = commit)
| |   +------------+                 | |
```

(b) Released: applied, with undo (4 s, then the submission is queued)
```
| +==================================+ |
| |  next card (sun)                 | |
| +==================================+ |
|                                      |
| +----------------------------------+ |   ink toast bar, bottom, above tab bar
| | Applied: Customer Support        | |
| | Associate, Zenoti                | |
| | Sending from rahul.k3x@apply...  | |
| | ====------  4s          ( Undo ) | |   countdown bar; Undo is the toast's only action
| +----------------------------------+ |
```
- Pre-pilot, the stamp reads READY and the toast says "Ready to submit on their site" (see (f)).
- Undo returns the card to the top of the deck. Nothing is sent before the 4 s end (receipt-first rule).
- Keyboard: `Z` is not used (no single-letter globals). Undo has focus while the toast is visible, so Enter undoes.
- Screen readers: an `aria-live="polite"` region announces "Applied to Customer Support Associate at Zenoti. Undo available for 4 seconds."

(c) Needs you, before the swipe commits (an unanswered question with no evidence)
```
| +----------------------------------+ |   bottom sheet
| | One answer needed for Zenoti     | |
| | Can you work rotational shifts?  | |
| | ( Yes )  ( No )                  | |
| | Saved to your answers for next   | |
| | time.                            | |
| |               ( Apply )          | |   primary in the sheet
| +----------------------------------+ |
```
An answer without evidence blocks auto-submit for that role. It does not block the swipe; the swipe falls through to (e).

(d) Submitted (in the Tracker, and as a toast if the app is open)
```
| Submitted on careers.zenoti.com      |
| 10:42, from rahul.k3x@apply...       |
| Receipt: resume v2, answers saved  > |
```

(e) Blocked: finish on their site
```
| +----------------------------------+ |
| | Zenoti's site needs you          | |
| | It asked for a sign-in, so we    | |
| | stopped. Your answers are ready  | |
| | to copy.                         | |
| | ( Finish on their site )         | |   opens the employer page + copy stepper
| +----------------------------------+ |
```

(f) "I'll submit myself" (consent `auto_apply` off)
- Right swipe becomes "Get it ready": the stamp reads READY.
- The toast says "Ready to submit on their site" with "Open their form".
- The onboarding choice adds one step to the approved flow. Both choices are non-destructive and the choice can be changed later.
```
| When you swipe right                 |
| ( ) Hirelane submits for me, from    |
|     my Hirelane apply address        |
| ( ) I'll submit myself               |
|                      ( Continue )    |
```

(g) Daily cap reached
```
| You've applied to {cap} today, your  |
| daily limit. Swipe right to save;    |
| saved roles go out tomorrow at 9:00. |
```
`{cap}` comes from configuration and is never hard-coded in copy. Decision 5 covers the cap and the 9:00 placeholder.

(h) Deck empty (honest zero)
```
| That's today's 3.                    |
| New roles you qualify for show up    |
| here each morning. 0 so far today.   |
| Browse Discover >                    |
```
On days with no picks: "No new roles you qualify for since yesterday." There is no filler and nothing looser is padded in.

**Wireframe 2.4 Picks: laptop (card and check side by side).**
```
+--------------+----------------------------------------------------------------------------------+
| rail         |  Today's picks                                                            1 of 3 |
|              |  +================================+   Your check for this role                   |
|              |  | LIME ROLE CARD                 |   ---------------------------------------     |
|              |  |                                |   ✓ 55% in 10th: you have 71%                |
|              |  |                                |   ✓ 55% in 12th: you have 58%                |
|              |  |                                |   ✓ Graduation 55%: 8.1 CGPA = 73.5% by      |
|              |  |                                |     your university's rule (source, 12 Oct)  |
|              |  +================================+   ✓ No active backlogs                        |
|              |     ( X )     ( + )     ( ✓ )         ---------------------------------------     |
|              |                                       Answers ready: 6 of 7                      |
|              |                                       Needs you: rotational shifts  Answer >     |
|              |                                       ---------------------------------------     |
|              |                                       Aman K. works here               Ask >      |
+--------------+----------------------------------------------------------------------------------+
```
The undo toast sits bottom-centre of the content area.

### S-3. Job detail (`/pick/[id]` signed in; the public twin is `/job/[slug]`)

- **Single job:** everything needed to decide on one role, with the maths.
- **Sections:**
  1. **Header:**
     - role, company link, place and work-mode chips
     - pay with its source; if no pay is stated, say "Pay not stated"
     - deadline, if known
  2. **Can you apply?** Every eligibility criterion as a row with ✓ (lane), ~ unknown (sun), ✕ (muted). Each row has the posting's own words and the maths line. Unknown rows say which input is missing, with a link to fix it in the eligibility profile, and tell the student what the fix unlocks ("Add your CGPA scale: {n} more drives you can check").
  3. **Fit.** Must-haves and nice-to-haves, each with ✓ ~ ✕, plus evidence from the resume.
  4. **The job.** The day, rounds and location, from the posting text.
  5. **How you'll apply.**
     - Auto: "Hirelane fills their {ATS} form and sends it from {address}." (Pre-pilot: "Hirelane fills their {ATS} form and gets it ready from {address}.")
     - Fallback: "Their site needs you to finish. Your answers will be ready."
     - The questions they ask, with your prepared answers (editable).
  6. **People you know there**, if the student uploaded connections.
  7. **Source line and report link.** "Report this role" covers scam, wrong rules or closed.
- **Primary:** Apply (the same action as a right swipe, with the same sheet and undo).
- **Secondary:** Save, Not this time.
- **Data:** the job row, eligibility verdicts, the FormSpec for the ATS (Greenhouse, Lever, Ashby readers), the answer bank, and the network table (the user's own rows only).
- **States:**
  - Role closed: banner "This role closed on {date}"; the Apply button is removed.
  - Already applied: Apply is replaced by the receipt row and "View in tracker".
  - Ineligible (✕ on a hard rule), reached by search: the verdict is shown first, and Apply is replaced by "Not eligible: {reason}". No dark pattern.
  - Not found: 404 with "Back to picks".
- **Phone vs laptop:**
  - Phone: sections stack and the Apply bar is sticky at the bottom.
  - Laptop: two columns; sections 2 and 5 sit in a right column that stays sticky.

**Wireframe 2.7 Job detail: phone.**
```
+--------------------------------------+
| <  Back                       Save   |
| +==================================+ |
| | LIME HEADER BAND                 | |   colour only here
| | [Z] Zenoti                       | |
| | Customer Support Associate       | |
| | Hyderabad, on-site               | |
| | ₹3.6 LPA, about ₹30,000 a month  | |
| +==================================+ |
| Posted 2h ago on careers.zenoti.com  |
|--------------------------------------|
| Your check                           |
| ✓ 55% in 10th: you have 71%          |
| ✓ 55% in 12th: you have 58%          |
| ~ Graduation 60%: we couldn't check. |
|   Pick your university's CGPA rule > |   unknown never blocks
| ✓ No active backlogs                 |
|--------------------------------------|
| Must-haves: 4 of 5                   |
| ✓ English ✓ Shifts ✓ ... ✕ Tally     |   ✕ muted, not red
|--------------------------------------|
| The day and the rounds               |
| Online assessment, 8 Nov, 10:00      |
| HR interview, 12 Nov                 |
| Carry: resume, college ID            |
|--------------------------------------|
| People you know                      |
| Aman K., Senior Support Engineer  >  |
|--------------------------------------|
| About the role (full posting)      v |
|======================================|
| ( Apply with Hirelane )   Not now    |   sticky bar; primary = same as right swipe
+--------------------------------------+
```
States of the sticky bar:
- **fail rule:** the primary is replaced by "You don't meet: 60% in 12th" and a "Save" button. Fail-rule roles never appear in picks; this state is reachable only from Discover or Paste.
- **scam-flagged paste:** the bar reads "Apply at source", with the flag shown above.
- **submitted:** the bar shows the receipt line.

**Wireframe 2.8 Job detail: laptop.**
```
+--------------+--------------------------------------------------------+-------------------------+
| rail         | LIME HEADER BAND (cols 1-8)                            | Your check  (sticky)    |
|              | Zenoti                                                  | ✓ 10th  ✓ 12th          |
|              | Customer Support Associate                              | ~ Graduation: pick rule |
|              | Hyderabad, on-site, ₹3.6 LPA                            | ✓ Backlogs              |
|              |---------------------------------------------------------| Must-haves 4 of 5       |
|              | The day and the rounds                                  |-------------------------|
|              | About the role                                          | ( Apply with Hirelane ) |
|              | About Zenoti, other roles you qualify for               | Not now                 |
+--------------+--------------------------------------------------------+-------------------------+
```

### S-4. Company (`/co/[id]`)

- **Single job:** decide whether this employer is worth your applications.
- **Sections:**
  1. **Name** (a monogram, never a fetched or invented logo) and what they do (from their careers page), with the source line.
  2. **Roles you qualify for** (rows with verdict lines).
  3. **Other open roles.** Collapsed, each with its blocking reason.
  4. **People you know there** (private to the student).
  5. **Your history with them.** Applications, replies and dates.
- **Primary:** none. If there is exactly one eligible role, Apply on it.
- **States:**
  - No eligible roles: "None of their open roles match your marks right now." The other-roles list shows why.
  - No roles: "No open roles right now. We check their careers page daily."

### S-5. Discover and search (`/discover`, **new**)

- **Single job:** find roles beyond today's picks, with filters.
- **Tab status:** Discover is a tab in Draft B's shell and a search entry in Draft A's. Decision 2 settles this; the sections below work either way.
- **Sections:**
  1. Search field.
  2. **Filter row** (sheet on phone):
     - "Only roles I qualify for" (default on)
     - city
     - remote-for-India (S7)
     - role family
     - minimum pay
     - posted within
     - source (career pages, your college)
  3. Result rows: role, company, chips, verdict line, source line.
  4. "Not this time" list: skipped picks, restorable.
- **Primary:** Search (the form GET submit).
- **Interactions:** all filters are query params on a server-rendered GET, so there is no client state and links can be shared. "Load more" is a link to the next page.
- **States:**
  - No results with "only qualify" on: "No roles you qualify for match this. Show roles you don't qualify for too?" as a link.
  - Before a resume is confirmed, "only qualify" is disabled with the reason.
  - Error: "Search is down. Try again."
- **Phone vs laptop:**
  - Phone: filters open in a full-height sheet using `<details>`.
  - Laptop: a filter column on the left and results on the right, with the selected row's detail in a third pane at 1280 px and up.

### S-6. Drives (`/drives`, drive detail at `/drives/[id]`, **new**)

- **Single job:** show the drives your placement cell published that you can apply to, before they close.
- **List sections:**
  - Open drives, sorted by deadline. Each row: role, company, deadline chip, verdict line.
  - "We couldn't check" drives, each with the missing input and a fix link.
  - Closed drives, collapsed.
- **Detail sections:**
  1. Header with the source line "From your placement cell, published {date}".
  2. Rules with the maths.
  3. Selection rounds with dates and places.
  4. Documents to carry.
  5. How you'll apply. Auto only if the apply link is a supported ATS; otherwise "Apply on their form; your answers are ready" with a copy-next stepper.
  6. After applying: "I got an interview" or "I got an offer" (S-13 outcome).
- **Primary:** Apply.
- **Rules:**
  - Never show scam flags on placement-cell drives (audit).
  - Never show a drive whose verdict is fail.
  - Unknown-verdict drives are shown with their reason (E4).
- **States:**
  - Not joined a campus: "Join your college to see its drives." Primary: Join.
  - Joined, none open: "No open drives you qualify for. Your placement cell's next drive will appear here."
  - Round reminder: on the day before a round, a needs-you item on Home.
- **Phone vs laptop:** list on phone; list plus detail pane on laptop.

### S-7. Tracker and Inbox (`/tracker`, with `/tracker/inbox`, **new**)

- **Single job:** know where each application stands and act on every employer message.
- **Tracker sections:**
  - Segmented control: Applications and Inbox ({unread}).
  - **Applications**, grouped by state:
    - Needs you: finish on their site, an interview ask, or an unanswered reply
    - Sending
    - Applied (receipt)
    - Replied
    - Interview
    - Offer
    - Closed: not selected, or withdrawn
    - Saved
  - Each row: role, company, state, last event time.
  - A row shows "Quiet 6 days" with a follow-up draft when an application has had no reply.
- **Application detail** (`/tracker/[id]`):
  - timeline: queued, submitting, applied (with result code) or fallback, then each message
  - the receipt: answers summary, answers hash, resume version, apply address, time, result
  - messages
  - outcome buttons: "I got an interview" and "I got an offer" (upload letter; who sees it, per share level)
- **Inbox sections:**
  1. **Codes**, pinned top: `security_code` messages showing the code large with a copy button, the employer and the received time. They are hidden after 15 minutes behind "Show expired codes".
  2. **Unread replies:** `reply`, `interview_ask`, `offer`.
  3. **All messages.**

  Each message shows:
  - the sender and whether the sending domain matches the employer (SPF and DKIM pass)
  - a classification chip (ack, reply, interview ask, not selected, offer, code, other)
  - **scam flags** if any (fee request, Telegram- or WhatsApp-only contact, free-mail sender)
  - the linked application
- **Primary:**
  - Tracker: the top needs-you item's action, for example **Finish on their site** or **Reply**.
  - Inbox: the message's own primary action, Copy code or Reply.
- **Reply (decision 3):** for now, "Reply" opens a prepared draft and a `mailto:` to the employer from the student's own mail app, with the note "They'll see your personal email." A reply sent from the apply address needs our sending domain warmed, and it collides with PRD M1.
- **Data:**
  - applications state machine (migration 0012)
  - `inbound_messages`: `classification`, `matched_by`, `spf_pass`, `dkim_pass`, `forwarded_at`
  - receipts table
- **Interactions:** mark as read; "This isn't about my application" re-links or unlinks a message; report as scam.
- **States:**
  - Empty tracker: "Nothing yet. Swipe right on a pick to apply." Link to Picks.
  - Empty inbox: "Replies to {address} land here."
  - Message with `matched_by = none`: shown under "Not matched to an application", with a link-to-application control.
  - Forwarding: in-app is immediate. Email forwarding shows "Email copies start once enabled" until the domain is warmed.
- **Phone vs laptop:**
  - Phone: list, then detail on its own page.
  - Laptop: three panes (states, list, detail), like a mail client.

**Wireframe 2.5 Tracker and inbox: phone.**
```
+--------------------------------------+
| Tracker                              |
| [ Applications | Inbox 1 ]           |   segmented control
|--------------------------------------|
| Needs you (1)                        |
| Zenoti, Support Associate          > |
| Finish on their site                 |
|--------------------------------------|
| Replies (1)                          |
| Payoneer, Ops Analyst              > |
| "Share your availability" 9:12       |
|--------------------------------------|
| Submitted (3)                        |
| Freshworks, Customer Success       > |
| Submitted 28 Oct, quiet 6 days       |
| Draft a follow-up >                  |   hook: follow-up draft, student sends it
| ...                                  |
|--------------------------------------|
| Interviews (0)                       |
| Offers (0)                           |
| Not this time (2)                  > |
+--------------------------------------+
```
Inbox tab:
```
| Inbox                                |
| Your apply address                   |
| rahul.k3x@apply.<domain>      Copy   |
| Every reply is forwarded here first. |
|--------------------------------------|
| Payoneer  9:12                     > |
| "Share your availability for..."     |
|--------------------------------------|
| recruit.hr2026@gmail.com  Yesterday >|
| ! Looks like a scam: asks for a      |   stop chip; C6 flags on replies only
|   ₹1,500 fee                         |
+--------------------------------------+
```
- Message detail: the forwarded email, the linked application, "I got an interview" / "I got an offer" as secondary actions, and a reply drafted for the student to send from their own email or WhatsApp (M1). Hirelane does not send warm intros.

**Wireframe 2.6 Tracker: laptop (three panes).**
```
+--------------+---------------------------+---------------------------------+-----------------------+
| rail         | [Applications | Inbox 1]  | Payoneer, Ops Analyst           | Application           |
|              | Needs you                 | From talent@payoneer.com  9:12  | Submitted 24 Oct 10:42|
|              |  Zenoti            >      | To rahul.k3x@apply.<domain>     | careers.payoneer.com  |
|              | Replies                   |                                 | Resume v2             |
|              | >Payoneer          >      | Hi Rahul, share your            | Answers hash a91f...  |
|              | Submitted                 | availability for a 20 min call  | Result 200            |
|              |  Freshworks        >      | this week...                    |-----------------------|
|              |  ...                      |                                 | I got an interview    |
|              |                           | ( Draft a reply )               | I got an offer        |
+--------------+---------------------------+---------------------------------+-----------------------+
```
The receipt fields are the ones decision 1 requires: answers hash, resume version, time, result code. The "20 min call" in this sample message is a sample employer's words, not Hirelane copy; it does not appear in product copy (see 0.2).

### S-8. Paste a job (`/paste`, exists; reached from Home, Discover and the share target)

- **Single job:** check a job found elsewhere, add it to the tracker, and apply at source.
- **Sections:**
  - Paste box (pre-filled from the Android share target, S5a)
  - verdict
  - fit
  - scam flags
  - "Add to tracker"
- **Rules:** we never fetch the link. Paste-a-job is always "apply at source"; it never auto-submits.
- **Primary:** Add to tracker.
- **States:** empty, unparseable, or scam flags found (shown, not blocking).

### S-9. Resume (`/resume`; children `/resume/upload`, `/resume/[id]/reading`, `/resume/[id]/health`, `/resume/[id]/confirm`, `/resume/builder`, `/resume/linkedin`, all **new** except `/resume`)

- **Single job:** have one resume that hiring systems can read and that is ready to send.
- **Manager sections:**
  1. Up to 3 resumes as rows: name, "{k} of 9 checks pass", "used for {n} applications", and which one is the default.
  2. Add a resume, with the three choices from S-0 step 6.
  3. Download (audited) and delete per row, with a confirm sheet.
- **Upload:** file input (PDF or DOCX, at most 5 MB). Primary: **Upload**.
- **Reading:** status page polled by meta-refresh. "Reading your resume…", then it moves to Health.
- **Health:**
  - Image-only PDF first, if detected: "A hiring system can't read this file", with two fixes (re-export as text, or the builder).
  - Then "{k} of 9 checks pass", failing checks first, each with its reason and fix.
  - Primary: **Confirm your details**.
- **Confirm:**
  - every parsed field, editable
  - low-confidence fields highlighted, each fixed in one tap
  - nothing is used until confirmed

  Primary: **Confirm**.
- **Builder:** one question per page, 6 to 8 steps, then a preview of the one-page PDF and its own health result.
- **LinkedIn ZIP:** upload the file, then the same confirm screen pre-filled. Connections are stored privately for Network.
- **States:**
  - wrong type or too large: inline error
  - zip bomb or malicious file: "We couldn't open this file", with no detail
  - worker timeout: "This is taking longer than usual. We'll notify you."
  - 3 resumes already: "Delete one to add another"
- **Phone vs laptop:**
  - Confirm is one field group per section on phone.
  - Laptop shows the PDF text preview on the left and the fields on the right.

### S-10. Eligibility profile (`/you/eligibility`, **new**)

- **Single job:** keep the marks that decide eligibility correct and confirmed.
- **Sections:**
  1. 10th: % and board.
  2. 12th or diploma: %.
  3. **Graduation:**
     - % or CGPA, plus the scale (4, 5 or 10)
     - SGPA or CGPA
     - **university rule picker**, which shows the formula, its source URL and the date checked
     - a campus rule overrides it, and says so
  4. Backlogs: active, and history.
  5. Gap years.
  6. Passout year, degree, branch.
  7. **"What each fix unlocks".** Real counts only.
- **Primary:** Save.
- **Validation (E5):**
  - CGPA must be within its scale
  - "412/500" converts to 82.4%
  - CGPA and % must be consistent when both are given
  - impossible values are flagged inline
  - no known rule: "unknown: rule for {university} missing", never a guess
- **States:**
  - Not confirmed: banner "Confirm your marks to see picks".
  - After saving: "Updated. {n} verdicts changed", linking to the changes.

### S-11. Network (`/network`, exists)

- **Single job:** find people who can refer you, and ask them yourself.
- **Sections:**
  - companies hiring where you know someone
  - per company: the connections
  - "Draft a referral ask": the student copies it and sends it via WhatsApp, email or LinkedIn. We never send it (M1).
- **Primary:** Draft a referral ask.
- **States:**
  - No ZIP uploaded: an explainer plus "Upload your LinkedIn data", with steps for getting the file.
  - No overlaps: "None of your connections work at companies hiring for your roles right now."
- **Privacy line:** "Only you can see your connections."

### S-12. You and Settings (`/you` hub; `/settings`, **new**)

- **"You" hub** (the tab root): your name and apply address (copyable), then links to Resume, Eligibility profile, Network, Settings. Label is "You", not "Me", to match DESIGN.md.
- **Settings sections, in order:**
  1. **Applying:**
     - Swipe to apply on or off ("I'll submit myself"), with the consent date
     - your apply address
     - the daily cap (read-only)
     - the answer bank (edit saved answers, each with its evidence)
  2. **College:**
     - campus and cohort, plus change or leave
     - share level, three radio rows, each saying what staff see
     - **staff view log**: who viewed what and when (C2)
  3. **Notifications:** in-app on. Email copies of employer messages and the weekly digest show "coming soon" until the domain is warm. Unsubscribe state.
  4. **Privacy:** the `llm_resume` consent toggle; download my data.
  5. **Sign-in methods:** email, Google, LinkedIn.
  6. **Account and delete:** this is where delete now lives. It needs the typed word "delete", then a confirm, and warns that it deletes within 24 hours and the apply address stops forwarding.
  7. Sign out.
- **Primary:** none at page level. Each section saves itself with a form POST per section.
- **States:**
  - Leave campus: confirm sheet; the outcome sharing stops.
  - Delete: after it is confirmed, the student is signed out and sees a "Deleted. Gone within 24 hours." page.

**Wireframe 2.9 You > Settings > Account (where Delete now lives).**
```
| Account                              |
| Signed in as rahul@gmail.com         |
| When you swipe right: Submit for me  |
|                            Change >  |
| Share with your placement cell:      |
| Totals only                Change >  |
| Who viewed your data (log)        >  |
|--------------------------------------|
| Delete account                    >  |   opens its own page with confirm
+--------------------------------------+
```

### S-13. Outcome capture (`/tracker/[id]/outcome`, **new**)

- **Single job:** record an interview or an offer, and decide who sees it.
- **Sections:**
  - type (interview or offer)
  - employer and role (pre-filled)
  - package (offers only)
  - optional offer letter upload (sealed)
  - a "Who sees this" line computed from the share level
- **Primary:** Save.
- **States:**
  - Share level is aggregate: "Your placement cell will only count this in totals. Share outcomes to let them verify it for NAAC." Link to Settings.

### Wireframe 2.10 Hooks that bring students back daily (honest counts only)

| Hook | Trigger | Copy (real values) | Channel |
|---|---|---|---|
| Morning picks | fixed daily refresh time (decision 5) | "3 new roles you qualify for since yesterday"; zero: "No new roles you qualify for since yesterday." | in-app; web push if opted in |
| Reply arrived | inbound to the apply address | "Reply from Payoneer" plus the first line | in-app immediately; email forward once the domain is warm (M2) |
| Drive deadline | eligible or unknown drive, 2 days and the same day | "Process Associate closes today" | in-app, push |
| Round reminder | round date minus 1 day | "Online assessment tomorrow 10:00. Carry: resume, college ID" | in-app, push |
| Unlock | a profile gap hides checks | "Add your CGPA scale: 3 more drives you can check" | Home row |
| Follow-up | submitted with no reply for 6 days | "Quiet 6 days. Draft a follow-up?" | Tracker row |
| Weekly recap | Sunday | "4 applied, 1 reply, 0 interviews this week" + WhatsApp share | in-app; email when warm |
| Share in | PWA share target (S5a) | Share → Hirelane opens Paste a job | OS share sheet |

Never used: streaks, flame or emoji counters, "N others applied", fake scarcity, badges for things that need no action, notifications without an opt-in, and notifications in quiet hours (21:00–08:00 by default).

### 3.x Student app shell (Draft B 2.0, Draft A 5.1)

- Light paper background, ink text, hairline rows.
- Saturated colour appears **only on the role card** in the deck and on the job detail header band.
- Phone: bottom bar, 64 px, labelled SVG icons, active item in ink with a 2 px lane bar above.
- Laptop: left rail, 240 px wide, full height (audit layout item). Rail footer has "Paste a job".
- Server-rendered pages, at most 100 KB JS each (P2). The deck is the only client island.

---

## Part 4. Admin console (`/campus/*`)

### 4.0 Rules for every console page

- **Register:** dark analytics (approved).
  - one hero number per page at most
  - lime series
  - labelled bases
  - no cards inside cards
- **Shell:**
  - Laptop: a fixed, **full-height** sidebar (today it ends at about 900 px; fix that). The campus name and a **cohort switcher** sit at the top of the sidebar, and the sidebar ends with "Powered by Hirelane". Sidebar is 240 px, `--console-panel`.
  - Phone: a top bar with the campus name, the cohort switcher and a menu button that opens a full-height sheet. Do not stack the sidebar above content as the 390 capture does today.
  - Header row on every page: cohort switcher (page title as a menu button), date range, then at most one primary and one secondary action.
  - Base line under the title states the population, for example "Base: 268 students not placed on campus who joined" (audit item 7).
- **Privacy:**
  - Every aggregate cell needs k ≥ 10; below that it shows "under 10". No hidden row can be worked out from the totals.
  - Every per-student view writes to the access log the student can read.
  - Staff never see marks, resumes or answers.
  - Names appear only in Outcomes for students at the *outcomes* or *full* share level.
- **Sample banner:** "Sample cohort" shows only in demo mode.

### A-1. Console sign in (`/campus/signin`, **new**)

- **Single job:** let invited staff in.
- **Layout:** same structure as the student sign-in, in the dark register. Heading: "Placement cell sign in". Work email gets a 6-digit code; Google is offered too. Staff accounts are invite-only.
- **Primary:** Send me a code.
- **States:**
  - Not invited: "This email isn't on a placement team. Ask your placement head to invite you." Contact link.
  - Wrong code: as in the student flow.
  - Student account tries to sign in: "This is the placement cell console. Student sign in →".

### A-2. Overview (`/campus`; approved, keep)

- **Single job:** see the cohort's off-campus outcome and where students stop.
- **Sections (as approved):**
  1. Header: cohort name, "Updated {time}", actions. **Add a drive** is the one primary; NAAC 5.2.1 list is secondary.
  2. Hero number: off-campus offers, "{v} verified by you", base line "from {n} students who joined".
  3. Breakdown list with shares, each labelled with its base.
  4. Area chart, applications per **week**, with hover (Draft A said per day; see Appendix A). Each point is a count; a week under 10 shows "under 10" in the tooltip and is drawn as a gap.
  5. Totals row: joined, resume ready, eligible, applied, interview, offer. Each has one action link (invite the rest, run a resume clinic, see blocking cutoffs, send a reminder, book a prep session, verify {n} offers).
  6. "Where students stop" stacked bar.
  7. Breakdown table with a segmented toggle (Programme, Blocker, Drive) and inline bars.
  8. Privacy footer line.
- **Fixes:**
  - k violation on the 4-applied row
  - one population base for the funnel, stated (audit)
  - the share base for each percentage named
  - full-height sidebar
  - the phone shell
- **Data:** SECURITY DEFINER aggregate functions with k ≥ 10.
- **States:**
  - New campus, nobody joined: the hero becomes "0 students joined" with **Invite students** as the primary (join code and college-email instructions), and the charts are hidden.
  - Cohort under 10 students: "This cohort has fewer than 10 students, so totals are hidden." Totals show "under 10".
  - Loading: the page is server-rendered; the chart's hover script loads after it.
  - Error: per-panel "Couldn't load", while the rest renders.

**Wireframe 3.1 Overview.**
```
+----------------------+--------------------------------------------------------------------------------------------------+
| Sample University,   |  B.Com and BBA, batch of 2026  v          [ 1 Aug - 29 Oct  v ]   ( Add a drive ) ( NAAC 5.2.1 list )|
| Indore               |  Updated 29 Oct, 9:00. Base: 268 students not placed on campus who joined.        secondary   primary |
| Placement cell       |                                                                                                  |
|                      |  31                                         Applications per week                                 |
| > Overview           |  off-campus offers, 22 verified by you      1,417 in this range. Hover a week for its count.     |
|   Students           |                                             40 |                                   ___/\         |
|   Drives             |  * B.Com (General)    56 applied      14    20 |   __/\__/\    /\__/\___/\/\__/     \        |
|   Outcomes and NAAC  |    45% of offers                             0 |__/          \__/                              |
|   Settings           |  * BBA                33 applied  under 10      +---------------------------------------------   |
|                      |  * B.Com (CA) and smaller                       Aug                Sep                Oct         |
|                      |    programmes, combined 29 applied  under 10                                                      |
|                      |    (shares hidden where the count is)                                                             |
|                      |                                                                                                  |
|                      |  Totals                                                                                          |
|                      |  Joined Hirelane  Resume ready  Eligible for a role  Applied   Interview   Offer                   |
|                      |  268              201           174                  118       46          31                     |
|                      |  Invite the other 48  Run a resume clinic  See blocking cutoffs  Send a reminder  Book a prep  Verify 9|
|                      |                                                                                                  |
|                      |  Where students stop                                                                             |
|                      |  [#########|####|########|###########|##]                                                        |
|                      |  * before resume ready 67, 28%  * before eligible 27, 11%  * before applied 56, 24%              |
|                      |  * before interview 72, 30%  * before offer 15, 6%                                               |
|                      |                                                                                                  |
|                      |  Breakdown                                        [ Programme | Blocker | Drive ]                 |
|                      |  #  Programme                      Applied   Share   Detail                                     |
|                      |  1  B.Com (General)  ===========   56        47%     14 offers                                  |
|                      |  2  BBA              =======       33        28%     under 10 offers                            |
|                      |  3  B.Com (CA) and smaller,        29        25%     under 10 offers                            |
|                      |     combined         ======                                                                      |
|                      |                                                                                                  |
|                      |  (shield) You see totals only. Groups under 10 are hidden or combined, and each student          |
|  Powered by hirelane |  chooses whether to share outcomes.                                                              |
+----------------------+--------------------------------------------------------------------------------------------------+
```
Changes from the approved capture:
- the leaks in 0.5 are fixed (the "4 applied" row is merged; no share is shown beside a hidden count)
- the chart becomes weekly (see 3.8)
- one primary button

Note: the Draft B wireframe still shows "BBA ... under 10 offers" beside a share, and "B.Com (General) 47%" beside "45% of offers" in the list. Those two shares are the labelling problem in 0.3; the 3.8 rule hides the share whenever the count is hidden, and the two bases must be labelled.

### A-3. Students (`/campus/students`)

- **Single job:** understand the cohort's readiness in aggregate. **This is not a student list** (PRD non-goals; open decision in CAMPUS-FIRST).
- **Sections:**
  1. Joined against the roster: "{n} of {m} on your roster joined". Roster matching uses email hashes.
  2. **Resume health aggregate.** Share passing each of the 9 checks, and the image-only PDF share. Action: "Run a resume clinic" (copy for a WhatsApp announcement).
  3. **Eligibility blockers.** For each common cutoff (for example 60% in 12th, active backlogs), how many are blocked. Each is a k-gated count. "Drives that don't use this cutoff" helps the TPO source differently.
  4. **Skill gaps.** The top missing must-haves across eligible roles.
  5. **Invite.** The join code, college email domains, and a shareable message.
- **Primary:** Copy invite message.
- **States:**
  - No roster imported: the joined line reads "{n} joined" with a link to import a roster.
  - Every cell is under 10: "Too few students to show totals yet."

**Wireframe 3.2 Students.**
```
|  Students by programme  v   [ Batch 2026 v ]                                   ( Import your student list ) |
|  Totals only. You never see a student's marks or resume here. Base: final years not placed on campus.       |
|                                                                                                             |
|  [ Funnel | Resume health | Blockers | Skill gaps ]          Filter: [ Programme v ] [ Joined: all v ]       |
|                                                                                                             |
|  Programme                Final years  Joined      Resume ready  Eligible  Applied  Interviews  Offers      |
|  B.Com (General)          186          121  65%    92 ======     80        56       21          14          |
|  BBA                      112           79  71%    58 =====      50        33       12          under 10    |
|  B.Com (CA)                74           52  70%    41 ====       36        25       11          under 10    |
|  BBA (Logistics) and      40           hidden: groups under 10 are combined so neither can be worked out    |
|  B.Com (Honours), combined                                                                                  |
|  ---------------------------------------------------------------------------------------------------------  |
|  Placed students from on-campus drives drop out once you import your list.                                  |
```
- **Resume health** view: "41% have image-only PDFs" style rows, each with an action ("Run a resume clinic").
- **Blockers** view: "212 students blocked by 60% cutoffs", with the cutoff and "drives with no 12th cutoff" suggestions.
- **Import (C7):** upload CSV, map columns (college email, placed yes/no), preview counts, confirm. Each step has one primary.

### A-4. Drives list (`/campus/drives`)

- **Single job:** see every drive and how it is doing.
- **Sections:**
  - **Add a drive** (primary).
  - Tabs: Live, Scheduled, Drafts, Closed.
  - Table: role, company, published, deadline, reached (eligible plus unknown), applied, interviews, with each count k-gated.
- **Row action:** open the drive (the edit form plus a results panel).
- **States:**
  - No drives: "Paste the next drive notice you get on WhatsApp or email." Primary: Add a drive.
  - Publish failed: a row badge "Not published" plus a retry.

**Wireframe 3.3 Drives list.**
```
|  Drives   [ Batch 2026 v ]  [ Status: all v ]  [ Programme: all v ]                          ( Add a drive )  |
|                                                                                                             |
|  Drive                                Status      Reaches   Applied   Closes        Notice check             |
|  Process Associate, Retail chain      Live        143+27    56        2 days left   No warning signs         |
|  Customer Success Associate, SaaS co  Scheduled   170       -         6 Nov         No warning signs         |
|  Relationship Officer, Private bank   Draft       -         -         -             Check: free-mail contact |
|  Data Entry, Logistics firm           Closed      88        41        Ended 20 Oct  No warning signs         |
```
- Reaches is "eligible + couldn't check", shown as two numbers.
- Status pills are text plus a dot, never colour alone.
- Empty state: "No drives yet. Paste the next notice you get and we fill in the form." with "Add a drive" as the primary.

### A-5. Add a drive (`/campus/drives/new`; exists as a capture)

- **Single job:** turn a pasted notice into a published drive that reaches only eligible (and unknown) students.
- **Sections (keep the capture's five steps):**
  1. Notice paste. Shows "Filled {n} fields; the ones marked check need your eye". Scam signs are shown here, to staff only.
  2. Job details.
     - CTC shows the total only. Fixed and variable stay empty and are marked "check" (audit). The CTC split is never invented.
     - Apply link hint: "Students apply here." If it is a supported ATS, add "Hirelane can apply for students who turned that on"; otherwise "Students finish on this form."
  3. Eligibility. Degrees, batch, the level table with "students who pass" (k-gated), and backlogs and gap with "not in the notice" flags.
  4. Selection rounds, last date and documents to carry.
  5. Review and publish.
- **Right rail:**
  - **Who this reaches:** "{p} qualify on every rule, {u} more see it marked 'we couldn't check one rule', so {p+u} get it." (Draft B shows the breakdown by programme under the count.)
  - **Can't be checked yet:** the count, plus "Set the CGPA rule".
  - **What students see:** a real preview of the student row, which never shows scam flags.
- **Primary:** **Publish to {p+u} students**. Secondary: Schedule. Tertiary text: Save as draft (Draft B replaces Save as draft with autosave; decide with the copy).
- **States:**
  - Parser found nothing: "We couldn't read rules from this. Fill the form yourself."
  - Reach under 10: the count shows "under 10" and publishing is still allowed.
  - Publish error: the form is kept and the error is shown in-line.
- **Phone vs laptop:** on phone the right rail moves under step 5 as a summary, and the step list becomes a top progress row.

**Wireframe 3.4 Add a drive (one primary).**
```
|  Add a drive                                                         Draft saved 10:42  (autosave text) |
|  Paste the notice; we fill the form for you to check.                                                    |
|                                                                                                          |
|  1 Notice        +----------------------------------------------+   +-----------------------------+      |
|  2 Job details   | 1. Notice                                    |   | Who this reaches            |      |
|  3 Eligibility   | [ pasted text ............................ ] |   | 143                         |      |
|  4 Rounds        | (shield) No warning signs: company domain,   |   | qualify on every rule       |      |
|  5 Publish       |   no fee, no Telegram-only contact           |   | + 27 we couldn't check      |      |
|                  |----------------------------------------------|   |   (CGPA scale): they see it |      |
|                  | 2. Job details                               |   |   with the reason           |      |
|                  | CTC total [ 3.6 LPA ]  Fixed/variable [    ] |   | B.Com 2026         88       |      |
|                  |   check: the notice doesn't give a split     |   | BBA 2026           41       |      |
|                  |----------------------------------------------|   | B.Com 2025         14       |      |
|                  | 3. Eligibility (rule table, students who pass)|  |-----------------------------|      |
|                  | 10th 55%   251   12th 55%   228   Grad 60%  |   | What students see           |      |
|                  |----------------------------------------------|   | (mini student row preview)  |      |
|                  | 4. Rounds, last date, documents              |   +-----------------------------+      |
|                  |----------------------------------------------|                                        |
|                  | 5. Publish                                   |                                        |
|                  | ( Publish to 170 students )  Schedule...  v  |   Schedule is a text button with menu  |
|                  +----------------------------------------------+                                        |
```
- The CTC split is never invented (audit).
- Unknown-verdict students are included in the publish count (E4).
- "Save as draft" is replaced by autosave in Draft B; the tertiary text action stays in Draft A's copy. Owner picks one at review.

### A-6. Outcomes and NAAC (`/campus/outcomes`)

- **Single job:** verify off-campus offers and download the NAAC 5.2.1 list.
- **Sections:**
  1. Header. Primary: **Download 5.2.1 list (CSV)**.
  2. Totals: outgoing, placed (on campus plus verified off campus), higher studies, the 5.2.1 share. Each has its basis written under it; any stat without a basis is removed (audit).
  3. **Offers to check:** table of student name, programme, employer, package, found through (Hirelane, on-campus drive), letter, status.
     - Only *outcomes*- or *full*-level students appear.
     - Statuses: Waiting for you, Verified, Not accepted, Asked student.
  4. Verified offers.
- **Export:** verified rows only, in the 5.2.1 list shape (name, programme, employer, package per annum). The download is logged.
- **States:**
  - Nothing shared yet: "No offers shared yet. Students choose to share outcomes in their settings."
  - Export with 0 verified rows: the button is disabled with "Verify at least one offer".

**Wireframe 3.5 Outcomes and NAAC.**
```
|  Outcomes and NAAC 5.2.1  [ Batch 2026 v ]  [ Academic year 2026-27 v ]          ( Download 5.2.1 list ) |
|  Only students who share at the outcomes level appear. Nothing counts until you verify it.               |
|                                                                                                          |
|  38%                                    412 outgoing  |  118 placed (on campus + verified off campus)    |
|  5.2.1 figure so far this year          38 higher studies  |  9 offers waiting for you                   |
|  (118 + 38) / 412                                                                                         |
|                                                                                                          |
|  Offers to check (9)                                              [ Waiting | Verified | Not accepted ]  |
|  Student          Programme        Employer        Package   Found through  Letter      Status           |
|  Sample Student 4 B.Com (General)  Mass recruiter  3.2 LPA   Hirelane       View letter Waiting for you  |
|  ...                                                                                                     |
```
- The formula is shown under the hero number, so every stat has its basis.
- Empty state: "No offers shared yet. Students see 'I got an offer' in their Tracker."
- The 38% figure is a sample. Public pages do not use it (0.3).

### A-7. Offer review (`/campus/outcomes/[id]`, **new**)

- **Single job:** decide whether one offer counts.
- **Sections:**
  - student name and programme
  - employer, role and package as the student entered them
  - the letter viewer, in a sealed blob; viewing is logged and the student can see it
  - the source of the offer
  - previous decisions
- **Primary:** **Verify**. Secondary: Not accepted (needs a reason) and Ask the student (sends an in-app message). No destructive reject: the secondary records a reason, and the student sees it.
- **States:**
  - No letter: "Verify without a letter?" with a confirm.
  - Letter failed to load: retry.
  - Student withdrew sharing: "This student stopped sharing outcomes." The record becomes read-only and drops from the export.
- **Phone vs laptop:** on phone, the letter is shown full-screen with the actions in a bottom bar.

**Wireframe 3.6 Offer review.**
```
|  < Offers to check                                                               3 of 9 waiting           |
|  +-----------------------------------+  +------------------------------------------------------------+   |
|  | Sample Student 4                  |  |  OFFER LETTER (sealed viewer, page 1 of 2)                 |   |
|  | B.Com (General), batch 2026       |  |                                                            |   |
|  | Employer   Mass recruiter         |  |                                                            |   |
|  | Package    3.2 LPA total          |  |                                                            |   |
|  | Found      Hirelane               |  |                                                            |   |
|  | Shared at  Outcomes level         |  |                                                            |   |
|  |-----------------------------------|  +------------------------------------------------------------+   |
|  | ( Verify offer )                  |  This view is logged. The student can see that you opened their letter. |
|  | Can't verify: add a reason        |                                                                   |
|  | Next >                            |                                                                   |
|  +-----------------------------------+                                                                   |
```
- No destructive "reject": the secondary records a reason, and the student sees it.
- Keyboard: J/K are not used. Next and previous are buttons, with arrow keys inside the list.

### A-8. Roster import (`/campus/settings/roster`, **new**)

- **Single job:** load the cohort from the ERP, so placed students drop out of picks and joined students can be counted.
- **Steps:**
  1. Upload a CSV from Superset, any ERP or Excel.
  2. **Map columns:** college email (required), placed on campus (yes/no; required), cohort (optional).
  3. **Preview counts:** rows, valid emails, placed, unplaced, duplicates, and rows with errors (downloadable).
  4. Import.
- **Copy:** "We keep a one-way hash of each email and the placed flag. Names and roll numbers are never stored, and the file is deleted after import."
- **Primary:** Import {n} rows.
- **States:**
  - Wrong file type.
  - Missing required column.
  - All rows invalid.
  - Import running (status page).
  - Done: "{n} imported, {p} marked placed".

### A-9. Cohorts (`/campus/cohorts`, **new**; also the header switcher)

- **Single job:** set up passout-year × programme groups and their join routes.
- **Sections:**
  - cohort list with joined counts (k-gated)
  - **Add a cohort**: passout year, programme
  - per cohort: its join code (rotate) and status (open, closed)
- **Primary:** Add a cohort.
- **States:** no cohorts: "Add your first batch to start inviting students."

### A-10. Settings (`/campus/settings`)

- **Single job:** campus-wide rules.
- **Sections:**
  1. Campus profile.
  2. College email domains, with verification.
  3. **CGPA rule.** Pick the university rule (formula, source URL, date checked) or set a campus override.
  4. Roster import (link to A-8).
  5. Staff (link to A-11).
  6. Data and retention.
  7. The access log export.
- **Primary:** none. Each section saves itself.

### A-11. Staff (`/campus/settings/staff`, **new**)

- **Single job:** control who on the placement team can do what.
- **Roles:**
  - **Head:** everything, including staff and export.
  - **Officer:** drives, offer review and export.
  - **Viewer:** overview and students aggregates only.
- **Sections:**
  - members (email, role, last active)
  - pending invites
  - **Invite** (email plus role)
  - the access log
- **Primary:** Invite.
- **States:**
  - Last Head cannot be removed.
  - Invite expired: resend.
- **Console sidebar bottom:** the signed-in staff email, then Sign out, then "Powered by Hirelane". A Viewer sees only Overview and Students.

### 4.x Console component inventory (Draft B 3.7)

| Component | What it shows | Variants | States |
|---|---|---|---|
| **HeroMetric** | one number at 96px, a sentence, its base and formula | count, percent (with formula) | loading skeleton (same height), suppressed ("under 10", no sentence), empty |
| **BreakdownList** | rows with a series dot, label, count note, value, share | by programme, by blocker | suppressed row merged into "combined"; share hidden whenever the count is |
| **AreaChart** | server-rendered SVG, lime line, 12% fill, gridlines at 3 ticks | per week (default), per month | hover crosshair and tooltip; a bucket under 10 drawn as a hatched gap with "under 10"; empty "No applications in this range" |
| **TotalsRow** | 6 label/number/action columns on one rule | funnel (Joined → Offer) | action link hidden when it doesn't apply; number "under 10" when suppressed |
| **StackedBar** | one 10px bar plus a legend with counts and shares | where students stop | segments under 10 merged into the next segment and labelled "combined" |
| **ToggleTable** | SegmentedControl, then a table with inline bars | Programme, Blocker, Drive | sorted column, row hover, combined row, empty |
| **InlineBar** | 2px lime bar under a label, width = share of the max | — | none at 0 |
| **FilterBar** | menus for programme, status, joined | — | an active filter shows a chip with clear; "Clear all" |
| **DateRange** | presets (30 days, 90 days, this semester, custom) | — | applies to time-series and period counts; cohort totals are labelled "whole batch" |
| **CohortSwitcher** | page title as a menu: campus, then batch × programme group | — | one cohort, many, none (setup prompt) |
| **StatusPill** | dot + text | Live, Scheduled, Draft, Closed, Waiting, Verified, Not accepted | — |
| **StepRail** | numbered sections with a scroll-spy (CSS `:target` fallback) | — | done, current, needs check |
| **ReachPanel** | hero count + "couldn't check" + per-cohort rows | — | recalculating (skeleton), zero |
| **LetterViewer** | sealed document, audited | PDF, image | loading, failed, log notice |
| **EmptyState** | one sentence of what goes here + one action | per page | — |
| **SampleCaption** | demo-only line under the page title | — | hidden in real use |
| **PrivacyNote** | shield icon + totals-only sentence | — | always on aggregate pages |

### 4.y Suppression rules (apply to every console component)

1. No count under 10 is shown anywhere: rows, legends, tooltips, CSV exports, totals deltas.
2. **A hidden count also hides its share** and any number derived from it (fixes "BBA under 10, 26% of offers").
3. **Complementary suppression:**
   - if one group is hidden, the next smallest is merged with it ("combined"), so no hidden value can be recovered by subtracting from a total
   - if the combined group is still under 10, the whole column shows totals only
4. **Time series use weekly buckets.** A week under 10 is drawn as a gap with "under 10". Whether event counts (applications, not students) fall under k is decision 4. Until it is answered, treat them as k-bound.
5. Per-student rows appear only in Outcomes, and only for students at the *outcomes* share level. Each view is logged to the student's view log (C2).

---

## Part 5. Core flows, end to end

### 5.1 First-time student

1. **Landing.** The student lands on `/` or `/students`, often from a WhatsApp link. On `/students` they can paste a drive notice and see a verdict without an account.
2. **Sign in.** "Get started" → `/signin` → email code, Google or LinkedIn. Inside the Instagram or WhatsApp in-app browser, the email code is the default (Google is blocked there).
3. **Account.** `/welcome`: 18+, terms, privacy → **Create my account**. Under 18 → "Come back at 18", with nothing stored, and the primary goes to `/jobs`.
4. **How applying works.** Turn on swipe to apply (consent `auto_apply`) or "I'll submit myself". The apply address is generated now and shown.
5. **Join your college.** By college email code or campus code, then pick the cohort and share level. This step can be skipped.
6. **Resume.** Upload, then Reading, then Health.
   - Image-only: two fixes. Re-upload or Builder.
   - Then Confirm, with every field editable.
7. **Eligibility profile.** Pick the university CGPA rule; see "{n} more drives you can check" if something is still unknown.
8. **Home.** The first picks are honest: "{n} roles you qualify for this week", or "None yet. We'll tell you when one opens", plus Paste a job.

### 5.2 Daily return

1. **Notification.** In-app only today, email once the domain is warmed. It is sent only for real events: a new eligible role, a reply, a code, or a round tomorrow.
2. **Home.**
   - The line "{n} new since yesterday".
   - The needs-you strip: codes first, then interview asks, then finish-on-site items.
   - Today's picks.
   - Drives closing soon.
3. **Act.** The student swipes through picks (5.3), handles the needs-you items, and checks the Tracker for "Quiet 6 days" follow-ups.
4. **Done.** The deck ends with "That's today's picks", with no infinite feed.

### 5.3 Right swipe to applied: apply address, receipt and fallback

1. **Swipe.** The student swipes right on `/picks`, or presses Apply on job or drive detail.
2. **Pre-check (server).** Each check either continues or goes to the fallback:
   - eligibility is not fail
   - the role is open
   - auto-apply consent is on (otherwise go to the fallback, step 7)
   - the platform's kill switch is off (otherwise fallback)
   - the student is under the daily cap (otherwise "goes tomorrow", or the fallback now; decision 5)
   - the source is supported (otherwise fallback):
     - a Greenhouse, Lever or Ashby job with a FormSpec reader: auto
     - a drive whose apply link is one of those: auto
     - a Google Form, another ATS, or paste-a-job: always the fallback
3. **Needs you.** Questions the FormSpec requires that the answer bank can't fill appear in a bottom sheet. An answer without evidence is marked "Needs your words". The student types it, or the role goes to the fallback. Nothing is invented.
4. **Stamp and undo.** The APPLIED stamp shows with a 4-second undo. Undo cancels before anything is queued.
5. **Submit (worker).**
   - The executor fills the form with the resume version, the answers, and the **apply address as the email field**.
   - It submits on the employer's own page.
   - It never gets past a CAPTCHA, bot check or login.
6. **Result.**
   - **Success:** the tracker shows Applied with the **receipt**: apply address used, resume version, time, result code and answers hash. The ATS acknowledgement usually arrives at the apply address and shows as `ack` in the Inbox.
   - **Blocked or failed:** go to step 7.
7. **Fallback: "Finish on their site".**
   - The tracker row goes into Needs you.
   - The page shows the employer link, the apply address to use, and a "copy next" stepper over every answer (phone) or a side-by-side checklist (laptop).
   - The student submits there, then taps "I've submitted". The application is recorded as applied by you, with the time.
8. **Today vs later.** Until the owner's supervised pilot, the executor runs only against recorded fixtures behind a flag. In production before the pilot, every right swipe takes path 7. Once the pilot flag is on, path 5 runs for supported sources only.

### 5.4 A reply arrives

1. **Receive.** An employer emails `{handle}@apply.{domain}` (or the `+token` alias). An inbound webhook stores it encrypted in `inbound_messages`.
2. **Match.**
   - `matched_by` is `token`, `domain` or `none`.
   - SPF and DKIM are checked.
   - The message is classified as `ack`, `reply`, `interview_ask`, `rejection`, `offer`, `security_code` or `unknown`.
   - Scam flags are added for fee requests, Telegram- or WhatsApp-only contact, and free-mail senders.
3. **Forward.** An in-app notification goes out immediately (`forwarded_at`). An email copy follows once the sending domain is warmed.
4. **Tracker state.**
   - `interview_ask`: Interview, and a needs-you item on Home.
   - `rejection`: Closed, not selected.
   - `offer`: Offer, plus a prompt for the S-13 outcome.
   - `security_code`: pinned in the Inbox with copy, and never left to wait.
5. **Student acts.** Reply via the prepared draft from their own email (current rule, decision 3), or mark the message as not about this application, or report it as a scam.
6. **Campus count.** If the student shares outcomes, the interview or offer shows up in the console aggregates. Names appear only in Outcomes once an offer is shared.

### 5.5 A drive published by the TPO

1. **Paste.** The TPO opens `/campus/drives/new` and pastes the notice. The parser fills the fields; scam signs, if any, show to staff only.
2. **Check.**
   - The TPO checks the fields marked "check" (CTC split, gap, backlogs ever) and the rounds and documents.
   - The right rail shows reach: pass plus unknown, k-gated.
   - "Can't be checked yet" points to the CGPA rule.
3. **Publish.** The TPO publishes to {p+u} students, or schedules it.
4. **Fan-out.** The worker computes each student's verdict. Pass students see the drive; unknown students see it with "We couldn't check: {missing}"; fail students never see it.
5. **Student side.** A Home line and a drive row with a deadline chip appear. The drive detail shows rules with the maths, rounds and documents. Apply follows 5.3: auto only for supported ATS links, otherwise finish on the form.
6. **Reminders.** A round reminder appears the day before, with documents to carry.
7. **Results.** The drives list shows reached, applied and interviews, all k-gated.

### 5.6 An offer verified for NAAC

1. **Student records it.** The student marks "I got an offer" from the Tracker (or it is prompted by an `offer`-classified message): employer, role, package, and an optional letter (sealed).
2. **Share level decides visibility.**
   - At *aggregate*, it counts only in totals. The screen says so, with a link to change the share level.
   - At *outcomes* or *full*, it appears in the console's Offers to check.
3. **Review.** The TPO opens offer review and views the letter. The view is logged and shown to the student under Settings, College, view log. The TPO then chooses:
   - **Verify**
   - **Not accepted**, with a reason
   - **Ask the student**, which sends an in-app message
4. **Count.** The verified offer moves to Verified, and the overview hero ("{v} verified by you") updates.
5. **Export.** The Outcomes page downloads the 5.2.1 CSV: verified rows only, with name, programme, employer and package. The export is logged.
6. **Withdrawal.** If the student later lowers their share level, the row leaves the next export, and earlier exports stay logged.

---

## Part 6. Navigation

### 6.1 Student tabs (decision 2)

**Mismatch for the owner to settle:**
- DESIGN.md says Home, Discover, Swipe, Tracker, You.
- The home-a capture shows Home, Jobs, Drives, Tracker, Me.
- Draft B's shell (2.0) shows Home, Discover, Drives, Tracker, You.

**Recommended set (Draft A): Home, Picks, Drives, Tracker, You.**
- **Picks (the swipe deck)** is the apply action, so it earns a tab.
- **Drives** is the campus reason to exist and is deadline-bound, so it gets a tab for campus students. Students with no campus see the tab as "Join your college" content until they join.
- **Discover** is reached from a search field at the top of Picks and Home. It is not a tab, so the bar stays at 5 tabs.
- **Inbox** lives inside **Tracker** as a segment. The Tracker tab badge counts unread replies plus pinned codes.
- **You** covers Resume, Eligibility profile, Network and Settings. The label is "You", not "Me", to match DESIGN.md.

Laptop uses the same five items in the left rail, plus "Paste a job" as a rail footer link.

**The alternative, if the owner prefers DESIGN.md (and the Draft B wireframes as drawn):** Home, Discover, Swipe, Tracker, You, with Drives as a section of Home and a Discover filter. The cost is that drives sit one tap deeper. The wireframes in Part 3 are drawn with Discover and Drives tabs; if the owner picks Picks, relabel the tab in wireframes 2.1, 2.2 and the phone tab bar.

### 6.2 Replies to employers (decision 3)

Today the reply comes from the student's own mail, so the employer sees a different address. Replying from the apply address needs a warmed sending domain and an amendment to PRD M1 ("never sent by Hirelane"). Until then, the Reply action is the prepared draft and `mailto:`, with "They'll see your personal email."

### 6.3 Admin sidebar

Order:
1. Overview
2. Students
3. Drives
4. Outcomes and NAAC
5. Settings

- **Header:** the campus name and the cohort switcher (with "Manage cohorts" → A-9).
- **Inside pages:**
  - Add a drive is inside Drives.
  - Offer review is inside Outcomes.
  - Settings holds the CGPA rule, Roster import, Staff, domains and the access log.
  - A Viewer sees only Overview and Students.
- **Bottom of the sidebar:** the signed-in staff email, then Sign out, then "Powered by Hirelane".

### 6.4 How the website links into both

- **Header:** "Sign in" → `/signin` (student). The footer column "Sign in" has both Student sign in and Placement cell sign in (`/campus/signin`).
- `/colleges` has "Placement cell sign in" next to the hero primary.
- **Signed-in students** who visit `/` see the header link change to "Open Hirelane" → `/home`. The page content stays the same, and nothing is personalised on public pages.
- **Signed-in staff** who visit `/colleges` see "Open console" → `/campus`.
- **Deep links:**
  - Drive and job share links (WhatsApp share from the app) open the public `/job/[slug]` for signed-out visitors, with "Sign in to check if you qualify".
  - Signed-in students go to `/pick/[id]` or `/drives/[id]`.
- **Inside the app:** the app footer (You, Settings) links back to `/security`, `/help`, Terms and Privacy. There is no marketing navigation in the app.

---

## Part 7. Shared component system

Target folders: `apps/web/components/{shadcn,landing,student,campus}`.
- `shadcn/` holds the shared primitives: shadcn-generated ones plus our tokenised additions used by more than one surface.
- `brand/`, `ui/`, `shell/`, `app/`, `job/`, `board/`, `account/` and `landing-v3/` are folded in or deleted, as listed in 7.5.

### 7.1 `components/shadcn/` (shared primitives)

| Component | Variants | States | Notes |
|---|---|---|---|
| Button | primary, secondary, text, danger-text; sizes 44/48 | hover, active, focus-visible, disabled + reason, loading | one primary per screen (lint by review) |
| Input, Textarea | default, with suffix (%, LPA), mono (codes) | focus, error + message, "check" (sun) hint, disabled | labels always visible |
| Select, Combobox | single, searchable (university CGPA rule picker) | open, empty result, loading | fold `ui/Select`, `ui/Combobox` in here |
| CheckboxField, Switch, RadioCard | — | checked, focus, error | RadioCard is used by the `auto_apply` choice |
| SegmentedControl / ToggleGroup | 2–4 options, light and console | selected, focus | fold `ui/SegmentedControl` |
| Dialog, Sheet | centre dialog (laptop), bottom sheet (phone) | open, closing | Sheet for "Needs you" |
| Toast (sonner) | info, undo (with countdown) | entering, counting, undone, done | fold `ui/UndoBar` into the undo variant; 4 s |
| Accordion | native `<details>` for marketing, Radix inside apps | open, closed | |
| Tooltip | console only | — | |
| Chip | pass (lane), check (sun), fail (stop), neutral | — | text + icon, never colour alone |
| Skeleton | line, block, metric | shimmer off under reduced motion | from `ui/Skeleton` |
| Wordmark, CompanyLogo | light, dark | logo missing → initial | move `app/wordmark.tsx` and `brand/CompanyLogo` here |
| Icon | the SVG set | — | `aria-hidden` or labelled |

### 7.2 `components/landing/` (public site)

| Component | Variants | States |
|---|---|---|
| SiteHeader | light; scrolled hairline | menu open (phone `<details>`) |
| SiteFooter | — | — |
| Hero | home, students, colleges | — |
| LiveCountLine | roles in India, career pages, roles with pay | hidden on failure; "Updated" time |
| ProofStrip | 4-up, 2×2 on phone | — |
| ProductImage | console 1440, phone 390, crop 3x; caption | lazy, priority |
| StepRow | 4 steps | — |
| FeatureRow | image right, image left | — |
| NeverList | ruled rows | — |
| DarkBand | uses console tokens | — |
| FAQ | `<details>` list | open |
| EligibilityCheck | the `/students` no-sign-in check | idle, checking, result (pass/fail/unknown), error |
| DemoForm (pilot / contact form) | — | idle, sending, sent, error |

`shell/SiteHeader`, `SiteFooter`, `MobileMenu` and the gates move here. `landing/Main`, `Front`, `Public`, `Students` and `Colleges` are rebuilt from these sections.

### 7.3 `components/student/` (app, direction A)

| Component | Variants | States |
|---|---|---|
| Shell | phone bottom tabs, laptop rail | active tab, badge (real count only) |
| Greeting | — | count > 0, zero copy |
| TopSlot | reply, round tomorrow, drive closing | none (hidden) |
| RoleCard | lime, sun, blue, pink (rotation); deck, header band | resting, dragging, stamp APPLY/READY/PASS, exiting, reduced-motion |
| SwipeDeck | auto-apply on, "I'll submit myself" | empty, capped, loading, offline (buttons still work) |
| ApplyToast | undo | counting, undone, sent |
| NeedsYouSheet | yes/no, short text, choice | unanswered, saved |
| RuleList (eligibility) | pass, fail, unknown; with "show the maths" | conversion source + date link |
| MustHaves | bar + chips | — |
| DriveRow | eligible, couldn't check | countdown sun, closed |
| ResumeRow | N of 9 | fix next |
| UnlockRow | — | hidden at 0 |
| TrackerList | grouped by state | empty per group |
| ApplicationRow | needs you, sending, submitted, quiet N days, reply, interview, offer, not this time | — |
| Receipt | — | submitted, blocked → finish on their site |
| InboxRow / MessageView | normal, scam-flagged | unread, read |
| ApplyAddress | — | copied |
| JobHeader, JobFacts, Rounds, People, Description | — | — |
| StickyApplyBar | apply, don't meet, apply at source, submitted | — |
| AccountSettings | share level, apply mode, view log, delete (own page) | — |
| Auth screens (approved) | sign-in, code, welcome, under-18 | as captured; Delete is removed from first-run |

`app/*` and `job/*` fold in here. `board/*` becomes the Discover screen.

### 7.4 `components/campus/` (console)

Everything in 4.x (component inventory and suppression rules), plus:
- ConsoleShell: sidebar full height, campus header
- PageHeader: cohort switcher, date range, actions
- RosterImport: upload, map, preview, confirm
- OutcomeTable
- OfferReview

`Console.tsx`, `Dash.tsx` and `Pages.tsx` are split into these files.

### 7.5 Delete after the move (each only once it has no imports)

| What to delete | Why |
|---|---|
| `components/landing-v3/**` | the rejected landing |
| `ui/Marquee.tsx`, `ui/CountUp.tsx` | banned motion |
| `ui/Reveal.tsx` | if it hides content until JS runs |
| `ui/MatchRing.tsx` | a score ring conflicts with "no fake score"; RuleList replaces it |
| `ui/RangeSlider.tsx` | if Discover doesn't use it |
| Overpass and Public Sans font loading | replaced by Geist (0.7) |
| The dark-green v3 values and the `@theme inline` shadcn duplicate block in `globals.css` | replaced by 1.3 |
| The stale `design-system/` folder | FE-6 |

---

## Part 8. Build order (after the owner approves; smallest valuable slices first)

Every slice must pass all of these before it ships:
- captures at 320, 360, 390, 430 and 1440
- a Hallmark check: tokens only, no eyebrow labels, no middle dots, no drawn chrome, one primary
- JS ≤ 100 KB per student page
- `pnpm verify`
- a local commit per slice

| # | Slice | Why this order | Done when |
|---|---|---|---|
| 1 | **Truth fixes:** copy tables 0.1–0.2, live count line (0.3), Delete moved off first-run (0.4 in Draft B, 0.2 here), owner notes for stale docs | low effort; removes false or rejected claims from what exists | no string in tables 0.1–0.2 remains; counts come from the query |
| 2 | **Tokens and fonts:** the 1.3 `@theme`, Geist in the root layout, surfaces by `data-surface`, DESIGN.md amended per 0.6 | everything after depends on it | one font load; no hex outside `globals.css` |
| 3 | **Console privacy and shell:** suppression rules 4.y, full-height sidebar, one primary, cohort switcher, date range, base line | the approved console is the pilot sales tool, and it leaks today | k tests cover legends, shares, tooltips, CSV |
| 4 | **Capture pipeline and the single sample fixture** (1.6) | the site can't look funded without sharp, consistent captures | `pnpm capture:site` produces AVIF/WebP with no dev chrome; one rule set everywhere (audit item 1) |
| 5 | **Home S0–S2 + footer** | the first impression the owner rated 1/10 | hero, proof strip and footer live |
| 6 | **Home S3–S9** | completes the page | full page passes the five craft checks in 1.8 |
| 7 | **Student Home (wireframes 2.1/2.2)** on the new tokens, with honest-count hooks and zero states | the approved direction becomes real code | greeting, top slot, unlock row live |
| 8 | **Picks states (wireframes 2.3/2.4)** against fixtures: applied + undo, needs you, blocked, capped, "I'll submit myself", empty; plus the `auto_apply` onboarding step | the core of decision 1; fixture-only until the pilot | every state reachable in Storybook-style fixture routes |
| 9 | **Tracker and inbox (wireframes 2.5/2.6)** with receipts and the apply address | depends on migration 0012 (apply pipeline) | reply forwarding shows in-app |
| 10 | **Job detail (wireframes 2.7/2.8)** with show-the-maths and the sticky bar states | Discover and Paste both land here | fail, unknown and scam states covered |
| 11 | **Console Drives list + Add a drive (wireframes 3.3/3.4)** | S6 drive inbox was moved earlier by the owner | publish includes unknowns; CTC split never invented |
| 12 | **Outcomes + Offer review (wireframes 3.5/3.6), Students views and roster import (3.2)** | gated on G4 for full use; the screens can be built on fixtures | view log entries appear for the student |
| 13 | **`/colleges` and `/students` rebuilt from landing sections**, 404, OG images, `/jobs` public page, `/help`, `/security`, `/pilot` | reuse once the sections exist | per-page OG images from captures |
| 14 | **Delete list 7.5** and the folder moves | last, once nothing imports them | the build has no unused components |

This runs alongside the screen audit's resume track (upload, reading, health, confirm, S-9), which stays first for the product. Slices 1–4 here are small enough to run before or between those slices.

---

## Appendix A. Where the two drafts disagreed, and how this plan resolves it

| Topic | Draft A said | Draft B said | Used in this plan | Why |
|---|---|---|---|---|
| Apply copy | Live tense: "Hirelane sends your application" | Pre-pilot copy until the pilot flag; two versions per line | Both versions in 0.1; pre-pilot ships first | Submission is fixture-only until the supervised pilot (decision 1) |
| Website font | Bricolage, subset variable file | Geist everywhere; Bricolage only on approved auth | Geist for site, app and console; Bricolage on auth | One font load (0.7); decision 6 |
| Display weight | Giant display type, weight 800 | Display weight 600 | 600 (one-line change to 800 if the owner wants it) | Geist scale in 1.2 |
| Website container | 1120 px max, 12 columns | 1200 px max, 4 columns on phone | 1120 px, 12 columns; 4 columns on phone is kept for the app | Page-level spec in Draft A |
| Section rhythm | 120 px laptop, 64 px phone | 128 px desktop, 72 px phone | 120 / 64 | Draft A |
| Colour token names | `--color-cream`, `--color-lime`, `--color-line`, `--color-ink-muted` | `--color-paper`, `--color-rule`, `--color-ink-3`, `--card-*` | Draft B names; Draft A's roles are covered by them | Draft B is the token system; decision in open items |
| Site primary fill | Lime for the primary pill | Ink fill | Ink fill; lime only as accent per 0.4 | Hallmark: one primary per screen; owner check in 1.5 |
| Home section order | Draft A W1: 10 sections (hero, product moment, count strip, how applying works, resume, paste, cells band, never list, questions, closing) | Draft B 1.10: S0–S9 (nav, hero, proof strip, from swipe to submitted, feature rows, never list, cells band, questions, closing, footer) | Draft A's content order; Draft B's wireframes drawn for the layout | Both drafts cover the same content, so the order is a review decision |
| Students primary | "Check a drive notice" | "Check my eligibility" | "Check a drive notice" | Form is the action (open item) |
| /colleges primary | "Request a pilot" | "Book a demo" | "Request a pilot" | Draft A is the page-level spec; open item |
| Tab set | Home, Picks, Drives, Tracker, You | Home, Discover, Drives, Tracker, You | Decision 2 | Owner call |
| Area chart | Applications per day | Applications per week, weekly buckets | Weekly (k-bound) | Draft B's suppression rules; decision 4 |
| Share-level outcomes wording | "interview and offer status" | "your offer, nothing else" | "interview and offer status" | A-6 and 5.6 count interviews in aggregates; open item |
| Pre-pilot Picks stamp | APPLIED stamp | READY stamp, "Get it ready" | READY when auto-apply is off or the pilot flag is off; APPLIED only on the pilot | Draft B 2.3(f) |
| Tertiary action on Add a drive | "Save as draft" | Autosave, no Save as draft | Owner picks at review | Open item |
| Phone tab bar height | 56 px | 64 px | 64 px | Draft B shell |
| Morning refresh and cap | Open decision 8 (cap and capped-swipe behaviour) | Open decision 5 (refresh time, cap, 9:00 placeholder) | Decision 5 | Same question |
| Event count k | Open decision 3 (live count floor) | Open decision 4 (event counts under k) | Decision 4 covers both | Related: both are about what counts may be shown |
| Auth surface | Night background stays (approved) | Open: keep night or move to paper | Night stays until decision 6 | Approved screens do not change without the owner |

---

## Appendix B. Full open items list (both drafts)

**From Draft A, section 6:**
1. Tab set (6.1 in this plan). In the top six as decision 2.
2. Student replies to employers (6.2). In the top six as decision 3.
3. Live count floor for the website stat strip. In the top six as decision 4.
4. Pilot page prices, hidden until CAMPUS-FIRST §9 is decided. Open item.
5. About page: whether to show team names and photos. Open item.
6. Stale documents: PRD §5 non-goal and auto-submit-opt-in.md "Until then" marked superseded by DECISIONS-2026-10-29-night §1. Action (0.9 and the open items).
7. New tokens `--color-ink-muted` and `--color-line` for the light website and the student app chrome. Open item (Draft B already defines `--color-ink-3` and `--color-rule`).
8. Daily cap value per student, and whether a capped right swipe queues for tomorrow or goes straight to the fallback. In the top six as decision 5.

**From Draft B, section 6:**
A. Auth font: Bricolage or Geist for the approved sign-in and onboarding. In the top six as decision 6.
B. Auth surface: night or paper. In the top six as decision 6.
C. Logo wall: none until signed pilots with written permission. Open item.
D. k for event counts. In the top six as decision 4.
E. Morning refresh time and daily cap (9:00 placeholder). In the top six as decision 5.
F. Push notifications: web push at the pilot, or in-app only until the sending domain is warm. Open item.

**Found while merging:**
- Pre-pilot copy versus live copy (0.1). In the top six as decision 1.
- Primary CTA name on /colleges (Request a pilot or Book a demo). Open item.
- Students page primary label. Open item.
- Share-level wording for the outcomes level. Open item.
- Grievance officer named (launch blocker, W6). Open item.
- Full share-level contents (the "Full" row in W3). Open item.
- Save as draft versus autosave on Add a drive. Open item.
