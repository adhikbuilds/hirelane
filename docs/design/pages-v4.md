# Hirelane v4 pages: every page with depth (2026-10-16)

## What the owner said

- "UI detailing and its pages are missing."
- "How it works, companies and other pages are not properly built in depth; no workflow diagrams or anything."
- "Add her image and make it more interactive, which shows BITS Pilani as the campus."

The landing (`landing-v4.md`) sets the theme: **"Your lane to the next job"**, one sample character (Asha), a light
theme, polished cards and playable fragments. **Every page now gets the same quality.** Each page has at least one
interactive diagram or tool built on real data. No page is a wall of text.

## Global

- **The v4 light theme becomes the site theme on every route** (tokens from `[data-landing="v4"]` promoted to the
  default). The v4 header and footer appear everywhere.
  - Header: wordmark, Jobs, Companies, How it works, Pricing, Network, then Start free.
  - Mobile: a menu sheet.
- **UI detailing on every page:**
  - hover, press and focus states on every control
  - skeletons while loading
  - empty and error states with one next action
  - tooltips on jargon
  - tabular figures
  - section entrances (once, reduced-motion safe)
  - breadcrumb and "you are here" on deep pages
  - consistent 8px spacing grid and radii
  - logos or monograms everywhere a company appears
- **Data honesty:** live numbers carry an as-of time. Anything about Asha is labelled "Sample profile". Nothing is
  invented about real companies.

## Asha: the sample profile (used across the site)

| Field | Value |
|---|---|
| Name | Asha Iyer, labelled **"Sample profile"** |
| Role | Data engineer, 4 years |
| Location | Bengaluru |
| Education | **B.E. Computer Science, BITS Pilani (2021)** |
| Skills | Python, SQL, Spark, Airflow, dbt, AWS, Kafka, PostgreSQL |
| Pay floor | ₹30 L/yr |
| Wants | Hybrid or remote; data and platform roles |

- **Photo:** `apps/web/public/landing/asha/asha-portrait.jpg`, AI-generated. Captions and alt text say "AI-generated
  sample person". `asha-desk.jpg` is a candid photo at her desk, also AI-generated.
- **Campus photos:** real photographs of BITS Pilani from Wikimedia Commons. Use `apps/web/public/landing/campus/*.jpg`
  and give each the credit line from `credits.json` wherever it appears (CC BY-SA 3.0 and public domain).
- **The "Meet Asha" profile card** sits on the landing as the opening of the workflow chapter, and again on
  `/network`. It is interactive:
  - **Front:** portrait, name, role, city, "BITS Pilani '21" with a tiny campus thumbnail, and skill chips.
  - **Flip or expand** (click or tap; keyboard Space) to a profile sheet with three tabs:
    - **Resume:** a mini resume (2 roles and education), with skills that highlight when hovered across the page.
    - **Campus:** the BITS Pilani photos with credits, her batch and department, and a "Why this matters" line:
      "Alumni are often the warmest intro. Hirelane will show BITS alumni at the companies you match (Network,
      coming)."
    - **What she wants:** pay floor, work mode and roles, all editable chips that **re-score the matches live** in the
      workflow (pure client maths with `matchFixture`).
  - Changing her pay floor or skills visibly changes the hero phone and workflow scores. This is the "more
    interactive" ask.

## Pages

### `/how-it-works`: the pipeline, as a living diagram

- **Hero:** "From career site to your approval." A **horizontal pipeline diagram** (vertical on mobile) of seven
  nodes connected by lane lines, with **animated dots flowing along the edges**:
  1. Read
  2. Clean and merge
  3. Read the pay
  4. Match
  5. Draft
  6. You approve
  7. Hand off

  The diagram is SVG with motion and is reduced-motion safe.
- **Each node is clickable** and opens its **real artifact** in a side panel:
  - **Read:** a real raw posting, a short excerpt from the ATS feed of one real job, with its source and fetch time.
  - **Clean and merge:** the same job after normalising (title, company, location, workplace), plus the duplicate count
    merged today (live).
  - **Read the pay:** the pay trace with source words lit (`trace-model.ts`).
  - **Match:** Asha versus the job, with requirements met and missed, a pay-floor check and the score maths.
  - **Draft:** the filled form with one Needs-you field.
  - **You approve:** the approve and 4 s undo mini.
  - **Hand off:** a diagram of opening the employer's own form, with the note "never submits on its own".
- **A six-hour cycle clock:** a circular diagram of the four daily reads (00, 06, 12, 18 UTC), marking the last read
  (live) and the next one (a countdown), with jobs added and closed per run from the ingest runs table.
- **"What it never does":** a compact visual list, with icons, under 40 words.
- **Data-flow footnote:** the public ATS boards it reads, and the API, llms.txt and sitemap for agents.

### `/companies`: the directory, with depth

- **Hero:** "{127} companies, read every six hours." A filter bar:
  - hires in India
  - remote-friendly
  - pays stated (percentage)
  - role family
  - search
- **Company grid of rich cards:**
  - logo or monogram, name, domain
  - open roles (count)
  - a 12-week posting sparkline (from first-seen dates)
  - % of roles with stated pay
  - top 3 role families as small bars
  - India roles count
  - "Asha's matches here: N" (from the sample profile)
- **Views:**
  - grid or table toggle
  - sort by open roles, freshest, pay transparency or Asha's matches
- **A visual "who is hiring for what" heatmap:** companies × role families, cells shaded by open roles, clickable
  through to `/jobs?company=…&role=…`.

### `/company/[slug]`: one company in depth

- **Header:** logo, name, domain link, ATS source and last read time.
- **Stat strip:** open roles, new this week, closed this week, pay stated %, median stated pay.
- **Charts (real data):**
  - postings over 12 weeks (area)
  - role-family mix (donut)
  - pay ranges by role family (range bars in normalised currency, only from stated pay)
  - location mix (bar chips with country flags as emoji-free SVG or text)
- **"Asha here":** her best 3 matches at this company, as v4 cards with swipe.
- **Network teaser:** "People you know here", a locked preview showing how BITS alumni and coworkers will appear
  (sample graph), labelled "Network, coming".
- **Open roles list** with filters and a List | Swipe switch.

### `/jobs`: the board, v4

- The light theme, v4 cards in a list, and a **List | Swipe** switch (`?view=swipe`). In Swipe view, right saves to the
  shortlist (localStorage) and left hides, with undo.
- Filters as chips with counts. The desktop preview panel shows the v4 card, the pay trace and requirements.
  Type-ahead search.
- Toggle **"Compare with Asha"** to show the match % on every card.

### `/job/[slug]`: the job page, v4

- A hero card (v4 card enlarged), a sticky apply card, and the pay trace with source words.
- Requirements with evidence and a **"Compare with Asha" toggle** that marks met and missed on each requirement.
- **An "Apply flow" mini diagram** for this job: Draft, then You approve, then the employer's form (the real ATS
  host), showing the fields Hirelane would fill and the Needs-you questions for this job.
- Similar roles carousel. JSON-LD and the markdown twin stay unchanged.

### `/pricing`: a full page

- Plan cards: Free, Basic, Pro and Ultra, with Weekly, Monthly and Quarterly options and INR/USD.
- **A cost calculator:** applications per week (slider) produces the best plan, the per-application cost and the
  monthly total.
- A comparison table and a short FAQ. "Planned prices. Checkout opens soon."

### `/network`: the warm-intro preview (new)

- "Jobs where you know someone." Asha's **sample network graph**: an interactive force graph (react-force-graph-2d or
  d3-force in SVG) of Asha, her BITS Pilani batchmates and ex-coworkers, and the companies they work at. Nodes are
  coloured by type; edges are weighted by the warmth formula from `docs/network-plan.md`.
- Clicking a company node highlights the warmest path and shows the intro draft (sample) with approve and undo.
- Everything is **sample data, clearly labelled**. Real contacts come from your own LinkedIn export in Phase 4N.
- An "Import your network (coming)" panel explains the privacy model in 3 bullets.

### `/start`: sign-up

- "Start free." An email field for the magic link, disabled with "Opening soon", plus "Join the list" (stores
  nothing until accounts exist; show honest copy).
- The resume drop from the landing (browser only), and what happens next as a 3-step mini diagram.

### `/about`: product, limits and data notice

- About in under 120 words.
- **Limits, stated outright** as a visual list.
- Data sources (public ATS boards), the AI-generated imagery notice and the photo credits (BITS Pilani photos).

## Gates for every page

- Screenshots at 1440 and 390 of every page and every interactive state, reviewed by eye.
- The ui-ux-pro-max checklist.
- axe 0 serious.
- No horizontal scroll.
- e2e for each page's main interaction.
- `pnpm verify` green.
- The JSON-LD, markdown twin, sitemap and public API contracts from Phase 3 keep passing.
