# Design: Hirelane

The locked system. Hallmark and every other UI run read this first, and every page shares it. Change it on purpose; this file is the rule.
Locked 2026-10-28 from the owner-approved direction A, "Wrapped stories" (docs/design/ui-plan.md, docs/mocks/README.md). Values are taken from `docs/mocks/genz-a-detail.html`.

## System
- **Genre:** playful
- **Shape:** app screens first (mobile, 5 tabs: Home, Discover, Swipe, Tracker, You). The landing page is a playable workflow told through one story, starring the labelled sample student Asha.
- **Theme:** custom (vibe: "Spotify Wrapped story cards for job hunting"). Never deal a catalog theme over it.
- **Feel references:** Spotify Wrapped and Duolingo. Take the feel only, never their assets, and no mascot.
- **Approved references:** genz-a-wrapped, -more, -app, -app-v2, -screens-3, -extra, -swipe, -hubs-states.
- **For review:** genz-a-full, -detail.
- **Rejected:** app-refined, genz-a-hubs-detail, genz-photo-led.

## Tokens
```css
:root {
  --color-ink: #0B0B0F;      /* night paper behind phone screens, text on light cards */
  --color-night: #141418;    /* app background */
  --color-cream: #FFF6E8;    /* light paper and story cards; use instead of pure #fff */
  --color-lane: #0F5C45;     /* brand green: matched ✓, primary blocks */
  --color-lime: #C8FF3D;     /* signal: active tab, picks, "applied" stamp */
  --color-pink: #FF4FA3;     /* Needs you, counters, new */
  --color-blue: #3D5AFE;     /* links, info blocks */
  --color-sun: #FFC83D;      /* partial match (~), warnings */
  --color-coral: #FF5A4E;    /* skip / pass */
  --color-focus: #C8FF3D;    /* 3:1 or better against night and cream; on cream use --color-ink outline */
  --font-display: "Bricolage Grotesque", system-ui, sans-serif;  /* opsz 12..96, weights 500/700/800 */
  --font-body: "Bricolage Grotesque", system-ui, sans-serif;
  --radius-card: 18px;  --radius-phone: 35px;  --radius-pill: 999px;
  --shadow-card: none;  /* depth comes from tilt and colour blocks, not resting shadows */
}
```
- **Type scale:** at most five sizes. Display type is giant: weight 800, line-height about 0.92, tracking -0.045em, and no more than two lines.
- **Spacing:** a 4px scale.

## Material
- **Colour:** bold, flat blocks. Never toned down: the owner rejected that.
- **Cards:** stamps (APPLIED) and tilted story cards, with story bars on top.
- **Photos:** small and supporting only. Never full-bleed, never photo-led.
- **Detailing:** borrow it, never the palette.
  - real numbers in the copy
  - the match shows its maths with misses: ✓ lane, ~ sun, ✕ muted
  - a source and freshness line
  - undo
  - timestamped activity
- **Interaction:** shown as states (drag, sheet, toast, pressed).
  - Every gesture has a button.
  - Keyboard: arrows and Space; no single-letter global shortcuts.
  - Undo lasts 4 seconds.

## Controls
- **Primary:** a lime or ink pill with weight-800 text and a 44-52px tap height.
- **Secondary:** an outline pill of the same radius and height.
- **States:** focus-visible appears instantly, and :active exists.

## Motion
- **Character:** brisk. Use spring-y card drags, a stamp-in, and a story-bar fill.
- **Reduced motion:** under `prefers-reduced-motion`, everything ends at once, and content is visible without JS.

## House rules
These are the owner's rules plus the Hallmark Floor.
- Every colour and font goes through a token.
- **Never:** pure #fff text, `transition: all`, purple-to-blue gradients, a card inside a card, emoji as icons, glass, resting shadows, invented stats or testimonials, or a hand-drawn browser window.
- Every icon is an SVG with `aria-hidden` or a label.
- `overflow-x: clip` on html and body. Must work at 320, 360, 390 and 430px.

**Open conflicts between Hallmark and the mocks.** Owner to decide. Until then, the mocks win in the existing mocks, and new code follows the Floor:
1. Tracked uppercase labels (`.tiny`, the `h2.s` section heads). Floor 67 bans them.
2. Emoji in copy ("🔥 5 days"). Floor 30a bans them.
3. Middle-dot meta strings ("Stripe · Bengaluru · 2h"). Floor 63 bans them.
4. Hallmark's ~80-words-per-screen and hero-fold rules on the landing page.

## Exports
No `tokens.css` yet. The web app's Tailwind v4 `@theme` block should take these tokens when the Wrapped UI is coded, replacing the rejected dark-green v3 tokens and the stale `design-system/` folder (finding FE-6).
