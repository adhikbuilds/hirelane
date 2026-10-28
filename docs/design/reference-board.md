# Hirelane reference board

**Last updated:** 2026-10-29
**Source:** 36 viewport captures in `docs/design/refs/`, three per site: the hero, then two scrolled frames. Each is 1440×900, so image px are roughly CSS px.
**How to read the numbers:**
- Sizes, weights, tracking and hex values were measured by eye from the captures. They are estimates ("~"). Use them as targets to tune, not as specs.
- A typeface is named only when it is unmistakable. Otherwise it is described.
- Motion is marked **seen** only when the frames catch it mid-state. Anything else is **inferred**.

## Read this first

**Capture gaps**
- **PostHog:** all three frames show the same hero, because the page scrolls inside its own window and the capture did not scroll it. The frames differ only in a typing animation. The PostHog notes cover that one view, and nothing below it is described.
- **Not part of the designs:** cookie banners (Deel, Attio, PostHog), chat widgets (Attio, Rippling) and promo bars come from the capture. Ignore them, except where a promo bar is noted as a nav treatment.

**Direction conflict for the owner to resolve.** This board maps references against the approvals given on 2026-10-29:
- **Console:** dark, in a calm grey palette with one green accent.
- **Student app:** calm chrome, with colour only on the role cards.

`/DESIGN.md` (locked 2026-10-28, "Wrapped stories") disagrees with this board in three places. This board does not edit DESIGN.md. The owner should update it, or a reader who treats DESIGN.md as "the rule" will throw out the board:
- **Palette and material:** DESIGN.md says "bold, flat blocks. Never toned down", with a palette of lime, pink, sun, coral and blue. This board follows the newer calm approvals.
- **Display type:** DESIGN.md locks weight 800, tracking -0.045em and line-height ~0.92. Every reference here sets its H1 at weight ~500-600 (Handshake and Cal.com are the heavy exceptions), and this board recommends the lighter weight.
- **Primary control:** DESIGN.md specifies a weight-800 pill, 44-52px tall. The references use buttons ~32-40px tall on desktop marketing pages. This board keeps 44px+ in the app and recommends the smaller size on the public pages.

**Still binding from DESIGN.md**, and used for the "Never copy" column below:
- no glass
- no resting shadows
- no hand-drawn browser windows
- no purple-to-blue gradients
- no card inside a card
- no full-bleed photos
- no invented stats or testimonials
- no emoji as icons

**Open owner decisions.** Several references rely on patterns that are still open Hallmark decisions. Wherever a reference uses one, the board flags it and does not recommend it:
- tracked uppercase labels (gate 67)
- middle-dot meta strings (gate 63)
- **New for the owner:** whether status (New, Applied, Offer, rules met) may carry any hue outside the role cards in the student app. Until that is decided, the student-app rows below use monochrome status only: filled ink, outline or grey, weight, and the ✓ ~ ✕ glyphs.

**Example values are placeholders.** N, M and "Xh" below stand for live values from one shared data source. Never paste a literal number from this board into a mock (screen audit, "One sample data source").

---

## 1. Per site: the craft that makes it look funded

### linear.app
- **Type:** the H1 is left-aligned, ~64px, weight ~500, line-height ~1.0, with tight tracking (est. -0.025em), held to two lines. Under it sits one ~16px mid-grey subhead on a single line. Further down, a ~48px statement paragraph is **two-tone**: the first sentence is near-white and the rest drops to ~55% grey.
- **Colour:**
  - The background is near-black (~#08090A), and text uses three greys.
  - The chrome has **no brand accent at all**. The only hues are functional ones inside the product: a yellow "in progress" ring and a star.
  - The only filled button is the white "Sign up" pill (~32px tall). "Log in" is plain text, set off by a 1px vertical divider.
- **Product imagery:** the real app fills the full container width:
  - a sidebar
  - an issue
  - an activity feed with "2min ago" timestamps
  - a right-hand properties rail

  It has a 1px border and ~12px radius, and it runs off the bottom of the fold. A soft grey radial glow sits under its bottom edge.
- **Rhythm:**
  - **Logos:** 7 monochrome logos in one row, with a small uppercase **monospace** caption below them.
  - **Features:** 3 columns divided by 1px vertical rules. Each column has a mono "FIG 0.1" label, a thin-line isometric drawing, a ~16px title and a grey body.
  - **Breaks:** full-width 1px hairlines separate the sections. Each section head is large on the left, with its description in the right column.
- **Motion and nav:** the right-aligned "New Loops →" changelog link beside the subhead is caught mid-shimmer (**seen**). The nav has 7 grey text links at ~14px and a sticky hairline bottom border.

### ramp.com
- **Type:** the H1 is left-aligned, ~64px, weight ~500, tight, in black, over a one-line ~18px grey subhead. Section heads (~32px) and bento card titles (~24px) are **two-tone**: a black lead clause, then a grey continuation.
- **Colour:**
  - The page is white or a warm off-white canvas (~#F4F3EF).
  - **One accent, acid lime-yellow, appears only on primary CTAs.** Secondary CTAs are black or light grey.
  - A dot-grid texture fills the margins outside the content column.
- **Product imagery:** fragments that show real product behaviour float in a large rounded warm-grey canvas:
  - a receipt being "ANALYZING"
  - "MATCHING…" progress bars
  - a "FETCHING RECEIPT…" inbox list

  Each fragment carries tiny corner-node dots, like selection handles. The bento cards crop real product pieces at their bottom edge and put a square ↗ button top-right.
- **Live data (seen):**
  - A chip above the H1 holds a multi-decimal "processed" figure.
  - A strip along the bottom of the fold, "AGENTS AT WORK TODAY", has odometer digits caught mid-roll inside small bordered chips. Its labels are tracked caps (gate 67).
- **Social proof and capture:**
  - **Logo wall:** grey logos in a 6×2 grid of hairline-bordered square cells. Some cells carry a small ↗ to a case study, and one cell expands into a photo story with a giant stat.
  - **Email capture:** the input and the lime button sit inside one bordered field.

### mercury.com
- **Hero:**
  - A full-bleed cinematic photo: a desk on a misty hillside at dawn.
  - The H1 is centred, ~52px, weight ~500, near-white, over a two-line ~20px subhead.
  - The wordmark is letter-spaced uppercase.
  - **One accent**, periwinkle-indigo (~#5266EB), appears only on the "Open account" pill.
- **CTA cluster:**
  - A frosted-glass email field with the indigo pill inset, plus a ghost "Launch demo" pill.
  - The legal disclaimer is a dark pill pinned to the bottom of the hero.
  - The copy uses footnote superscripts ("banking¹").
- **Scroll reveal:** from frame 0 to frame 1, the camera pushes into the laptop on the desk until the real dashboard fills the viewport ("Welcome, Jane", a balance chart, an account list). The zoom is **inferred** from the frames.
- **Feature section** on dark navy (~#171721):
  - The left column has a ~24px two-line head, then a 4-item accordion with hairline rules. The active item has a small indigo dot and an expanded body.
  - The right column shows an enlarged product panel.
  - Money is right-aligned, with the cents as small superscripts (.87).
  - A rendered cursor hovers over "View" (scripted, **seen**).

### deel.com
- **Hero:** two rounded (~16px) panels side by side.
  - **Left:** a deep violet gradient with a white H1 at ~60px, weight ~700, tight, over 3 lines.
  - **Right:** a photo of a person at a laptop, with floating UI chips: "PAYROLL COMPLETE", an amount, a "Visa APPROVED" outline pill, and dropdown chips.
- **Intent picker** under the H1: "What would you like to do with Deel?", with five checkbox tiles (Hire anywhere, Run payroll, and so on). It routes the visitor before any feature tour starts.
- **Rhythm:**
  - A two-row greyscale logo marquee runs off both edges (seen: logos cut at the edges).
  - Section heads pair a small tracked-caps eyebrow, "WHAT DEEL DOES" (gate 67), with a ~44px H2.
- **Product cards:** three across, warm grey (~#F5F4F1), ~16px radius. Each has a ~22px semibold title and a one-line grey subtitle, then a mini UI vignette:
  - **tinted status pills:** green "ONBOARDING", orange "PENDING"
  - avatar stacks
  - flags
  - "12 workers relocated"
- **Nav:** an outline "Log in" pill and a black "Book a demo" pill.

### vercel.com
- **Monochrome only:** a ~#FAFAFA background, black type, and **zero accent colour**. The H1 is ~64px, weight ~500, with very tight tracking (est. -0.04em), on two lines.
- **Three-column hero:**
  - **Left:** the H1 and CTAs.
  - **Centre:** the logo mark inside a soft radial halo.
  - **Right:** three short plain lines.

  The CTAs are a black "Deploy now" pill and a white outlined pill. The nav has three small rectangular buttons, ~32px: "Get a Demo" and "Log In" outlined, "Sign Up" black.
- **Logos:** a row of 6 black logos across the bottom edge of the first fold, with no caption.
- **Case-study sections alternate sides.** Each has:
  - a ~52px H2
  - a real customer screen in a 1px bordered frame that **fades into the page at the bottom** (a mask, not a shadow)
  - a two-tone sentence
  - a grey "Features" label over a plain list of 4 links

### attio.com
- **Centred hero:**
  - An announcement pill with a chevron sits above the H1. The H1 is ~64px, weight ~600, tight, on one line.
  - A ~19px grey subhead runs two lines.
  - Two small rectangular buttons (~36px tall, ~6px radius): "Talk to sales" outlined, "Start for free" black.
- **Product shot:**
  - The real app sits in a macOS window with traffic lights, over a periwinkle-to-white wash with fine vertical pinstripes.
  - The composer is caught mid-typing with a caret ("How do I win my|", **seen**), with suggestion chips below it.
- **Blueprint frame:** visible 1px vertical rails run down the container edges. They also cut the logo grid into a 5×2 grid of hairline cells, and some cells carry a small ↗.
- **Feature section:**
  - **Left:** a sticky tab list. The active item is near-black with a 2px left bar, and the rest are pale grey.
  - **Right:** a two-tone statement, then a real data table: a checkbox column, companies with favicons and underlined links, **green numeric score pills** (98, 97…), owner avatars, and a side panel drafting an email.
  - Colour lives only inside the product.

### wellfound.com
- **Type:** the H1 is ~84px, weight ~700, black, with the second line in **italic brand pink** (~#E0336F). That one emphasis colour appears as italic accent words in every heading. Small notification chips float around the hero at slight angles ("Interview booked", "+3 replies").
- **Audience split:** two large rounded (~24px) cards side by side, a dark "For companies" card and a pale-pink "For candidates" card. Each has:
  - a tracked pink caps eyebrow (gate 67)
  - a ~40px heading
  - a pink pill CTA with an arrow
  - a list fragment at the bottom that looks live: "MATCHED TO YOU · TODAY" rows with role, company, city, pay and a "NEW" pill
- **Candidate search** is a sentence: "Show me [Software Engineer ▾] roles hiring in [San Francisco ▾] [Search]". The result card shows:
  - a company logo with a green-dot "Actively hiring"
  - small tags
  - a role row with a meta line
  - a "Save" outline button next to a black "View role" button
- **Rhythm:**
  - A dark full-bleed section pairs a big left heading with a right column of numbered items. Each item has a mono "01", a pink caps label, a bold ~20px head and a grey body, separated by hairline rules.
  - A 2×2 numbered benefit grid follows.

### joinhandshake.com
- **Hero:**
  - A full-bleed blurred mesh gradient, teal into olive, on near-black.
  - The display type is **ultra-condensed, heavy, all caps**, ~140px, white and centred, on two lines.
  - **One accent, acid lime** with dark text, is used on every CTA.
- **The hero CTA is a search.** A large white field (~88px tall, ~20px radius) has a search icon, a natural-language placeholder ("Entry-level AI training jobs using Python") and a square submit arrow. Four outline filter chips sit below it.
- **Nav on scroll:** it collapses into a floating white rounded bar, and the logo shrinks to a lime square mark.
- **Role grid:** 3×2 dark cards with 1px borders. Each has a ~20px white title, a grey pay line, and an eligibility list (degree levels).
  - **Employers row:** the label "● Employers hiring" (a lime dot) sits over a row of rounded monochrome logo tiles.
- **Feature:** a stack of job cards on a lime-to-cyan panel, with **one card lifted forward** over the rest. To its right sit a short "Get hired" head, a body line and a small lime button.

### rippling.com
- **Hero:**
  - The background is deep plum (~#4A0D3A to #7A2860), with a white H1 at ~48px semibold, tight.
  - **One accent, marigold (~#F9A21B)**, is used on every CTA, at ~4px radius: square, not pill.
  - The email field and its button are fused into one white bar, with privacy microcopy under it.
- **Social proof is third-party and attributed:** a G2 rating chip sits above the H1, and an awards row (stars, source, rating) sits under the CTA.
- **Product photo:** hands holding a tablet that shows the real dashboard, angled and cropped off the right edge.
- **Product grid** on warm off-white (~#F2EFEC), 3×2. Each item sits under a hairline top rule and has:
  - an 80px glossy rendered icon tile
  - a ~24px title
  - an arrow top-right
  - a grey body
  - a link with a **2px marigold underline**
- **Record panel:** a person record with a photo, name and role, then labelled rows (Employee ID, Base salary, Home address…) with icons in grey square tiles.

### cal.com
- **Type and colour:**
  - Monochrome: charcoal (~#242424) and greys on a ~#F4F4F4 page.
  - The display face is a heavy geometric grotesk with very tight tracking. The H1 is ~64px, left-aligned, on 3 lines.
- **Blueprint frame:**
  - Vertical page rails carry "+" crosshair marks where they meet horizontal rules.
  - The hero sits in a white rounded card inside the rails.
  - On scroll, the nav becomes a floating bordered white bar.
- **Product as hero:** a working booking widget with:
  - the host and event title
  - a **segmented duration control** (15m/30m/45m/1h)
  - a timezone picker
  - a month grid, where open days are grey tiles and the chosen day is dark

  Its CTAs are full-width stacked buttons (dark Google, light email) with a "No credit card required" line.
- **Section pattern:**
  - A small centred icon pill ("How it works") heads each section, followed by a ~48px H2, a grey subhead and a dark/light button pair with chevrons.
  - Next come 3 step cards numbered with **mono "01" chips**, each ending in a cropped real UI (availability toggles with times).
  - Last, a two-column bento of **real settings forms** with labelled selects.

### posthog.com (one view only; see "Capture gaps")
- **Motion (seen across frames):** the prompt types "Why are signup", then "…conversio|", then the full question, and the submit arrow turns orange once the field has content.
- **Desktop-OS conceit:**
  - illustrated grass wallpaper
  - labelled desktop icons in left and right columns
  - a top menu bar
  - the page itself shown as a window with close and maximise controls

  This is uniquely theirs.
- **Type:** the H1 is ~36px bold, with the key phrase on a **blue marker highlight**. The ~18px body has highlighter-yellow spans and a dotted-underline glossary term.
- **Buttons:**
  - Primary is orange (~#F1A82C) with a darker bottom edge, so it reads as a pressed key.
  - Secondary is white with the same orange edge.
  - A setup card lists its conditions as a checklist with green ticks.
- **Autoplay tabs:** the active tab is magenta, with a progress underline and a pause button. PostHog uses many accents (orange, magenta, blue, yellow). It is the deliberate exception on this board.

### resend.com
- **Type:** the display face is a high-contrast serif, ~96px, filled with a vertical gradient from white to grey, left-aligned on two lines. The body is sans, ~18px grey.
- **Hero object:** a rendered matte-black cube, with one light streak sweeping across the floor. The announcement pill has a thin multi-colour gradient border.
- **Buttons:** "Get started" is dark grey with a 1px lighter border. "Documentation" is text only.
- **Logos and container:**
  - The logo wall is 6×2, in white, under a centred two-line grey caption.
  - The container's top edge carries a **soft spotlight glow**.
  - A muted "Explore Enterprise >" link sits below.
- **"Integrate this morning" section:**
  - Only that phrase gets colour (an amber gradient).
  - A row of 13 icon tiles (~56px rounded squares) acts as a picker. The selected tile gets a brighter border and a white label.
  - Below, a code panel has framework tabs, line numbers, muted syntax colours and a copy button.

---

## 2. Patterns to borrow

**Global constraints on every row:**
- **Student app:** 320 to 430px wide, on low-end Android with paid data. No video, no 3D renders, no blur or backdrop filters, no autoplay loops.
- **Console:** dark, calm greys, and the one approved green, used only for "met / verified / primary".
- **Social proof:** any proof-shaped layout gets filled only with real, sourced data. Otherwise the section is cut. **Never copy:** logos, ratings, counts, or a "trusted by" wall built from employers whose jobs are in the feed.

### Public pages

| Hirelane page (route) | Pattern (reference) | Replicate exactly | Never copy |
|---|---|---|---|
| Public landing (`/`) | **Product-as-hero** (Linear) | Left-aligned H1, ≤2 lines, ~56-64px, tight tracking. One grey subhead line. Directly under it, a real Hirelane screen at container width (the console, or the student app in a phone frame) with a 1px border and ~12px radius, cropped by the fold. Populate it with the labelled sample student and drive. | Linear's UI, icons, glow and wording. Never a mock built from stock shapes. |
| Public landing (`/`) | **Two-tone statement** (Linear, Ramp, Vercel, Attio) | One ~40-48px paragraph. The first clause is in ink, the rest in ~55% grey. It replaces the usual H2 and paragraph pair, used once per page. | Their sentences. Gradient text. |
| Public landing (`/`) | **Audience split cards** (Wellfound) | Two equal cards, "For students" and "For placement cells". Each has a ~32-40px head, one line of body and one CTA, and ends in a real fragment flush to the card's bottom edge: one Picks row, or one console row. | Pink italics. The rotated floating chips with shadows. The nested inner card (card in card). The tracked caps eyebrow (gate 67). "Find your next job". |
| Public landing (`/`) | **Numbered step cards with cropped UI** (Cal.com) | Three cards, each numbered with a small mono "01/02/03" chip in a grey square. A ~20px title and two grey lines, then a real UI crop (for example the eligibility check with ✓ ~ ✕) cut off at the card edge. | Their scheduling UI and copy. Calendar provider icons. |
| Public landing (`/`) | **Proof strip layout** (Ramp ticker, Attio cell grid) | Hairline-bordered cells or a one-line strip of small bordered chips, used only for numbers our pipeline really produces: jobs checked today, with a source line and "updated HH:MM". Leave it out until it is wired. | Logos, ratings, invented counts, odometer animation on fake numbers. |
| For students (`/students`) | **Search as the CTA** (Handshake) | One large field: ~64px on mobile, ~80px on desktop, ~16-20px radius. The placeholder is a natural-language query a fresher would type (role, city, degree). A square submit button. 3-4 outline chips below that map to real filters (Fresher, Work from home, Internship). | The condensed caps display face, the mesh gradient, the lime, "LET'S FIND YOUR NEXT JOB", the 1M+ claim. |
| For students (`/students`) | **Role grid card anatomy** (Handshake) | 2-3 columns of 1px-bordered cards. A ~18-20px title, a grey pay line in LPA (or "Pay not stated" when it is unknown), and an eligibility line. These are the only coloured surfaces, as a flat tint per role card. Taken from the live feed, with a freshness line. | "Up to $X/hr", their roles, logos as decoration. Meta joined with middle dots (gate 63): stack the lines instead. |
| For universities (`/colleges`) | **Intent picker** (Deel) | "What does your placement cell need?", with 3-4 tiles (for example: Track off-campus offers, Run drives, Report outcomes). Each tile jumps to its own section. Tiles ~120×80px, 1px border, icon on top, 14px label. | The violet gradient panel. The photo with floating chips. Deel's tile labels. |
| For universities (`/colleges`) | **Accordion and live panel** (Mercury) | Left: a ~24px head, then a 4-item accordion with hairline rules; the active item has a small green dot and an expanded two-line body. Right: an enlarged console panel that swaps per item. Run it on the dark console surface. | The frosted-glass input, the hillside photo, the indigo, the camera-zoom scroll effect (too heavy). |
| For universities (`/colleges`) | **Record panel** (Rippling) | One student record as the placement cell sees it at each share level: labelled rows with 16px icons in ~32px grey square tiles, label left, value right. This answers "what each level shows" (screen audit). | The plum, the glossy 3D icons, the G2 and awards badges, a real person's photo. |
| Pricing or pilot (no route yet; nearest is `/contact`) | **Setup card with conditions** (PostHog, Cal.com) | One bordered card. Up to 3 ticked lines stating only what is actually committed for a pilot. A full-width primary and a secondary stacked below (Cal.com), and one grey microcopy line under them. | PostHog's 3D orange keys, its humour and "97% pay $0". Cal's "No credit card required" unless it is true. |
| Pricing or pilot (no route yet) | **Item list with hairline top rule** (Rippling) | 3-across items (pilot steps or FAQs), each under a 1px top rule, with a ~20px title, an arrow top-right, a grey body, and a text link with a 2px underline in the one accent. | The 3D icon tiles, the marigold, "Get a demo" on every item. |

### Student app

| Hirelane page (route) | Pattern (reference) | Replicate exactly | Never copy |
|---|---|---|---|
| Student home (`/home`) | **"Matched to you, today" list** (Wellfound) | A small sentence-case header with an honest count ("N new since yesterday"). Below it, 2-4 rows, each with the role in bold (14-15px), company and city on the second line, and a small ink-outline "New" pill right (no hue; see the open status-colour decision). Rows are separated by hairlines. | Tracked caps (gate 67), the pink and its tinted "NEW" pill, middle-dot meta (gate 63). |
| Student home (`/home`) | **Timestamped activity feed** (Linear) | A muted grey 13px row per event (applied, reply, round date), each with a 14px icon and a relative time right-aligned. No cards, just hairlines. | Linear's icons, its "via Slack" phrasing. |
| Picks / swipe (`/picks`, `/pick/[id]`) | **Lifted card in a stack** (Handshake feature) | The top role card sits forward; the next 1-2 sit behind, offset 8-12px down and scaled ~0.96. Depth comes from offset and scale, not shadow. The role card is the one coloured surface (flat tint). Every gesture has a visible button below the stack. | The lime-to-cyan gradient, resting shadows, their company names. |
| Picks / swipe (`/pick/[id]`) | **Numeric score pill** (Attio) | Rule matches as a small chip, ~22px tall with tabular figures ("N of M rules met"): filled ink when all are met, outline otherwise. Each rule inside shows ✓ ~ ✕ glyphs in ink and grey, no hue. Tap it to open the maths. | A 0-100 "fit score" with no maths behind it. Attio's green and blue. |
| Job detail (`/job/[slug]`) | **Main column and properties rail** (Linear issue view) | On desktop: a main column (title ~24px, description, activity) plus a right rail of label/value rows (Pay, Location, Eligibility, Last date, Source, Checked at): 12px grey labels, 14px values, 16px icons. On mobile the rail becomes a stacked block under the title. | Linear's iconography and its yellow status ring. |
| Job detail (`/job/[slug]`) | **Paired actions and a freshness dot** (Wellfound result card) | "Save" outline and a primary filled button, side by side, 44px tall on mobile. A dated freshness line in 13px grey, no coloured dot ("Posting checked Xh ago, source: company site"). | "Actively hiring" unless it is sourced. Their green dot, pink and black. |
| Discover / jobs (`/jobs`) | **Sentence filter** (Wellfound) | "Show me [role ▾] jobs in [city ▾] for [degree ▾]". Each blank is a native select, so it works on low-end Android, and the sentence wraps over 2-3 lines at 320px. | "roles hiring in San Francisco", their Search button styling. |
| Discover / jobs (`/jobs`) | **Chip row under search** (Handshake) | 1px outline chips, ~36-40px tall, on one horizontally scrolling line; the selected chip is filled in ink. | The translucent chips over a gradient. |
| Tracker / inbox (`/tracker`) | **Status pill shape** (Deel) | Deel's small pill shape (~20px tall, 12px text) without its hues: Offer as filled ink, Interview as an ink outline, Applied as a grey outline, "Quiet N days" as grey text with no pill. Order by weight, not colour, unless the owner approves a status hue. | Uppercase tracked pill text (gate 67), Deel's tinted colours, flags and avatar stacks. |
| Tracker / inbox (`/tracker`) | **Record pager** (Linear "1 / 84 ↑ ↓") | In the application detail, an "N / M" counter with up/down buttons to step through applications without going back to the list. | Linear's keyboard-only affordances: every step needs a tap target. |
| Resume (`/resume`) | **Source picker tiles** (Resend SDK row) | A row of 3 tiles, ~64px rounded squares, for Upload PDF, LinkedIn ZIP and Build. The selected tile gets a brighter 1px border and a darker label. | The rendered icons, the gradient border, the code panel. |
| Resume (`/resume`) | **Labelled settings form** (Cal.com bento) | Labels above fields at 13px. Paired fields (10th %, 12th %) in two columns at 360px and up. A segmented control for the CGPA scale (10 / 4 / %) styled like Cal.com's 15m/30m/45m. | Form-inside-card-inside-card nesting. Cal's soft drop shadow. |
| Resume (`/resume`) | **Checklist with ticks** (PostHog setup card) | Resume health as a short checked list: ✓ passed, ~ fix, ✕ missing. Each item names its action ("Add your CGPA scale"). | The orange 3D buttons, the humour, the highlighter spans. |
| Me (`/you`) | **Record panel rows** (Rippling) | Labelled rows (Degree, College, CGPA scale, Share level, Notifications), each with a 16px icon in a 32px grey tile, a value in grey and a chevron, and each opening its own setting. | A photo-led profile header, the plum, salary-style fields. |
| Me (`/you`) | **Plain link list under a grey label** (Vercel "Features") | A 12px grey group label over 3-5 plain 15px links; no cards, no icons. Use it for Privacy, Help and Sign out. | Vercel's words. |

### Admin console

| Hirelane page (route) | Pattern (reference) | Replicate exactly | Never copy |
|---|---|---|---|
| Console overview (`/campus`) | **Monochrome app chrome** (Linear) | A ~240px sidebar: 14px items, 16px icons, small grey group labels with a caret. The main area is made of hairline-separated panels. One filled button per view. Colour only for status, in the one green. | Linear's logo, sidebar items and icon set. |
| Console overview (`/campus`) | **Greeting, action row and cards** (Mercury dashboard, seen in frame 1) | A "Good morning" head at ~22px. Below it, a row of small pill actions (Add drive, Import roster, Share recap), one wide primary panel, and a row of 3 small panels (Drives open, Offers to verify, Students joined). | Mercury's balances and chart shape. Invented values: every number comes from data with its base stated. |
| Console overview (`/campus`) | **Today strip** (Ramp ticker) | One line of small bordered chips with today's real counts ("Applications today N"), each with a label. Tabular figures; no animation unless the value really changes. | The odometer roll on static data, tracked caps (gate 67). |
| Students (`/campus/students`) | **Data table with score chips** (Attio) | A sticky header row; a checkbox column; the name as an underlined link; initials avatars; numeric chips green only when the rule is met. Clicking a row opens a right side panel, not a new page. A left sticky list of saved views (All, Not placed, Eligible for a drive), the active one with a 2px left bar. | Attio's blue, its macOS window frame, its favicons. Any visible cell under 10 (k ≥ 10). |
| Drives (`/campus/drives`) | **List, issue view and properties rail** (Linear) | A list of drives; opening one shows the main column (JD, rounds, activity) and a right rail (Company, CTC as stated, Eligibility rule with its source URL and date checked, Last date, Status), plus the "N / M ↑ ↓" pager. | Linear's statuses and wording. |
| Drives (`/campus/drives`) | **Tinted status pills** (Deel) | Draft (grey), Published (green tint), Closed (grey outline). Two hues at most. | Deel's ONBOARDING/PENDING colours and caps. |
| Add drive (no route yet; a panel or step inside `/campus/drives`) | **Parser state with handles** (Ramp "ANALYZING RECEIPT") | While the JD is parsed, show "Reading the JD…" with fields filling in one by one. Every parsed field gets a small "check" marker until a person confirms it. The corner-node dots are fine as a selection cue on the field being filled. | Ramp's receipt, its card art and its warm canvas. An invented CTC split: leave fixed and variable empty (screen audit). |
| Add drive (no route yet) | **Labelled selects and a segmented control** (Cal.com) | Labels above, paired fields side by side (min 10th %, min 12th %), and a segmented control for Mode (On campus / Virtual / Off campus) styled like 15m/30m/45m. | Cal's shadows, nested cards, scheduling copy. |
| Outcomes (`/campus/outcomes`) | **Right-aligned figures** (Mercury accounts panel) | Label left, figure right, in tabular figures. A hairline between rows. One line under the panel stating the base ("Base: N students who joined, not placed on campus"). | Superscript cents (LPA needs none), the indigo, the scripted cursor. |
| Outcomes (`/campus/outcomes`) | **Figure captions in mono** (Linear "FIG 0.1") | Each chart gets a 12px mono caption: "Fig 1. Offers by branch". The source and date go on the line below in grey. Mono is used only here. | Linear's isometric drawings. |
| Outcomes (`/campus/outcomes`) | **Two-tone head and report link** (Ramp) | A ~28px head, its first clause in near-white and the rest in grey, then a text link "Download the report →" for the export. | Ramp's "85,000 companies growing 3.2x" style claim. |
| Settings (`/campus/settings`) | **Sticky section list** (Attio feature tabs) | A left list of sections (Profile, Staff, Share levels, Cohorts, Rules); the active one is near-white with a 2px green left bar and the rest are grey. On the right, form groups separated by hairlines. | Attio's tab wording, its pinstripe wash. |
| Settings (`/campus/settings`) | **Segmented control** (Cal.com) | Share level as a 3-way segmented control. Under it, a live preview row (the Rippling-style record panel) shows exactly what each level reveals. | Cal's light theme. Rippling's plum. |

---

## 3. Anti-slop checklist

Each line contrasts these 12 references with typical AI-generated pages.

- [ ] **One accent per surface**, used only on the primary action or for status (Linear, Vercel, Ramp, Rippling, Handshake, Mercury). Everything else is grey.
- [ ] **Show the real product:** our screens, with labelled sample data. Never an icon-in-a-rounded-square grid of three to six features with matching blurbs. Rippling is the only reference with an icon grid, and its icons are bespoke 3D renders.
- [ ] **The H1 fits on ≤2 lines with tight negative tracking**, at weight 500-600 rather than 800 everywhere. Section heads are smaller than the H1.
- [ ] **Use a two-tone statement**, ink then grey, once per page, instead of yet another H2 and centred paragraph.
- [ ] **Separate with 1px hairlines and rules, not shadows.** No glow, no glass, no blur behind cards.
- [ ] **Give each section a different structure:** split, rail list, table, numbered steps. Never a repeated stack of a centred badge, H1, paragraph, two buttons and three cards.
- [ ] **Keep buttons small and exact:** ~32-40px on desktop marketing pages, 44px+ in the app. One filled, one outline or text. No gradient pills.
- [ ] **Product crops run off an edge or fade out under a mask.** No floating screenshots with big shadows and a tilt.
- [ ] **Use specific nouns and real numbers with their source and date.** Never "unlock", "seamless", "empower", "supercharge", or "10,000+ happy users".
- [ ] **Social proof must be real and attributed, or left out.** No placeholder logo walls, star rows or testimonial carousels.
- [ ] **Status pills are small and tinted, with same-hue text, three hues at most.** No rainbow tag clouds.
- [ ] **Use mono only for indices and captions** (01, Fig 1), never for body text or labels everywhere.
- [ ] **Motion is tied to real state:** typing in a field, a counter that really changes, a card that moves on a gesture. No fade-up on every section, no drifting blobs. Everything respects reduced motion.
- [ ] **Numbers use tabular figures, right-aligned in tables**, with the base stated.
- [ ] **Show the grid:** container rails, cell borders or a column rule (Attio, Cal.com, Linear, Ramp). Not a soft centred blob layout.
- [ ] **No emoji as icons. No purple-to-blue gradient. No browser-window chrome drawn around screenshots.**
