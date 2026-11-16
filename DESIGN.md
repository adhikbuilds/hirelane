# Design: Hirelane

**Last updated:** 2026-10-31
**Status:** this is the rule. Hallmark and every UI run read this first. Change it on purpose.
**Replaces:** the 2026-10-28 "Wrapped stories" lock (loud lime, pink, sun, coral and blue blocks, weight-800 display type, big pill buttons). That direction is retired everywhere except the approved sign-in and onboarding screens, which keep their captured look (see Surfaces).

**Sources**
- `docs/design/reference-board.md`: 12 startup sites, about 40 patterns, the 16-point anti-slop checklist
- `docs/design/website-dashboards-plan.md`: page map, type scale, console component inventory, suppression rules
- `docs/design/refs/*.png`: the reference captures
- Approved captures: `docs/screens/main-landing-1440.png`, `docs/screens/auth-1-signin-1440.png`, `docs/screens/campus-console-1440.png`, plus `front-1440.png` (calm front page) and `home-a-1440.png` (student direction A)
- Live token values: `apps/web/app/campus.css` (`--cp-*` light and `[data-theme="console-dark"]`)

---

## 1. Owner verdicts

**Approved (keep, extend, do not redesign)**
- **Dark analytics placement console** (`campus-console-1440.png`):
  - one big hero number
  - a breakdown list
  - a weekly chart
  - a totals row
  - a thin stacked bar
  - a table with a segmented toggle
  - Every chart drives a decision. The model is "Applications and replies per week" next to an **Act this week** list, where each row has a count, one sentence and one action button.
- **Student app, direction A** (`home-a-1440.png`): calm chrome on paper, with colour only on the role card.
- **Calm public front page** (`front-1440.png`): paper, ink, navy, and one green accent.
- **Sign-in and onboarding** (`auth-*`): approved as captured.
- **Landing hero built from designed motion** that uses real components, not demo screenshots.

**Rejected (never ship again)**
- Multi-colour pages: more than one saturated hue in view at once, outside a role card.
- Thick bar funnels: tall solid bars per stage, as in the front-page console thumbnail.
- The 2x3 stage grid: funnel stages laid out as six tiles.
- Small floating recap cards, and mini-cards overlapping a screenshot.
- Any time-cost copy: "about N minutes", "in under a minute", "a 20-minute call", "fix it in minutes", "three quick checks".
- The old student Home (`home-sample-1440.png`): colour-block tiles, streak flame, "Play your recap", big pills.

**Rules**
1. Greys plus one accent. The accent is green (`--accent`). Navy is the primary ink, not a second accent.
2. Headings use weight 500-600 and body uses 400. Nothing above 600 outside the approved auth screens.
3. Every funnel stage gets an action button. A stage with nothing to do still shows why ("No offers to verify").
4. Destructive actions are tucked away: in Settings, behind a menu, never on a first-run screen, never the primary.
5. Role cards create the urge to apply by showing company, pay, fit, who you know and freshness.
6. Never invent prices. Pay is shown only as stated by the source, otherwise "Pay not stated". No product prices appear on the public site until the owner decides them.

---

## 2. Surfaces

Set on the shell with `data-surface="site|app|console|auth"`. Theme with `data-theme="light|dark"`.

| Surface | Register | Theme | Saturated colour allowed |
|---|---|---|---|
| Public site | Calm, typographic: paper, ink, navy, green | light; one dark band per page (console tokens) | none outside the green accent |
| Student app | Direction A: calm chrome, hairline rows | light (dark tokens exist, not yet shipped) | role card fill only |
| Placement console | Dark analytics | dark default, light available | green accent for met, verified, replies and primary series |
| Sign-in and onboarding | As captured: night background, cream tilted card, lime block | fixed | lime, scoped to these screens |

New screens never borrow from the auth surface. New onboarding steps reuse the auth components unchanged.

---

## 3. Tokens

All tokens live in one Tailwind v4 `@theme` block in `apps/web/app/globals.css`. They replace the dark-green v3 values, the shadcn `@theme inline` duplicates and, once migrated, the `--cp-*` names in `campus.css`. The hex values below are the ones already shipping in the approved console and front page.

Contrast: text needs at least 4.5:1 on its own background, and UI edges and focus rings need 3:1. Re-measure every pair when a value changes.

### 3.1 Colour: neutrals and accent

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | #F5F6F8 | #0E1013 | page background |
| `--surface` | #FCFCFD | #15181D | panels, sidebar, inputs (a surface step, not a shadow) |
| `--raised` | #EEF0F3 | #1D222B | hover rows, active nav item, selected segment |
| `--ink` | #14161B | #EEF0F4 | primary text, headings, hero number |
| `--ink-2` | #5B6270 | #8B93A3 | secondary text, captions, axis labels, "Updated" lines |
| `--ink-3` | #9AA1AE | #5B6270 | non-text only: disabled glyphs, ticks, empty bar tracks. Never body text. |
| `--line` | #E3E6EB | #262A31 | 1px hairlines, panel borders, row rules |
| `--line-strong` | #C9CED6 | #3A3F48 | input borders, table head rule, outline buttons |
| `--navy` | #1B2A4A | #EEF0F4 | primary button fill (the dark theme inverts to a light fill) |
| `--on-navy` | #F2F4F8 | #0E1013 | text on the primary button. No pure #FFF text. |
| `--accent` | #0F5C45 | #3CCF8E | the one accent: ✓ met, verified, replies series, wordmark "lane", step numbers, active 2px bars |
| `--accent-soft` | #E3F1EA | #12301F | background of a met or verified chip (text in `--accent`) |
| `--danger` | #B42318 | #F87171 | errors, scam flags, failed rule ✕ text. Functional only, never decoration. |
| `--danger-soft` | #FBE9E7 | #3A1717 | error field and scam banner background |
| `--focus` | #1B2A4A | #EEF0F4 | 2px focus ring, 2px offset |

There is no warning hue. "Couldn't check" and deadlines use the `~` glyph and `--ink-2`. Owner check: the console's legacy `--cp-warn` amber is retired with this file.

### 3.2 Colour: data series (console and the site's dark band)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--series-base` | #1B2A4A | #C9CED6 | the volume series (applications), the hero stacked-bar segment |
| `--series-accent` | #0F5C45 | #3CCF8E | the outcome series (replies, met, verified). At most one per chart. |
| `--series-2` | #5B6270 | #8B93A3 | a third series or segment |
| `--series-3` | #9AA1AE | #5B6270 | a fourth segment, "other" or "combined" |
| `--series-track` | #ECEEF2 | #22262D | bar tracks, inline-bar background |
| `--series-hatch` | #C9CED6 | #3A3F48 | suppressed bucket ("under 10"), drawn as a hatched gap |

A chart uses greys plus the accent. Never four hues. Every series also has a label and a fixed order, so colour is never the only cue.

### 3.3 Colour: role-card fills (student app only)

The only saturated colour in the student app. One card fill is in view at a time; cards behind it in the stack show only an edge.

| Token | Hex | Text on it |
|---|---|---|
| `--card-lime` | #C8FF3D | `--ink` #14161B |
| `--card-sun` | #FFC83D | `--ink` #14161B |
| `--card-blue` | #3D5AFE | #FFF6E8 |
| `--card-pink` | #FF4FA3 | #14161B |

Cards rotate through lime, sun, blue and pink. Inner blocks on a card (pay, verdict) are `--ink` fills with light text, as in `home-a`.

### 3.4 Colour: auth (scoped, approved as captured)

`--auth-night` #141418, `--auth-cream` #FFF6E8, `--auth-lime` #C8FF3D, `--auth-ink` #0B0B0F. These are used only under `data-surface="auth"`.

### 3.5 Type

**Faces (Default until owner decides, decision 6):** Geist Sans for all text on the site, app and console. Geist Mono only for identifiers: campus codes, the apply address, receipt hashes, CSV column names, and "Fig 1" chart captions. Load once with `next/font` in `app/layout.tsx`, Latin subset plus ₹ (U+20B9), `display: swap`. Overpass and Public Sans are removed. Bricolage stays on the auth screens only.

**Rules**
- Headings use 500-600. Body uses 400, and labels and buttons use 500. Never 700 or 800.
- `font-variant-numeric: tabular-nums` on every number in tables, totals, charts and countdowns.
- `text-wrap: balance` on headings and `pretty` on paragraphs. No orphaned word in an H1 at 390, 1024 or 1440.
- At most five sizes per surface. Sizes are written desktop / phone and set with `clamp()` between 390 and 1440.
- Real ₹, en dashes in ranges ("2025–26"), curly apostrophes.

**Public site**

| Token | Size | Line height | Weight | Tracking | Use |
|---|---|---|---|---|---|
| `--text-display` | 64 / 40 | 1.02 | 600 | -0.035em | hero H1 only, at most 2 lines |
| `--text-title` | 40 / 30 | 1.08 | 600 | -0.025em | section H2, at most 2 lines; the two-tone statement |
| `--text-lede` | 20 / 18 | 1.5 | 400 | -0.005em | hero subhead, section intro; H3 at 600 |
| `--text-body` | 16 | 1.6 | 400 | 0 | paragraphs, FAQ, nav |
| `--text-small` | 13 | 1.45 | 500 | 0.005em | captions, "Updated" lines, footnotes |

**Student app**

| Token | Size | Line height | Weight | Use |
|---|---|---|---|---|
| `--text-app-title` | 28 / 24 | 1.15 | 600 | greeting, page title |
| `--text-app-role` | 26 / 22 | 1.1 | 600, -0.02em | role title on the card |
| `--text-body` | 16 | 1.5 | 400 / 500 | rows, buttons (500) |
| `--text-app-meta` | 14 | 1.45 | 400 | row second lines |
| `--text-small` | 13 | 1.45 | 500 | captions, freshness |

**Console**

| Token | Size | Line height | Weight | Use |
|---|---|---|---|---|
| `--text-hero-metric` | 96 / 64 | 1.0 | 600, -0.04em | one hero number per page |
| `--text-console-title` | 24 | 1.2 | 600 | page title (cohort name) |
| `--text-console-h` | 16 | 1.4 | 600 | section heads ("Act this week", "Totals") |
| `--text-console-body` | 14 | 1.5 | 400 / 500 | tables, lists, buttons |
| `--text-small` | 12 | 1.4 | 500 | axis labels, legends, base lines |

Totals-row figures use `--text-console-title` at 600, in tabular figures.

### 3.6 Spacing and grid

- **Base unit:** 4px. The scale is `--space-1..10` = 4, 8, 12, 16, 24, 32, 48, 64, 96, 128.
- **Site:** max width 1120px, 12 columns, 24px gutters. Side margins are 32px at 1024 and up, 24px at 640-1023, and 20px under 640. Phones use 4 columns.
- **Site rhythm:** 120px between sections on laptop and 64px on phone. Heading to body is 16px, and body to media is 48px.
- **App:** content max 1040px.
  - Laptop: a 240px left rail at full height.
  - Phone: a 64px bottom tab bar with labels always shown and safe-area padding.
- **Console:**
  - Laptop: a 240px sidebar at full height (fixes the 900px cut-off in the capture), content padding 32px, and 24px between panels.
  - Phone: a top bar plus a full-height menu sheet. Never stack the sidebar above the content.
- **Widths:** must work at 320, 360, 390 and 430px, with `overflow-x: clip` on html and body.
- **Grid lines:** every edge (text column, image, rule) lands on a column line.

### 3.7 Radii

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 6px | chips, segmented-control segments, small tags |
| `--radius-control` | 8px | buttons, inputs, selects |
| `--radius-panel` | 12px | panels, tables, the Act this week list, product-moment frames |
| `--radius-card` | 18px | role cards only |
| `--radius-phone` | 28px | bare phone-screen captures |
| `--radius-pill` | 999px | status pills and avatars only. Buttons are never pills. |

One radius per element type. If a page shows two different panel radii, that is a bug.

### 3.8 Elevation

| Level | How | Use |
|---|---|---|
| 0 | none | page content |
| 1 | `--surface` on `--paper`, plus a 1px `--line` border | panels, tables, inputs |
| 2 | level 1 plus `--shadow-pop` | menus, popovers, tooltips, sheets, dialogs only |

- Light `--shadow-pop`: `0 1px 2px rgb(20 22 27 / 0.06), 0 8px 24px rgb(20 22 27 / 0.10)`.
- Dark `--shadow-pop`: `0 1px 0 rgb(255 255 255 / 0.04) inset, 0 12px 32px rgb(0 0 0 / 0.50)`.
- No resting shadows. Depth comes from surface steps and hairlines. In the deck, depth comes from an 8-12px offset and a 0.96 scale on the cards behind.

### 3.9 Motion

| Token | Value | Use |
|---|---|---|
| `--dur-state` | 120ms | hover, press, toggle, tooltip, stamp scale |
| `--dur-enter` | 200ms | toast, sheet, menu, row reveal |
| `--dur-exit` | 160ms | menu or sheet close |
| `--dur-card` | 280ms | card exit after a swipe |
| `--dur-story` | 600-900ms per beat | the landing motion sequence only |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | enters, card release |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | exits |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | state changes |

- Animate `transform` and `opacity` only. Never `transition: all`. CSS first, with no animation library on the site.
- Motion must reflect a real state change: a card moving on a gesture, typing in a field, a value that really changed. Never count-ups, marquees, scroll-jacking, drifting blobs, or a fade-up on every section. Delete `ui/CountUp.tsx` and `ui/Marquee.tsx`.
- One scroll effect is allowed: media fades up 8px once via `animation-timeline: view()`, and content is fully visible without it.
- **Swipe:** the card follows the finger 1:1. On release it takes `--dur-card` with `--ease-out`. The "Applied" stamp goes from scale 1.08 to 1 over 120ms. The undo bar slides up over 200ms and lasts 4 seconds.
- **Console:** the chart crosshair follows the pointer with no transition. The tooltip fades over 120ms. Toggle-table rows cross-fade over 120ms.
- **Reduced motion:** under `prefers-reduced-motion` every duration is 0. The landing sequence shows its final frame as a static composition, and the toast still appears.

---

## 4. Component rules

### 4.1 Buttons
- **Primary:** `--navy` fill, `--on-navy` text, weight 500, `--radius-control`.
  - Height: 40px on desktop site pages, 44px in the app and console, 48px on phones.
  - One per screen: one per viewport-height section, at most two per page, never both in view.
- **Secondary:** a 1px `--line-strong` outline on `--surface`, with the same height and radius. Or a text link with an SVG arrow.
- **Row action:** a secondary button at 32-36px tall inside lists ("Remind them", "Verify offers"). On phones it grows to 44px.
- **Header "Sign in":** a text link, never a second primary.
- **States:**
  - hover: the fill shifts 6% toward ink
  - `:active`: `translateY(1px)`
  - `:focus-visible`: a 2px `--focus` ring with a 2px offset, shown instantly
  - disabled: 40% opacity, with the reason underneath
  - loading: keeps its width
- **Destructive:** a `danger-text` style only (red text, no fill). It lives in Settings or an overflow menu, asks for confirmation, and is never on a first-run screen or in a primary slot. Prefer "record a reason" over "reject".

### 4.2 Inputs and forms
- Labels are always visible above the field, in 13px weight 500. Placeholders are examples, never labels.
- Fields are 44px tall, with a `--line-strong` border, `--surface` fill and `--radius-control`.
- Errors use a `--danger` border plus a message below. Never colour alone.
- Paired fields (10th %, 12th %) sit in two columns at 360px and up.
- Segmented controls hold 2-4 options. The selected segment is `--raised` with `--ink` text.

### 4.3 Status and chips
- **Console:** a met or verified state uses `--accent-soft` with `--accent` text. Errors use the danger pair. Everything else is grey.
- **Student app:** status is grey (see Open decisions). Offer is a filled `--ink` pill, Interview is an ink outline, Applied is a grey outline, and "Quiet N days" is plain `--ink-2` text.
- Rule results use the glyphs ✓ ~ ✕ in ink and grey, plus words.
- Chips are about 22px tall with 12px weight-500 text. Sentence case.

### 4.4 Role card (student app)
The one coloured surface. Its job is to make the student want to apply, using only true data. The fields go in this order:
1. **Company:** logo or initial, name, and a one-line "what they do".
2. **Role title:** `--text-app-role`.
3. **Pay** in an ink block, exactly as the source states it ("₹3.6 LPA"), with one derived line ("about ₹30,000 a month before tax"). If the source states no pay, show "Pay not stated". Never estimate, never show a range the source did not give.
4. **Fit:** the verdict line ("You qualify: 3 of 3 rules") and must-haves ("4 of 5"). Tap it to open the maths.
5. **Who you know:** "Aman K. works here (Senior Support Engineer)", from the student's own connections only.
6. **Freshness:** "Posted 2h ago" and the source, from real timestamps.
7. **Lines, not dots:** location and shift go on their own chips or lines.

The card has a 1px ink border, `--radius-card` and no shadow. Every gesture has a visible button below the deck (skip, save, apply), with keyboard support (arrows and Space, no single-letter globals) and a 4-second undo.

### 4.5 Student app chrome (direction A)
- **Surfaces:** `--paper` page, `--surface` panels, hairline-separated rows with a chevron, and a right-aligned grey action label.
- **Header:** greeting at `--text-app-title`, then one honest count line ("3 new roles you qualify for since yesterday") with the count in `--accent`.
- **Hooks:**
  - No streaks, flames, badges, recaps-as-tiles, "N others applied" or fake scarcity.
  - Weekly progress is one row ("4 applied this week, 1 reply"), never a recap card.
- **Destructive actions:** "Delete your account" lives at `/settings`, under Account.

### 4.6 Console analytics
Every chart answers "what should I do this week?". A chart without a next action next to it gets cut.
- **Page header:**
  - cohort switcher as the title
  - "Updated {time}"
  - a base line ("Base: N students who joined")
  - one primary and at most one secondary action
- **HeroMetric:** one per page. The number goes at `--text-hero-metric`, followed by a sentence and its base ("from 268 students who joined").
- **BreakdownList:**
  - Rows have a series dot, a label, a count note, a value and a share, and each share names its base.
  - A suppressed row merges into "combined".
  - A hidden count also hides its share.
- **Weekly chart: applications vs replies.**
  - Bars use `--series-base` and `--series-accent`, at 3 gridlines.
  - A one-line takeaway goes under the title ("Replies are 18% of applications this week, up from 7% in August").
  - Weeks under 10 are drawn as a hatched gap labelled "under 10".
  - An area chart is the alternative for a single series: an accent line with 12% fill.
- **Act this week:**
  - Up to 4 ruled rows in one `--radius-panel` panel.
  - Each row has a tabular count, one sentence and one row-action button ("82 eligible students haven't applied to Process Associate, closing Saturday", then "Remind them").
  - It sits directly beside or under the chart it explains.
- **TotalsRow (the funnel):**
  - Six columns on one rule: Joined, Resume ready, Eligible, Applied, Interview, Offer.
  - Each column has a label, a figure and **an action** ("Invite the other 48", "Run a resume clinic", "See blocking cutoffs", "Send a reminder", "Book a prep session", "Verify 9 offers").
  - Never thick bars, never a 2x3 grid of stage tiles.
- **StackedBar ("Where students stop"):**
  - One bar, 10px tall, at `--radius-sm`.
  - The legend gives each count and share.
  - Greys plus the accent on the segment the next action targets.
- **ToggleTable:**
  - A segmented toggle (Programme, Blocker, Drive), then a table with a 2px inline bar under each label.
  - Figures are right-aligned and tabular.
- **PrivacyNote:** a shield icon and a sentence about totals only, on every aggregate page.
- **Suppression:**
  - No count under 10 appears anywhere: rows, legends, tooltips, exports.
  - A hidden count hides its share.
  - Complementary suppression applies.
  - Weekly buckets are treated as k-bound until decision 4.

### 4.7 Public site
- **Header:** the wordmark ("hire" in ink, "lane" in `--accent`), four text links, and "Sign in" as a text link.
- **Hero:**
  - H1 left-aligned at `--text-display`, one `--text-lede` line, one primary (navy) plus one secondary or audience pair.
  - Beside or under it sits the **landing motion sequence**: real, server-rendered components (role card, then the rule check filling in ✓ ✓ ✓, then the "Applied" stamp, then a reply row in the tracker).
  - The sequence plays once on view with `--dur-story` beats and has a replay control. It is static under reduced motion.
  - No PNG of a dev page, no drawn browser or phone bezel, no floating mini-cards.
- **Sections:** each uses a different structure: split with a form, ruled numbered steps (a 2px navy top rule, a green step number), the dark band (console tokens), a FAQ in `<details>`. Never a repeated badge, H2, paragraph and three-card stack.
- **Two-tone statement:** once per page. The first clause is `--ink` and the rest `--ink-2`.
- **Product moments:** labelled "Sample student" or "Sample cohort" with a caption line, never a dashed banner.
- **Live counts:** come from the DB with "Updated {date}", hidden when a query fails or falls below the owner's floor. Never typed into copy.
- **No proof without permission:** no logos, testimonials, ratings or "trusted by" rows until real ones exist in writing.

### 4.8 Icons and imagery
- **Icons:** SVG only, 16px in the console and 20px in the app, at a 1.5px stroke, with `aria-hidden` or a label. No emoji as icons.
- **Photos:** none on product surfaces. Company logos fall back to an initial.

---

## 5. Copy rules
- Headings are 8 words or fewer and make one specific claim. Sentence case.
- **No time-cost copy.** Functional limits stay because users act on them ("the code works for 10 minutes", "deleted within 24 hours").
- **Never invent:** prices, pay, stats, counts or testimonials. Every number carries its source or an "Updated" date and its base.
- No "unlock", "seamless", "empower", "supercharge", "powerful".
- **Apply copy matches the pilot flag.** Pre-pilot copy says the answers are ready on the company's form and the student presses submit (plan 0.1).
- **Meta:** commas or stacked lines (see Open decisions).

---

## 6. Anti-slop checklist

Run it on every screen before review. Each line is a pass or fail.

- [ ] **One accent per surface** (green), used only for the primary signal or status. Everything else is grey or navy. Role cards are the only exception, in the app.
- [ ] **Real product, not icons:** our components with labelled sample data. No grid of three to six icon tiles with matching blurbs.
- [ ] **H1 on two lines at most,** weight 500-600, tight tracking. Section heads are smaller than the H1.
- [ ] **One two-tone statement** (ink, then grey) per page at most, instead of another H2 and centred paragraph.
- [ ] **Hairlines and surface steps, not shadows.** No glow, glass or blur. Shadows only on menus, sheets and dialogs.
- [ ] **Each section has its own structure:** split, ruled list, table, numbered steps.
- [ ] **Buttons are small and exact:** 40px on the site, 44px in the app, rectangular at 8px radius. One filled, one outline or text. No gradient or giant pills.
- [ ] **Product moments run off an edge or fade under a mask.** No tilted floating screenshots, no small floating recap cards.
- [ ] **Specific nouns and real numbers,** each with a source, base and date. No time-cost copy. No invented prices.
- [ ] **Social proof is real and attributed, or left out.**
- [ ] **Status is small and calm:** grey in the student app, and only accent or danger in the console. No rainbow tags.
- [ ] **Mono only for identifiers and figure captions.**
- [ ] **Motion follows real state,** and reduced motion is respected. No count-ups, marquees or fade-up on every section.
- [ ] **Tabular figures, right-aligned in tables,** with the base stated. No count under 10.
- [ ] **The grid is visible:** column rules, ruled rows, edges on column lines. No card inside a card.
- [ ] **No emoji as icons, no purple-to-blue gradient, no drawn browser chrome,** no pure #FFF text, no `transition: all`.

Owner-specific fails (any one blocks the screen):
- more than one saturated hue in view outside a role card
- a thick bar funnel or a 2x3 stage grid
- a funnel stage with no action
- a destructive action on a first-run screen or in a primary slot
- a chart with no decision next to it

---

## 7. Open decisions (Default until owner decides)

| Decision | Default until owner decides |
|---|---|
| Status colours in the student app (New, Applied, Interview, Offer, rules met) | **Grey.** Order and meaning come from fill, outline, weight and the ✓ ~ ✕ glyphs, never from a hue. The accent appears only in the greeting count and the active tab bar. |
| Small uppercase labels and eyebrows (Hallmark gate 67) | **Banned.** No tracked caps anywhere. The heading does the work. Section labels are sentence case at `--text-small` weight 500. |
| Dot-separated meta lines, "Stripe · Bengaluru · 2h" (gate 63) | **Banned.** Meta goes in separate chips, separate lines, or a comma list. |
| Fonts (plan decision 6) | Geist Sans and Geist Mono everywhere except auth, which keeps Bricolage. |
| Site primary fill: navy or green | **Navy** (`--navy`), as on the approved front page. Green stays the accent, not a button fill. |
| Event counts under k ≥ 10 (plan decision 4) | Treated as k-bound: weekly buckets under 10 are shown as gaps. |
| Public prices (pilot page) | None shown. |

---

## 8. Exports and migration
- **One token source:** `apps/web/app/globals.css` `@theme`. Map `--cp-*` to the names above, then delete the aliases.
- **Retire:** the Wrapped tokens (`--color-pink`, `--color-sun`, `--color-coral`, `--color-blue` as page colours), weight-800 display styles, and pill primaries outside auth.
- **Delete:** the stale `design-system/` folder, `ui/CountUp.tsx`, `ui/Marquee.tsx` and `ui/MatchRing` (score rings conflict with "no fake score").
- **Component homes:** `components/{shadcn,landing,student,campus}` (plan Part 7).

## Related
- `docs/design/reference-board.md`: per-site craft notes and the pattern tables
- `docs/design/website-dashboards-plan.md`: page specs, wireframes, suppression rules, build order
- `docs/design/screen-audit-2026-10-29.md`: sample data and honesty findings
