# Hirelane landing v3: "Swipe right. We fill it in." (revised 2026-10-16)

The owner has rejected landing v2 ("complete AI slop") and the first v3 spec, which was too text-heavy. Their notes:
- "Too much text, zero UI depth."
- They want left-swipe and right-swipe "detailing" that other people will actually want to use.
- Use **ui-ux-pro-max** and **shadcn/ui**.

The UI is the product. Build it like a polished consumer app, not a website about an app.

## Skills (read before building; they are in `.claude/skills/`)

- **ui-ux-pro-max (primary).** Read `SKILL.md`, `references/quick-reference.md` and `references/pro-rules.md`.
  - The generated design system is in `design-system/hirelane/MASTER.md`. The page override
    `design-system/hirelane/pages/landing.md` wins over MASTER: it holds the brand palette and type.
  - Query more with `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain <ux|landing|gsap|react|style>`
    or `--stack shadcn|nextjs`.
  - Pattern: **Immersive/Interactive Experience**. Style: **Spatial UI** (depth, layered translucent panels, parallax,
    smooth scale on focus). Dials: variance 7, motion 8, density 3 (spacious).
- **ui-styling, design-system and shadcn:** components and tokens.
- **fixing-accessibility and fixing-motion-performance:** gates.
- **design-taste-frontend (taste-skill) is reference only now.** Keep its anti-slop bans:
  - no eyebrow labels or pill badges above headings
  - no gradient-mesh backgrounds
  - no rows of identical icon cards
  - no stock "trusted by"
  - headlines of two lines or fewer
  - five type sizes at most

  Its "no shadows, no glass" rules are **overridden**: depth and spatial panels are the point now. Use
  `scripts/inspect.mjs` for measurements, and judge its shadow, glass and outlined-box FAILs against this spec, not as
  blockers.

## Word budget: about 150 words on the whole page, outside product fragments

- Show, don't tell. Text inside the live product (job cards, details sheet, undo bar) does not count.
- No paragraphs anywhere on the page. One line under a heading at most.
- No FAQ on the landing (it moves to `/about` later). No comparison table. No "how it works" prose.

## Palette and type (brand; also written to the page override)

- Ground: the full-bleed road photographs, with a forest scrim `#0f1f10` at 55–70% where text sits.
- Spatial panels: translucent forest `rgb(15 31 16 / 0.55)` with `backdrop-blur(20px)`, a 1px inner highlight
  `rgb(255 255 255 / 0.08)` and deep layered shadows.
- Ink: `#ffffff`. Muted: `#a3ada3`.
- Accent: lime `#c6f19d` on primary actions and the APPROVE stamp. Pass: `#ff6b5e` on the PASS stamp only.
- Signal yellow `#FACC15` for Needs-you and the undo bar. Sign green `#0F5C45` for the road-sign layer.
- Type: Overpass Variable, already loaded. It is the brand's highway-sign typeface. Display 800 with tight tracking.
  Use 4–5 sizes in total.
- Scope everything under `[data-landing="v3"]`, where the foundation already set up shadcn tokens. Do not change
  `/jobs` or `/job/*`.

## Page, in order (≈150 words in total)

1. **Hero: full-screen interactive (100svh).**
   - **Background:** the road photos `/landing/road-*.jpg`, crossfading through midnight, dawn, noon and dusk (the four
     six-hour reads), 1.6 s fade and about 6 s hold. Parallax: the photo moves less than the cards on mouse move or
     device tilt (max 12px / 24px), and is disabled under reduced motion.
   - **The sign:** the road sign in the photo shows the top card's company and role, set in white Overpass on the
     sign rectangle from `road.json`. It flips (rotateX) when the card changes.
   - **Left, short text:** H1 **"Swipe right. / We fill it in."** (two lines, display size). **Changed 2026-10-16:** "We apply." overclaims, because Hirelane drafts the application and hands off to the employer's own form; it never submits. Any hero already built with "We apply." must be changed (Look phase); one line, **"You approve every
     application. 4 seconds to undo."**; primary button **Start free** (lime, scrolls to #start); and a live line in
     small type, **"{16,320} live roles · {117} companies · updated {4h} ago"**.
   - **Right:** the **floating swipe stack** (spec below), 3 cards deep, with spatial depth, parallax and shadows.
     Under it, two round 56px buttons, ✕ (pass) and ✓ (approve), with key hints ← / →.
   - **Phone:** the stack is centred and full width, the text sits above it in 2 lines plus the button, and the
     buttons sit under the stack within thumb reach.
2. **Scroll tour: pinned (Immersive pattern "guided product tour").**
   - The stack stays pinned while 4 short scroll stages animate on it, each with a heading of 6 words or fewer and no
     paragraph:
     - **"Every match shows its maths."** The match ring opens into met and missed chips.
     - **"Pay, read from the posting."** The details sheet slides up, with the pay-trace words lit.
     - **"It asks. It never guesses."** A Needs-you field pulses yellow, and a quick answer fills it.
     - **"4 seconds to change your mind."** The undo bar drains, then a "Handed off to {Company}'s site" toast.
   - GSAP ScrollTrigger pin with scrub, or motion's `useScroll`, whichever the stack already uses. Choose one and
     record it.
   - Mobile and reduced motion: the stages stack vertically as static frames with the same 6-word headings.
3. **Three moments (bento, visual, no icon cards):** three spatial panels of different sizes, each a live fragment
   with ≤ 10 words:
   - **Live board.** The 6 freshest real jobs ticking in (marquee in a panel): "{16,320} roles. Refreshed every six
     hours."
   - **Your rule.** One shadcn Slider (min match) and a big live number from `/api/public/stats/autopilot`: "≈ {N} new
     matches a week."
   - **Real companies.** A drifting cloud of the top 12 company names by open roles from the DB, set as text: "Reading
     open roles at {OpenAI}, {Stripe} and 115 more." Never "trusted by".
4. **Pricing: one panel.** Plan names Free, Basic, Pro and Ultra as a segmented control. Show one big price, the
   applications included and the per-application cost. INR/USD and Weekly/Monthly/Quarterly as small toggles. Button
   **Start free**. One small line: "Planned prices. Checkout opens soon." Values come from `pricing-model.ts`.
5. **Start (#start): the product's first screen.**
   - A spatial dialog at true size over the dusk photo: the resume drop zone (PDF only, browser only, never uploads;
     reuse the `resume-drop` logic).
   - Then the parse animation fills the card: name, roles and 6 skill chips. Then: "Create your account to save this.
     Coming in the next release," with a disabled button.
   - Heading: **"Start with your resume."**
6. **Footer: one quiet line.** "Hirelane · Jobs · Companies · API · Privacy · © 2026 · Road photos are AI-generated."

Header: a minimal floating bar, consistent with Spatial UI. It has the `||` wordmark, Jobs, Pricing and Start free, is
transparent over the hero and becomes a translucent panel on scroll. On phones, a menu sheet.

## Honesty and product rules (binding)

- Numbers are live from the DB. No invented testimonials, logos or stats. Company names are boards Hirelane reads.
- No competitor names (brand-guard) and no submission APIs (no-submit-guard).
- Approving in the demo makes **no network request**. The resume never leaves the browser.
- Fixture match maths come from `demo-model.ts`, which has the real pay-floor check.

## Depth and swipe (owner request, 2026-10-16: "UI depth, left swipe and right swipe detailing, so other people will use it")

The hero's approve card is a **swipeable stack** with real physical depth. It is the product's core gesture, so build it
like a polished mobile app, not a web demo. The stack floats above the page, so layered shadows are allowed on it: it is
a dragged, floating object inside `data-ui`, which is the "things that truly float" exception to the house rules.

**Stack depth.**
- The top card sits on 2–3 cards behind it, each scaled 0.95 and 0.90, offset 10–14px down and slightly dimmed. Each
  behind-card shows the next real job's company and role, so the stack reads as a queue.
- The top card has a two-layer shadow: tight contact plus wide ambient. It grows while the card is lifted (dragged).
- When a card leaves, the next one rises into place with a spring (`motion/react`: stiffness ~300, damping ~30).

**Drag and swipe** (`motion/react` drag="x"; Pointer Events for mouse, touch and pen):
- The card follows the pointer 1:1 and rotates with x (±12° at the edge), pivoting from below the card.
- **Right swipe = Approve.** A lime "APPROVE" stamp fades in on the left and a sign-green tint grows with distance.
- **Left swipe = Pass.** A "PASS" stamp fades in on the right with a neutral grey-black tint.
- The stamps scale from 0.8 to 1 as the drag approaches the threshold and "snap" at it. Add a 10 ms
  `navigator.vibrate` at the threshold where supported (never under reduced motion).
- Commit when the drag passes 35% of the card width or the release velocity passes 600 px/s. The card then flies out
  in the throw direction with its velocity and rotation. Otherwise it springs back.
- **Approve commit:** the 4 s signal-yellow undo bar appears under the stack ("Sending to <Company> in 3.2s · Undo").
  **U** (or tapping Undo) flies the card back in from the right. When the bar runs out, a sonner toast says "Handed off
  to <Company>'s site".
- **Pass commit:** a small "Passed · Undo" line for 4 s. Undo flies the card back from the left.
- **Needs-you gate:** if the card has an unanswered Needs-you field, a right swipe past the threshold springs back.
  The field then shakes (a 3-cycle 6px translateX), gets focus and shows "Answer this first. Hirelane never guesses."
- `touch-action: pan-y` on the card, so vertical page scroll still works on phones. A drag that is mostly vertical
  (angle over 30°) is ignored.

**Detailing** (what makes the card worth swiping):
- Front of the card:
  - company logo or monogram, role, location and work mode
  - normalised pay plus the pay as stated
  - freshness ("posted 3h ago")
  - a match ring with its maths ("7 of 8 requirements · salary above your floor")
  - up to 6 requirement chips (✓ met / ✗ missed)
  - the one Needs-you field with quick answers
- **Tap the card, or press Space or Enter, to open its details:**
  - On desktop a panel expands in place (layout animation).
  - On phones a shadcn Sheet slides up.
  - It holds every requirement with met or missed and its evidence quote, a mini pay trace with the source words lit,
    the company's other open roles count, and "Open the posting" (an external link, `rel=noopener noreferrer`).
  - The details have their own Approve and Pass buttons.
- **First-visit hint:** once, when the stack enters the viewport, the top card nudges 24px right, then 24px left, with
  the stamps peeking. A small caption reads "Swipe right to approve, left to pass. Or use A and P." The page then
  remembers in localStorage that the hint was shown. It is skipped under reduced motion.
- **Accessibility:** every gesture has a button and a key: A or → approves, P or ← passes, U undoes, Space opens the
  details. An `aria-live` region announces "Approved Senior Data Engineer at Razorpay. Sending in 4 seconds. Press U to
  undo." Focus stays on the stack. Under reduced motion, cards cross-fade and nothing flies or rotates.
- **The sign on the road photo shows the top card's company and role.** It changes with a short vertical flip as each
  card is decided, like a sign panel updating.
- After the last fixture card, show an end-of-queue state:
  - "That's today's queue. 8 decided: 5 approved, 3 passed."
  - a "Start over" button
  - the "Start with your resume" primary button
- **Performance:** animate transform and opacity only. Use `will-change` only while dragging. 60fps on a mid-range
  phone. No layout thrash.


## Gates (all must pass before the owner sees it)

1. **ui-ux-pro-max's pre-delivery checklist:** `references/pro-rules.md` plus the MASTER checklist (contrast 4.5:1,
   focus visible, 44px targets, reduced motion, 375/768/1024/1440 with no horizontal scroll, no emoji icons).
2. **Word count:** ≤ 170 words of marketing copy outside `data-ui` fragments. The look agent measures it with a script
   and reports the number.
3. **Depth check by eye:**
   - Screenshots at 1440 and 390, including mid-drag frames at 20%, 40% and past the threshold.
   - The stack must read as physical objects floating over the road: layered, lit and shadowed.
   - The first screen must be dominated by the photo and the stack, not by text.
4. **Quality:** axe 0 serious. `pnpm verify` green. The landing e2e (swipe by mouse and touch, keys, no network on
   approve, reduced motion) passes on desktop and mobile.
5. **Performance:** LCP photo priority, AVIF/WebP, 60fps drag (transform and opacity only), CLS < 0.1.
## Next: /jobs swipe mode (owner decision, 2026-10-16)

When `/jobs` and `/job/[slug]` get the v3 treatment, `/jobs` gains a **List | Swipe** switch.
- Swipe mode turns the current filtered results into the same card stack, with the same physics, stamps, details sheet
  and keys.
- Right means **save to your shortlist** (localStorage until accounts arrive). Left means **hide from this view**, with
  undo.
- The list view keeps the hover preview. The switch is reflected in the URL (`?view=swipe`).

Order after the landing (owner, 2026-10-16):
1. The `/jobs` swipe mode and the v3 treatment for `/jobs` and `/job/[slug]`.
2. Hirelane Phase 4: accounts, an encrypted resume upload and real matching, so the swipe queue becomes the user's own.
Phase 4 sign-in (owner, 2026-10-16): email magic link only (passwordless). Google sign-in may come later.
