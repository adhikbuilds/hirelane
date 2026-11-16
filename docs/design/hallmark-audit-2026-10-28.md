# Hallmark audit: 2026-10-28

**Tool:** [Hallmark](https://www.usehallmark.com/) v2.0.0 (nutlope/hallmark, MIT), installed at `.claude/skills/hallmark`. The `audit` verb changes no files.
- Live run: `sloplint --render` with puppeteer-core and system Chrome.
- Mocks: static `sloplint`.
- Screenshots: 18 in `.hallmark/shots/`, gitignored (1280×800, 1440×900 and 1920×1080 folds; full pages at 1440 and 375).

**Locked direction:** [`/DESIGN.md`](../../DESIGN.md), direction A "Wrapped stories". Hallmark reads this file first, so it never deals one of its 50 catalog themes over the approved look.

## 1. Live site (the rejected dark-green v3, still on `/`)
Routes: `/`, `/jobs`, `/job/braze-senior-technical-architect-b101b5a7`, `/how-it-works`.
**27 findings: 7 Floor, 12 Reflex, 8 Finish.**

| Tier | Gate | Where | What |
|---|---|---|---|
| Floor | 26a | `/` (3×) | Focus ring at 1.14:1 against its background (e.g. the "Jobs" nav link). Needs 3:1. |
| Floor | 40 | `/` | Input borders at 1.34:1 (`input.h-10`). Needs 3:1. |
| Floor | 34 | `/how-it-works` (2×) | Horizontal scroll at 320px (scrollWidth 326) |
| Floor | 73 | `/` | Text painted under an absolute overlay ("New York City", "posted" on the demo cards) |
| Reflex | 49b | `/how-it-works` (9×) | Links wrap to 2 lines at 320px |
| Reflex | 25 | `/job/*` | Body prose runs 93–100 characters a line |
| Reflex | 39b | `/` | A 220px-tall `button.group` (the whole swipe card is one control) |
| Reflex | 71 | `/` | Card heads sit closer to what comes before them than to what they head |
| Finish | F18 | `/` 375px | The slider track renders at 295×8px on a phone |
| Finish | F19 | `/` | Four font weights in running use |
| Finish | F25 | `/jobs` 375px | 157 words shown at 1440 are hidden on a phone (keyboard help) |
| Finish | F26 | `/job/*` 375px | An h3 ends on a one-word stub line |

**What to do:** fix the 7 Floor items only if the v3 landing ships before the Wrapped rebuild. Otherwise carry these gates into the Wrapped build as its acceptance bar, with 0 Floor FAILs at 320/375/1440.

## 2. Approved Wrapped mocks (static)
Files: `genz-a-detail`, `genz-a-swipe`, `genz-a-hubs-states`, `genz-a-more`.
**276 Floor, 62 Reflex, 12 Finish.** Mock HTML is hand-written, so most of these are mechanical and disappear once the screens are coded against tokens:

| Gate | Count | Meaning | Fixed by coding? |
|---|---|---|---|
| 48 | 193 | Literal colours and fonts outside the token block | yes (Tailwind `@theme` tokens from DESIGN.md) |
| 33 | 27 | `<svg>` without `aria-hidden` or a label | yes |
| 7a | 23 | Pure `#fff` text | yes: use `--color-cream` / off-white |
| 24b | 59 | Spacing off the 4px scale | yes |
| 26a / 26b | 2 / 2 | No `:focus-visible` / `:active` | yes |
| 34 | 4 | No `overflow-x: clip` on html/body | yes |
| 40 | 1 | `.story em` at 3.04:1 (needs 4.5:1) | yes: raise the contrast |
| 19 | 2 | A dash in copy | copy edit |
| 3 | 1 | Side-stripe border on the timeline | design tweak |
| **67** | 2 | Tracked uppercase labels (`.tiny`, `h2.s`) | **owner decision** |
| **30a** | 5 | Copy that opens with an emoji ("🔥 5 days") | **owner decision** |
| **63** | 13 | Middle-dot meta strings ("Stripe · Bengaluru · 2h") | **owner decision** |

## 3. Owner decisions (where Hallmark's Floor and the approved Wrapped mocks conflict)
1. **Tracked caps labels** (gate 67). Hallmark bans them. The Wrapped mocks use them for section heads and tiny labels. Pick one: keep them as a waived house style, or switch to sentence-case labels a step smaller.
2. **Emoji in copy** (gate 30a). Streak fire and similar. Pick one: keep them as a waiver, or replace them with custom SVG icons.
3. **Middle-dot meta** (gate 63). Pick one: keep the source/freshness lines as dot-joined, or break them into lines or columns.
4. **Words per screen and the hero fold** (Floor 12–13). These apply to the landing rebuild only. The playable-workflow landing may exceed ~80 words per screen.

Until you decide, existing mocks stay as they are, and new code follows the Floor.

## 4. Re-running it
```bash
export HALLMARK_PUPPETEER=<dir with node_modules/puppeteer-core>
node .claude/skills/hallmark/scripts/sloplint.mjs --url http://localhost:3001/ --scope app --genre playful
node .claude/skills/hallmark/scripts/sloplint.mjs docs/mocks/genz-a-*.html --genre playful --scope app
```
