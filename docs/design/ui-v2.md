# Hirelane UI v2: the live product-demo landing (2026-10-16)

The owner reviewed v1 and rejected it as "zero interactive, no landing page, AI slop". v1 was the austere "timetable" look: flat,
no motion, no product visuals. v2 keeps the name, the lane-marking wordmark, Overpass, the honest-numbers rule and the human
approval mechanics, and becomes **vivid and interactive**. A working mini product demo is the hero. The owner chose this
direction from an ASCII preview. **This file overrides PLAN §4.1's banned-tropes list where they conflict**: product mockups,
floating cards, gradients and motion are allowed. Still banned: a mascot or emoji character, fake testimonials, made-up stats
(every number is live from the DB, with an as-of time), stock "spray and pray" claims, and anything implying auto-submission
without approval.

## Visual system

- **Type:** Overpass Variable. Display 800, tracking −0.03em, hero 64/66 desktop and 40/44 mobile. Body 16/26. Tabular numerals.
- **Colour tokens** (extend `@theme`, keep the old names as aliases):
  - `--ink #0F1F1A`, `--ink-2 #43514B`, `--ink-3 #74827C`
  - `--canvas #F6F8F6`, `--surface #FFFFFF`, `--line #E3E8E4`
  - `--lane #0F5C45` (brand green, deeper and more saturated), `--lane-600 #0B4A37`, `--lane-50 #E8F3EE`, `--lane-100 #CFE7DB`
  - `--signal #FACC15` (Needs-you, the undo bar and highlights), `--signal-50 #FEF9C3`
  - `--match #10B981`, `--miss #EF4444`, `--info #2563EB`
  - Hero background: a soft mesh of `--lane-100`, `#E0F2FE` and `--canvas`, plus a faint lane-stripe pattern (diagonal 1px
    lines at 4%). A dark band section uses `--ink` with lane-green glow accents.
- **Depth:** cards use 16px radius, a 1px `--line` border and shadow `0 1px 2px rgb(15 31 26 / .05), 0 12px 32px rgb(15 31 26 / .08)`.
  Buttons are 12px radius; the primary is lane green with white text and a darker hover.
- **Motion** (`motion` v12): reveal-on-view once, counters count up, the demo card animates. All of it respects reduced motion.
- **Logos:** company logos from the Phase 2 logo store or a monogram (letter tile in a hashed hue). Never broken images.

## Pages

### `/`: landing

1. **Hero.** Left side:
   - H1 "Apply to the right jobs while you sleep. You approve every one."
   - A subline: Hirelane reads 119 company career sites every six hours (count live), matches roles to your resume and drafts
     each application for you to approve.
   - A **resume drop zone**: dashed card, drag or click.
     - It accepts a PDF in the browser only and does NOT upload yet (accounts arrive in Phase 4).
     - On drop it plays a parse animation using fixture data (name, roles, 6 skill chips appearing), then shows "Create your
       account to save this. Coming in the next release" with a disabled primary button.
   - Under it: live counts "16,320 open roles · 119 companies · salary shown on 10,663" with count-up and the as-of time.

   Right side: the **live demo card stack**, a working mini app on fixture data:
   - The top card shows a real job from the DB (company logo, title, location, normalised salary), a match score ring with
     its maths ("9 of 11 requirements · salary above your floor"), requirement chips (✓ matched / ✗ missing), and one
     "Needs you" field with the signal-yellow left rule ("Notice period?" with an input).
   - Buttons **Pass** and **Approve & send**.
     - Approve plays the 4-second draining undo bar ("Sending in 3.2s · Undo"), then a "Handed off to Razorpay's site"
       confirmation, then the next card slides up.
     - Pass slides the card away.
     - Keyboard: A approves, P passes, U undoes.
   - This is a labelled demo ("Demo: nothing is sent"). It never posts anywhere.
2. **Live ticker.** A marquee of the freshest 30 jobs (logo, company, title, "2h ago"). It pauses on hover, and each item
   links to `/job/[slug]`.
3. **How it works.** Four steps: Upload → Match → Approve → Replies. On desktop, a sticky stepper sits on the left and an
   animated mockup panel on the right changes as you scroll. On mobile it becomes stacked cards.
4. **Salary truth.** A real job's pay trace, interactive: click a step to highlight the source text span it came from. Next
   to it is the stat "Salary shown on N% of jobs" (live).
5. **Autopilot.** Dark band. Rule controls: a min match score slider, a role select and a per-day cap. The live readout
   "≈ N new jobs a week would clear this rule" is computed from real 6-hourly ingest counts and posted dates through
   `GET /api/public/stats/autopilot?min=…&role=…`. A mock batch-email card is shown next to it. Labelled "Paid plans · coming
   in Phase 7".
6. **What Hirelane never does.** A clean two-column list: never sends without your OK, never invents an answer, never
   shows your lowest pay, never sells data.
7. **Pricing.** A Weekly / Monthly / Quarterly toggle with Free, Basic, Pro and Ultra cards in INR (USD for non-India,
   based on Accept-Language). Per-application cost shown. Buttons say "Start free"; checkout arrives in Phase 7.
8. **Closing CTA band** with a compact resume drop zone.

### `/jobs`: board

- Upgrade the ledger into **job rows with depth**: logo, title, company, location chips, salary pill, freshness dot, and
  skills as up to 3 chips.
- Hovering (or focusing) a row opens a right-hand **preview panel** on desktop: pay trace summary, top requirements and the
  Apply handoff, with no navigation.
- A filter bar of chips with counts and a search box with suggestions (title and company type-ahead).
- Infinite load with skeletons. Keyboard j/k/Enter stays.

### `/job/[slug]`

- A hero header: logo, title, company and meta chips, plus a sticky apply card on the right (salary, "Apply on employer
  site", and a "Save" that is local for now).
- The body: description rendered from sanitised markdown, with the requirements split into must-have and nice-to-have, each
  showing its evidence.
- A "Similar roles" carousel.

### Global

- Header: transparent over the hero, then solid with a blur. Nav: Jobs, How it works, Pricing, Companies; primary "Start free".
- Mobile menu sheet.
- Footer with four columns: Product, Data (API, llms.txt, sitemap, status), Company, Legal.

## Quality bar

- At 1440 and 390 the pages must look like a funded consumer product.
- The landing page renders server-side with real data; only the demo, drop zone, ticker and controls are client islands.
- No horizontal overflow, axe: 0 serious.
