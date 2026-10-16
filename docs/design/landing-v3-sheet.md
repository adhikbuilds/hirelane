# DIRECTION SHEET — The product performs
seed 1023432570 · drawn 2026-10-16 · sector ai-product
Brief: Hirelane job agent: reads 117 career sites every six hours, matches roles to your resume, drafts each application; you approve every one with a 4-second undo; hands off to the employer's own form.

| | |
| --- | --- |
| Direction | The product performs |
| Hero | Column on one line |
| Type | kept from the brand |
| Colour | Black and crimson |
| Sections | showcase (Live demo with controls) → how-it-works (Run-in column) → proof (One quiet logo row) → features (Comparison set as text) → pricing (Plan names, one live figure) → faq (Accordion of filled tiles) → cta (First step, already open) → footer (A single quiet line) |
| Motion | Slow crossfade |
| Photographs | the "Fog and quiet" set, as atmosphere |

This is the direction for this build. Adopt it. Do not blend it with the layout you would have made anyway,
and do not redraw because it is unfamiliar: unfamiliar is the point. Redraw a slot only when it conflicts
with a stated brand constraint or needs an asset that does not exist, and say why in your report.

The parts of this sheet were written separately and will disagree in small ways. Settle every disagreement in this order:
**house rules** (including type no smaller than 13px and body text of 16px or more) → **the direction** (the idea, the composition habits, where the
one accent goes) → **the type system and the palette** (which face does which job, the five size steps, which colour is the ground and where the
accent goes) → **the hero blueprint** → **the section blueprints**. Under each blueprint below, "Adjusted for this page" lists where it disagrees.
In practice: take geometry from blueprints (columns, proportions, what sits where) and take everything else from above them. Map every size a
blueprint names onto one of your five type steps instead of adding a sixth. Use one button shape, one corner radius and one pair of page margins on
the whole page, whatever individual blueprints say. If a blueprint names a kind of typeface (a light serif, a heavy grotesk), use the dealt face.

## 1. The idea
Software is most convincing when it is doing its job in front of you. Instead of describing features, put small, true, working fragments of the product on the page: the actual control, with real content, responding to the pointer. A colour picker's loupe reads the page's own background and prints its value. A list tool lets you tick an item right there. A type-scale plugin sets the page's own headings. Find the one interaction that is the product and make the hero that interaction; then show each further capability as another fragment at real size. No dashboard collage, no browser frame, no screenshots shrunk until unreadable.

Before anything else, write one sentence in your notes: "On this page, <the subject's own material> becomes <the device>."
Fill the first blank from your inventory of what only this client has (its name and what it means, its street, its numbers, its
constraint), then put the nearest competitor in the sentence: if it still works, the idea is the category's, not the client's.
Then name the one live thing the visitor can do on the page (SKILL.md step 4).

## 2. Composition
Hero: a short plain headline (4–6vw, left-aligned, upper-left third) and one sentence; the rest of the first screen is the main fragment at actual interface size, sitting directly on the page or on one flat stage colour, large enough to read every label. The fragment is built in HTML and works. Below, capabilities are a single-column sequence, each a row of two parts on a 5/7 split: a two-line statement on one side and the relevant fragment on the other, with the fragments varying in size and shape so the column never becomes a zigzag of equal blocks. Fragments are cropped pieces of interface (a menu, a row, a control, a panel edge), not whole windows. One section pins a fragment while three short statements change it.

## 3. Type
Kept from the brand. The marketing type matches the product's interface type so the fragments and the page feel like one thing. Headline modest; interface text at its true size (13–15px) inside fragments.

## 4. Colour — Black and crimson
```css
:root {
  --bg: #0a0a0a;
  --surface: #151515;
  --ink: #efefef;
  --muted: #8c8c8c;
  --accent: #b11226;
  --accent-ink: #ffffff;
  --field-1: #efefef;  --field-1-ink: #0a0a0a;
}
```
Black with off-white text and mid-grey texture takes nearly the whole page, and the last sections may invert to off-white with black type. Deep crimson is scattered sparingly: a few characters in a heading, a slider fill, the one button.
Neutral ground. The product's own interface colours provide the colour. At most one flat stage colour behind fragments.

## 5. Imagery
**This subject is software and there are no screenshots, so its pictures are its own interface.** Wherever this sheet says photograph, image or object, build a believable fragment of the product in HTML at real size (real labels, numbers that add up, one item hovered or selected), put the attribute `data-ui` on its root, and crop or scale it the way the blueprint treats a photograph: a full-bleed close crop, a tile, the fixed half of a split. Where a fragment makes no sense, use a flat colour field with type on it. Never a fake dashboard of grey bars, never a device frame. If the product works on something physical (ships, plants, buildings, a city), one real picture of that world can carry a section: find it with `node /Users/aagarwal/hirelane/.claude/skills/design-taste-frontend/scripts/assets.mjs "<that world>"`, download it with `--get`, credit it on the page, and never let it pass for the product or its customers.

The interface fragments are the main imagery: build them carefully with real labels, real numbers and sensible states (one hovered, one selected). Around them, two or three real pictures of the customer's world (found with scripts/assets.mjs), never stock of people at laptops.

**Floor (the inspector checks it):** at least four real pictures on the page, usually six to twelve; SVG drawings do not count. One moving picture where an honest clip exists: `node <skill>/scripts/assets.mjs --video "<query>"`, used as a muted loop with a poster frame. Whatever this direction says about pictures, it is carried out with real ones.

Optional atmosphere, two at most, from the "Fog and quiet" set (misty, muted, minimal landscapes and empty horizons; calm areas for text). The page does not need them.
Order of preference for imagery: (1) the project's own photographs and product shots; (2) images you generate, if an image tool is
available; (3) real pictures of the subject's world found in the open collections (assets.mjs, downloaded and credited on the page);
(4) drawings of the subject in code; (5) these. They are real photographs (Unsplash licence, served by picsum.photos) of places, light and
texture. They are atmosphere, never a stand-in for a specific product, dish, person or interface. List the ones you use in your report so
they can be replaced.
- `https://picsum.photos/id/926/1600/1000` — Lone figure standing on a hilltop in thick beige fog · light tone · warm beige, olive grey · calm area: top · native landscape · photo: Harman Abiwardani
- `https://picsum.photos/id/922/1600/1000` — Dark treeline dissolving upward into pale fog, black and white · mid tone · charcoal, grey, white · black-and-white · calm area: top · native landscape · photo: Patrick Hendry
- `https://picsum.photos/id/228/1600/1000` — Single round hay bale in a field under dense fog · mid tone · grey green, golden tan · calm area: top · native landscape · photo: Michal Kubicek
- `https://picsum.photos/id/842/1600/1000` — Wooden steps with railings descending into pale pink fog · light tone · blush pink, pale grey, slate · calm area: top · native portrait · photo: Joe Beck
The last two path numbers are width and height: request the exact crop you render (`/1200/1500` for a 4:5 portrait, `/2400/1350` for a hero) and
add `?grayscale` to desaturate. Use at most two. Always set `width`, `height`, `alt` and `loading="lazy"` (not on the hero image).
Other sets that fit this brief: architecture, water, sky-and-space — `node draw.mjs --photos <set>` prints one in full; `--photos list` shows all sets. Taking photographs from another set is your call and is not a redraw; keep them to one light and one treatment.

## 6. Hero — Column on one line
A warm off-white page that is more than 80% empty. Everything hangs on one vertical alignment 27% in from the left edge, the start of column 4; nothing is centred and nothing sits to its left. A small logo mark sits on that alignment 56px from the top. About 220px lower the column begins, only 380px wide: a two-line headline at 27px in medium weight, line-height 1.25; one supporting sentence at 15px in the softer ink, line-height 1.5; then, 28px below, the single action as a near-black rectangular button with 4px corners and one text link with an arrow beside it. A sign-in text link sits alone in the top-right corner at 14px; there is no navigation bar. At the bottom edge the first demonstration peeks in on the same alignment: a flat panel one step darker than the page, 368px wide, its top 90px visible, holding two real rows of the product's interface at true size with a visible pointer. Mark the panel's root with data-ui. The right half of the screen is blank on purpose, and nothing spans the full width until the footer.

On a phone: The alignment becomes the 24px left margin. The logo mark sits 32px from the top and the column starts at 30% of the height: headline at 24px on two lines, the sentence at 15px, then button and text link side by side. The demonstration panel spans the width between the margins and shows its top 120px above the fold. The sign-in link stays top-right.
Headline: A dry two-line statement at 27px, up to about 30 characters per line; it never grows larger at any width.

Adjusted for this page:
- It names colours (white, black): map them onto this palette's roles (ground `--bg`, panels `--surface` and the fields, text `--ink`/`--muted`, the accent `--accent` on the primary action only).

## 7. Sections, in order
Each is a composition to rebuild with this project's content. Keep the geometry; change the subject. Re-order or drop a
section when the argument of the page needs it (see references/copy.md), never to fall back to a card grid.

### 1. showcase — Live demo with controls (split)
One filled panel, 680–760px wide and about 640px tall, radius 12px, in a tone clearly darker or lighter than the ground, placed on the text column's left edge or centred, with at least 15vh of empty ground above and below. The panel is split 62/38 into two flat areas that differ by one tone. Left area: the product doing its job on real content at true size. Right area: a narrow column of working controls, six to nine stacked rows 44px tall, each with a name at 14px on the left and a slider, toggle or value on the right; changing one changes the demonstration at once. A text link sits in the panel's bottom-left corner. The heading, two to four words at 24–32px, sits above the panel on its left edge with one sentence at 16px; under the panel, one line of start instruction.
On a phone: The panel fills the width. The demonstration takes the top at 4:3; the controls follow beneath as full-width rows 52px tall, only the four most telling ones, with a text link that reveals the rest. Heading and sentence sit above at 24px and 16px.

Adjusted for this page:
- It names its own corners: use the one radius of this page (square unless the direction says otherwise) and one button shape.

### 2. how-it-works — Run-in column (list)
The quietest sequence: one reading column and good typography. A single column 520–600px wide starts at about 30% of the viewport width (or sits on the page's text axis). The heading is a two-to-five-word question or statement at 28–32px, 48px above the first paragraph. Three to five paragraphs follow at 17–18px with line-height 1.6. Each opens with a bold run-in phrase in full ink that names its moment ('To begin,', 'Within a day,', 'After that,', 'From then on,') while the rest of the paragraph runs in the soft ink; there are no subheads, bullets or markers. After each paragraph, 20px lower, comes one small piece of evidence exactly as wide as the column: a cropped interface fragment, a photograph at 16:9, or a row of three small frames 96px tall. 72px separates stages. Nothing in the section is wider than the column, and the space to its left stays empty.
On a phone: The column fills the width between 20px margins. Type stays at 17px. Evidence pieces keep the column width; the row of three frames becomes a single sideways-scrolling row 88px tall. 56px between stages. The heading drops to 24px.

### 3. proof — One quiet logo row (strip)
Only for real logos supplied by the project; if none are supplied, set the names in the text face at 22px in the same row and never draw stand-ins. The row reads as a sentence: it opens at the left margin with two to four plain words at 18px (the phrase that introduces the names), vertically centred on the logos, and five to seven logos follow on the same line, spread to the right margin with `justify-content: space-between`. Every logo is normalised to one optical height (28–32px for wordmarks, 36px for compact marks) and one colour, the page ink, using single-colour SVGs with `fill: currentColor`. The band is tall and almost empty: 120–150px of ground above and below the row, no box, no background change and no separate heading. Logos stay still; nothing scrolls or fades at the edges.
On a phone: The opening words sit alone on the first line at 17px. Logos follow in a grid of two per row, each 26px tall and left-aligned in its cell, with 36px between rows. Show six at most; there is no sideways scrolling.

### 4. features — Comparison set as text (table)
A comparison table with no lines and no tick marks. A CSS grid: capability names in columns 1–5 of 12 at 22–24px medium, then three answer columns of equal width (plans, methods, or this against the usual way). Every cell answers in words at 17px: 'Yes, unlimited', 'Up to five', 'Not yet', never a symbol. Seven to ten rows, each 64–72px tall, with every other row on a ground one tone darker so the eye tracks across; rows touch. The column that matters is one filled block in the accent or ink colour running the full height of the table behind its cells and rising 24px above the first row, with its text reversed. Column names sit in the top row at 17px bold. The heading, two to four words at 40–48px, hangs top-left above column 1 with 48px beneath.
On a phone: The table turns on its side: one block per capability. The name at 20px bold, then three lines beneath, each giving a column name and its answer at 16px; the featured column's line is set on the filled colour at full width. Blocks alternate the two ground tones.

### 5. pricing — Plan names, one live figure (index)
Plans are a list of names; the price shown belongs to whichever name is selected. Columns 1–6 hold the plan names stacked at about 5vw, leading 1.1, each a `<button>`; the selected one is in the full ink, the others in the softer ink, and the selected name carries a solid dot 0.3em across at its left. Columns 8–12 hold one stage that stays in place while its contents change: the selected plan's price at about 9vw at the top, the period beside it at 18px, a paragraph of three or four lines at 18px saying what that plan includes, and one rectangular button whose label names the plan. Changing plan swaps the stage contents with a 200ms crossfade; the figure's position never moves. Selection follows click and keyboard focus. The middle plan is selected on load. There is no heading: the names are the heading.
On a phone: Plan names stack at 10vw, each on its own line. Tapping one opens its stage directly beneath that name (price at 20vw, paragraph at 17px, full-width button) and closes the others, like a large accordion without lines. The middle plan starts open.

### 6. faq — Accordion of filled tiles (stack)
A two-part row. Columns 1–4 hold the heading, two to four words at about 4vw, `position: sticky; top: 96px` so it stays while the list scrolls past. Columns 5–12 hold the accordion: each question is a filled tile one step from the page ground, with 8px between tiles, no border and the page's one radius (or its motif's corner). A closed tile is 72px tall with the question at 20px medium on the left, 24px padding, and on the right a plus sign drawn from two 3px bars 16px long. The open tile switches to the accent colour with its assigned ink, the plus becomes a minus by rotating one bar, and the answer appears at 17px, no wider than 52ch. Build each tile as `<details>` with a shared `name` so one opens at a time. Six to nine tiles.
On a phone: The heading sits above at 9vw, not sticky. Tiles run full width with 6px gaps, questions at 18px wrapping to two lines, closed height at least 64px. The open tile keeps the accent colour, and answers are set at 16px with 20px padding.

### 7. cta — First step, already open (split)
The page ends with the product's first screen already open. A full-bleed field in the accent colour, 90svh tall. Right, in columns 7–11, vertically centred: the product's own create dialog at true size, 440px wide, root marked data-ui, with its real title ('Name your workspace'), one text field holding an editable, believable example, one two-option segmented choice and its primary button. Inside the fragment the product's conventions apply, including the shadow its dialog normally casts. The field accepts typing, the choice switches, and the primary button is the page's only action: it carries the typed value into sign-up. Left, in columns 1–5, anchored to the bottom with 40px margins: the closing line, two to four words at clamp(56px, 7vw, 112px), leading 0.92, on two lines, and under it one sentence at 17px saying what happens after the button. The upper-left stays empty.
On a phone: The closing line leads at 13vw on two lines, top-left, with its sentence beneath at 16px. The dialog follows at full width inside 16px margins, at true size, its primary button 52px tall and full width. The field is at least 84svh; the dialog sits in its lower half.

Adjusted for this page:
- It mentions a shadow: only on something open above the page (a menu, a dialog), never on a resting element.

### 8. footer — A single quiet line (strip)
No footer block at all. After at least 30svh of empty page ground, one baseline 30px above the bottom edge carries three items in the page's ordinary small text size (14–16px), the same size and weight as the navigation: at the left margin, what this is in three or four words; centred, two to five links separated by 24px of space; at the right margin, the year and a privacy link. Use a three-column grid (1fr auto 1fr) so the centre group is truly centred whatever the side lengths. No logo, no background change, no line above it, no columns. Links are in the full ink; the rest in the softer ink. If the page has a narrow text column, the three items may instead sit on that column's left edge as one wrapped line. The restraint only works if the page above has already made its invitation.
On a phone: Three short lines at 14px on the left margin with 8px between them: the description, the links on one wrapped line, then year and privacy. Links stay in the full ink. Leave 20svh of empty ground above and 24px below.

## 8. Motion — Slow crossfade
The principal photograph quietly changes: three or four images of the same framing crossfade over about 1.6 seconds, holding five to six seconds each, or the fixed image changes when its matching section arrives. It should feel like light shifting in a room. Pause when the tab is hidden; under reduced motion show only the first image.
This is the signature move, the one loud moment. Around it the page still needs the rest of the motion layer (SKILL.md step 9): an entrance for the parts of every section, feedback on every control, and one moving picture. The inspector fails a page that barely moves. Recipes: references/motion.md.

## 9. Where the richness comes from
Fidelity. A fragment with believable content and a real hover state is more interesting than any illustration. Spend the effort there.

## 10. How this direction goes wrong
A fake interface made of grey bars and circles is the worst outcome; if you cannot build a believable fragment, change direction. Mark each fragment's root element with the attribute data-ui: inside it the product's own conventions apply (1px control borders, small radii, a shadow on its open menu) and the inspector leaves them alone; outside it the house rules hold as usual. data-ui is for cropped fragments only, never for a page wrapper. Do not put the fragment in a browser or laptop frame.

## 11. Real references
Studied sites that work this way. Take the principle, never the specifics: no names, copy, images or signature assets of theirs.
- **Shelf** (One Page Love, studied score 7.1) `opl-shelf`
  Idea: Saves scattered across a dozen places are funnelled into one searchable shelf, shown literally by tumbling source chips and a panel edge that narrows to a point.
  Hero: An off-white panel sits inside a 12px warm-grey page frame. A compact floating nav about 880px wide: logo left, three links and a lime waitlist button right. Centred stack: a small grey pill badge with a sparkle icon, then a two-line headline in General Sans Semibold at about 5.8vw with tight tracking, one word of which sits on a lime rounded-rectangle highlight; a two-line grey subhead; an email field with its button nested inside one rounded outline, 460px wide. From 75% down, the top of a bordered app window rises, and a larger search bar holding a half-typed query overlaps it with a soft shadow.
  Worth taking: Shape a section's bottom edge into a chevron and run a hairline from its tip to the next heading, turning 'many into one' into layout.
- **Uni** (One Page Love, studied score 7.2) `opl-uni`
  Idea: The product lives in the laptop notch, so the page's navigation is a black notch and the hero is a laptop outline whose notch opens into the app.
  Hero: White page with the hero as a rounded-corner panel inset 24px on all sides, filled with a grainy pastel gradient (pink-peach centre, sky blue down the right edge, orange lower-left). A black pill 300×44px sits top-centre like a laptop notch, holding only the app icon; it is the entire nav. Centred below: a hand-scrawled caps eyebrow, a two-line 48px (3.3vw) headline, two white pill download buttons side by side, one line of tiny grey reassurance. The bottom 40% is a thick black outline of a laptop screen, 960px wide, cropped by the fold, its notch expanded into a dark input bar playing the demo.
  Worth taking: Shape the navigation like the product's own hardware habitat (here a black notch pill) so the nav itself demonstrates the product.
- **Cerebrium** (Awwwards Site of the Day, studied score 7.7) `aww-cerebrium`
  Idea: Infrastructure speed expressed as glossy magenta ribbons sweeping through a near-black field, with the technical proof delivered underneath on a white sheet of mono-labelled demo panels.
  Hero: Full-bleed near-black canvas with fine grain; thick glossy magenta-plum 3D ribbons arc up from the bottom and right, one edge catching a white highlight. Top bar: logo left; at right a dark rounded rectangle holding five uppercase mono links, then two squarish buttons (pale lavender log-in, hot-pink sign-up). The upper 60% of the left side is empty. The headline is three lines of light-weight grotesk at about 5.5vw, flush left on a 3% margin, ending about 10% above the bottom edge, with one word in a pink gradient. At two-thirds across, level with the headline's lower lines, a five-line paragraph and two mono-labelled buttons.
  Worth taking: Pin a short list of feature names on the left and let only the active name hold full ink while the others drop to pale grey, as a stack of demo panels scrolls past on the right.
Full notes on any of them: `node draw.mjs --site <id>`.

## Always
Headlines two lines or fewer at every width. No eyebrow labels, no monospace, no 01/02/03, no thin rules, no gradients, no shadows at rest,
no cream-and-terracotta, no violet. `inspect.mjs` measures all of it.

Saved to /Users/aagarwal/hirelane/.taste-skill/direction.json · reprint with `node draw.mjs --show`
