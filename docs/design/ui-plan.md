# Hirelane UI plan, from the very first (2026-10-16)

Four rebuilds of the landing have been rejected:
1. **v1:** "zero interactive, AI slop"
2. **v2:** "complete AI slop"
3. **v3:** "too much text, zero UI depth", then "AI catalog, no workflow, the card looks very bad"
4. **v4:** stopped mid-build; "pages and detailing missing, no workflow diagrams, plan from the very first"

**The root cause was process, not effort.** Each round jumped straight from a written spec to whole pages, with no shared
design system, no agreed screens and no point where the owner approved the look *before* pages were built.

This plan fixes the order: **foundations, then components, then key screens, then pages.** Each step ends with an owner
review of real screenshots, and nothing moves to the next step until it is approved.

## 0. Direction update (owner, 2026-10-16): Gen Z, entry level, app later

> "We are making it for many entry-level people, so it should be Gen Z and interactive. We will launch the app later
> for the same."

- **Audience:** freshers, final-year students and people 0–2 years in. Gen Z first, and mobile first. A native app
  comes later, so components are designed to translate to React Native: no hover-only behaviour, thumb-sized targets
  and gestures first.
- **Asha becomes entry level:** Asha Iyer, final-year B.E. Computer Science at **BITS Pilani**, graduating 2026.
  - Hunting her first job or internship: SDE, data and product roles.
  - Bengaluru or remote. Labelled "Sample profile".
  - Skills: Python, SQL, React, DSA, one internship.
- **Look:** Gen Z, playful and interactive, not "premium SaaS". The previous light warm theme was rejected before it
  was shown. The style tile is now built in **two directions side by side**; the owner picks from screenshots:
  - **A, "Neubrutal pop"** (ui-ux-pro-max: Neubrutalism, best for Gen Z): thick black outlines, hard offset shadows,
    bright flat pop colours, chunky type, stickers and stamps, snappy motion.
  - **B, "Playful blocks"** (ui-ux-pro-max: Vibrant and block-based, plus a soft 3D touch): bold colour fields,
    rounded chunky cards with a bouncy press, playful micro-interactions and sticker badges.
- **Copy voice:** short, casual and fun ("Swipe. Apply. Done."), but always honest. No cringe slang overload. Use
  emojis only as decoration in copy if the chosen direction calls for them; icons stay SVG.
- **Owner's vibe references:** Spotify Wrapped and Duolingo. Capture the feel only, never their assets, names or
  mascot. The two style tiles now map to them:
  - **A, "Wrapped stories":** loud colour blocks, giant type, story cards with progress segments, and a shareable "your
    week" card.
  - **B, "Duo playful":** chunky pressable 3D buttons, a streak and progress, a celebratory apply, a lesson-like flow,
    and no mascot.
- Everything else in this plan holds: real data, the playable workflow, the milestones and preview-only routes.

## 1. Who it is for and what they must feel

- **Primary user: Asha.** A data engineer, 4 years in, in Bengaluru, BITS Pilani '21. She is applying on the side of
  a full-time job and is tired of retyping the same forms.
  - She opens the site on her phone during a break, and on her laptop in the evening.
- **Second user:** a fresher or new grad hunting a first job. They have a smaller network, so warm intros matter more.
- **What a visitor must feel in 10 seconds:** "This is an app I can use right now, it is in control of nothing I didn't
  approve, and it knows the real jobs."
- **What a visitor must do in 60 seconds:** play the loop. See a real job, swipe, watch the form fill, undo.

## 2. Principles, from all owner feedback so far

1. **Show, don't tell.** Every section is a working product fragment or diagram on real data. Copy stays at about 200
   words per page.
2. **One theme, told as a story:** "Your lane to the next job." There is one throughline (the lane line) and one
   sample character (Asha), and each chapter shows a different side.
3. **Playable workflow.** The landing *is* the product loop: resume, then matches, then swipe, then the form fills,
   then handoff.
4. **Depth through real objects.** The phone frame, layered cards, sheets and toasts carry the depth, using elevation
   and motion with meaning. No decorative blobs or gradient meshes.
5. **Polished, uncluttered cards.** A fixed anatomy, short forms, at most 3 chips, and one "why it fits" line.
6. **Every page has depth.** Every page gets a diagram, chart or tool. No page is only prose.
7. **Honest.** Real jobs and live numbers with an as-of time. Asha is a labelled sample person. Credited real photos;
   AI images are labelled. No testimonials, mascot or invented stats.
8. **Consistency.** One design system, one header and footer, and the same card everywhere.

## 3. Reference study (patterns only; never copy copy, colours or names)

| Reference | Borrow | Beat it by |
|---|---|---|
| The studied job-agent landing | A phone running the real loop in the hero; floating outcome notes; each section a product fragment; a light, warm, roomy page | Playable end to end; real numbers; pay with its source words; no mascot or fake reviews; the network angle |
| Swipe apps (Tinder-style stacks) | Stack depth, drag physics, stamps, undo | Approval-first: the Needs-you gate and the 4 s undo |
| Happenstance-style network tools | "Who do you know there" | Built on your own imported contacts, encrypted, with warmth written as its equation |
| Linear / Raycast-class landings | Crisp type, restrained colour, product UI as the hero, keyboard hints | A story arc with a playable product instead of static screenshots |

Before Milestone 2, record new screenshots of 3–5 references (Playwright, patterns only) into `docs/recon/` and
annotate what each does well.

## 4. Information architecture

**Public:**
- `/` (story landing)
- `/jobs` (board, List | Swipe)
- `/job/[slug]`
- `/companies`
- `/company/[slug]`
- `/how-it-works` (pipeline diagram)
- `/pricing` (calculator)
- `/network` (sample graph preview)
- `/start` (sign-up: magic link, coming)
- `/about` (limits, data, credits)

**Signed in (Phase 4):**
- `/app` (your queue: swipe stack)
- `/app/drafts` (ready to send)
- `/app/tracker`
- `/app/network`
- `/app/profile` (resume versions, preferences)

**Navigation:** Jobs, Companies, How it works, Pricing, Network, then **Start free**. The footer has four columns plus
credits.

**Key flows:**
1. A visitor on `/` plays the loop, then goes to Start free.
2. A searcher goes from `/jobs` (filter, swipe) to a job, to Compare with Asha or Start.
3. A curious visitor goes from `/how-it-works` (clicks a node) to a real artifact.
4. A company-first visitor goes from `/companies` (heatmap) to a company page, to its roles.
5. Later, signed in: `/app` queue, then swipe, then the Ready-to-send sheet, then hand off, then the tracker.

## 5. Design system (build first, as a living gallery at `/dev/kit`)

**Tokens:**
- **Colour (light):**
  - ground `#F7F6F2`, surface `#FFF`
  - ink `#13201A` and `#55625B`, line `#E6E4DD`
  - lane green `#0F5C45` (brand and primary), lime `#C6F19D` (highlight)
  - signal `#FACC15` (Needs-you and undo), pass `#E5484D`, info `#2563EB`
  - one dark surface `#13201A` for toasts and the autopilot panel
  - contrast checked (4.5:1 for text)
- **Type:** Overpass Variable.

  | Style | Size / line height | Weight |
  |---|---|---|
  | Display | 64/68 (mobile 40/44) | 800 |
  | H2 | 40/44 | 800 |
  | H3 | 24/30 | 700 |
  | Body | 17/26 | 400 |
  | Small | 14/20 | 400 |
  | Micro | 13/18 | 400 |

  Tabular figures everywhere.
- **Space:** a 4px base, with steps 8, 12, 16, 24, 32, 48, 64, 96 and 128.
- **Radius:** 8 (chips, inputs), 14 (buttons), 20 (cards), 28 (sheets and phone screen).
- **Elevation:** e0 flat; e1 card at rest (a soft 1px plus 8px blur); e2 lifted or hover; e3 floating (sheets, phone,
  toasts).
- **Motion:**
  - durations 120 (feedback), 200 (UI), 320 (enter), 600 (story)
  - easing standard `(0.2, 0, 0, 1)` and spring (stiffness 300, damping 30) for cards
  - reduced-motion alternatives for every move
- **Icons:** Lucide at 1.75 stroke.

**Components:** shadcn base (Button, Input, Select, Slider, Switch, ToggleGroup, Tabs, Accordion, Dialog, Sheet,
Tooltip, Sonner, Skeleton), plus Hirelane components:

| Component | What it is |
|---|---|
| **JobCard** | Fixed anatomy: logo, company and place, match ring, role, pay (with source), ≤ 3 chips, why-it-fits, an optional Needs-you row. Sizes S (list), M (stack), L (job hero). |
| MatchRing | Score ring with an accessible label |
| PayPill + PayTrace | Pay with its source words lit |
| NeedsYouField | Signal-yellow field that blocks approval until answered |
| UndoToast | 4 s drain, U to undo |
| SwipeStack | v3 physics, buttons and keys |
| PhoneFrame | Device frame that hosts the mini app |
| ReadyToSendSheet | Filled form inside the phone |
| AutofillForm | Fields that type themselves |
| ProfileCard (Asha) | Flip or expand, with tabs |
| PipelineDiagram | Nodes, animated edges, click-to-open artifact |
| CycleClock | The four daily reads, last and next |
| LaneLine + Signpost | The story throughline |
| Charts | Sparkline, area, donut, range bars, heatmap |
| CompanyCard | Rich directory card |
| NetworkGraph | Sample warm-intro graph |
| StatStrip, EmptyState, Skeletons, Breadcrumbs | Page furniture |

Each component has every state (default, hover, focus, pressed, disabled, loading, empty, error) in `/dev/kit`, at
1440 and 390.

## 6. Key screens to approve before pages (hi-fi, built in code)

1. **The JobCard** in S, M and L, against the reference card side by side.
2. **The hero:** the phone loop, from card, to drag, to Ready-to-send, to toast, to next card.
3. **One workflow step:** the form filling itself, with the Needs-you pause.
4. **The How-it-works pipeline:** one node open with its real artifact.
5. **One company page chart block.**

These five are shown to the owner as screenshots plus a 15 s screen recording of the loop. **Pages start only after
these are approved.**

## 7. Page wireframes (lo-fi; layout and interaction, not style)

```
/ LANDING (story: Your lane to the next job)            /how-it-works
┌───────────────────────────────────────────┐          ┌───────────────────────────────────────┐
│ nav                                [Start] │          │ From career site to your approval.    │
│ Swipe right on jobs.      ┌─phone──────┐   │          │ (Read)─(Clean)─(Pay)─(Match)─(Draft)─  │
│ We fill in the form.      │ JobCard M  │ ⓘ │          │  •→•→•  animated dots   (Approve)─(Handoff)
│ [Try it now] Browse jobs  │ ✕   ✓      │ ⓘ │          │ ┌ click a node: real artifact panel ┐ │
│ timeline: posted→matched  └────────────┘   │          │ └────────────────────────────────────┘ │
│ ─ lane line ─ signpost: The problem        │          │ CycleClock 00 06 12 18 · next in 2:14  │
│ pile of identical forms + counter          │          │ never-does (visual)                    │
│ ─ signpost: Try the whole thing ─          │          └───────────────────────────────────────┘
│ [Meet Asha card] → 1 resume 2 matches      │
│   3 swipe 4 form fills 5 handed off        │          /companies
│ ─ Control (dark): rule slider + timeline ─ │          ┌───────────────────────────────────────┐
│ ─ Trust: pay trace, words light up ─       │          │ filters ▸ cards grid | table          │
│ ─ Proof: live board, Asha's row lit ─      │          │ [logo] Stripe 687 ▁▃▅▇ 72% pay ...    │
│ ─ Offer: pricing ─ FAQ ─ Close ───────────→│          │ heatmap company × role (click → jobs) │
└───────────────────────────────────────────┘          └───────────────────────────────────────┘
/jobs  [List|Swipe] [Compare with Asha]   chips…        /company/[slug]: header · stat strip ·
list of JobCard S  │ preview: JobCard L + trace          area · donut · pay ranges · Asha here ·
/job/[slug]: JobCard L hero · sticky apply · trace ·     locked network teaser · roles List|Swipe
requirements (✓/✗ vs Asha) · Apply-flow diagram ·        /pricing: plans · calculator · table · FAQ
similar carousel                                          /network: sample graph · warmest path · draft
```

## 8. Content and voice

- Plain and confident. Sentence case. Headlines of six words or fewer.
- No jargon without a tooltip.
- About 200 words of marketing copy per page.
- Numbers are always live, with an as-of time.
- Every Asha mention is labelled as a sample.

## 9. Milestones and owner checkpoints

| # | Milestone | Owner sees | Gate to continue |
|---|---|---|---|
| M0 | This plan | This doc plus wireframes | Owner approves or edits the plan |
| M0.5 | **Style tile**, one screen at `/preview/style-tile`: palette, type scale, buttons and chips, and one JobCard M inside the PhoneFrame, at 1440 and 390 | Screenshots | Owner approves the look (light warm theme, card) before any component work |
| M1 | Foundations + `/dev/kit` gallery: tokens, type, colour, elevation, motion, every base component and state | Screenshots of the gallery at 1440 and 390 | Owner: "the system looks right" |
| M2 | The five key screens (section 6), hi-fi in code | Screenshots plus a 15 s recording of the loop | Owner approves the card, hero and diagram |
| M3 | Landing story, built with the approved pieces | Live page, screenshots, recording | Owner approves the landing |
| M4 | Pages: How it works, Companies, Company, Jobs, Job, Pricing, Network, Start, About | Screenshots per page | Owner approves page by page (in batches) |
| M5 | Polish: detailing, empty/error states, a11y, performance; deploy preview | Lighthouse and axe results plus a walkthrough | Ship |

**How we work (rules that change the old process):**
- **`/` and the live site do not change until M3 is approved.** All M0.5–M2 work lives under preview routes
  (`/preview/*` and `/dev/kit`), with tokens scoped to a wrapper. No agent edits the shell, global tokens or `/` before
  then, so the owner never judges half-built pages.
- **Small checkpoints:** one or two agents per checkpoint, about 30–60 minutes each. No eight-agent hour-long runs.
- The owner is told when a checkpoint is ready and gets screenshots; they don't need to watch localhost.

**Every milestone:**
- built by ECC agents with the UI skills (ui-ux-pro-max, shadcn, ui-styling, fixing-accessibility and
  fixing-motion-performance)
- the ui-ux-pro-max checklist, axe 0 serious, no horizontal scroll, `pnpm verify` green
- a look-and-fix loop on screenshots before the owner sees anything

## 10. What is reused and what is thrown away

- **Keep:**
  - the data layer and APIs
  - the v3 swipe physics (`landing-v3/stack/physics.ts`), shadcn setup, Asha and campus assets, road photos
  - `pricing-model`, `trace-model` and `demo-model`
- **Rebuild on the new system:** the visuals of v2 and v3, the cards, the landing sections and the page shells.
- **Retire after M3:** `/dev/ui` (v2) and the v3 landing components.
- **The partial v4 work** (`components/landing-v4`, `app/v4-preview`) is input material for M2. Its card and phone
  loop are reviewed against the plan, not shipped as-is.
