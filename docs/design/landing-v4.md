# Hirelane landing v4: the play-through workflow (2026-10-16)

The owner compared v3 with the reference product's landing and said ours "looks like an AI catalog: no workflow, no
interactions, complete text, and the card looks very bad; the image is not interactable." They asked us to study the
reference landing and "build it completely". **v4 replaces `/`. It overrides landing-v3.md**, except the "Depth and
swipe" physics, which v4 reuses inside the phone.

Studied on 2026-10-16. Patterns only: never its copy, colours, mascot or names (brand-guard). The reference hero is a
phone running the real app loop:
- a clean job card (logo, company and place, match ring, role, pay in green, three chips, one-line "why it fits")
- Pass and Apply buttons
- a dark toast ("Application away · #24 this month · Undo") while the next card slides in
- small floating notes around the phone hinting at later outcomes

Every later section is another working product fragment that moves the story forward: an autopilot rule and its
timeline, a ready-to-send form, reply routing, then live board stats by role and country, pricing, FAQ and a CTA. The
page is light and warm, with plenty of space and very little prose.

**v4 must beat it** in four ways:
1. The workflow is *playable end to end*: resume, then matches, then swipe, then the form fills, then handoff.
2. The numbers are real.
3. Pay shows its source words.
4. The design is more polished. There is no mascot and no fake testimonials.

Skills to use (in `.claude/skills`): ui-ux-pro-max (`design-system/hirelane/MASTER.md` checklist and searches),
ui-styling, shadcn, landing-page and fixing-accessibility. Read them.

## The theme: one pitch, told as a story (owner, 2026-10-16: "everyone follows a theme to pitch and show people different things")

The page is not a list of features. It tells **one story with one character and one throughline**, and every section
is a chapter that shows a *different* side of the product.

- **Theme: "Your lane to the next job."** Hirelane is a lane: you stay in it, it carries you forward, and you choose
  every exit.
- **Visual throughline:** a thin lane line with dash marks runs down the page, behind the sections, from hero to
  final CTA.
  - It is drawn as you scroll (SVG stroke-dashoffset, transform-free).
  - Each chapter is a **stop** on it, marked with a small signpost (chapter name, set in Overpass).
  - The workflow's progress rail *is* the same lane.
  - Under reduced motion the line is static.
- **Character:** the sample resume belongs to **"Asha, data engineer, Bengaluru"**, clearly labelled "Sample
  profile". Every fragment uses her: the hero phone's queue is matched to her; the workflow plays her morning; the
  autopilot rule is hers; the board highlights her role and city. Real jobs, a fictional sample person, labelled.
- **The pitch arc.** Each chapter has a headline of six words or fewer and *one* new thing shown:
  1. **Hook** (hero): "Swipe right on jobs. / We fill in the form." Shows the loop working in your hand (the phone).
  2. **The problem:** "Applying is a second job."
     - Show, don't tell: a pile of near-identical application form fragments (name, email, "Why us?") cascades and
       stacks as you scroll in, then a counter in the corner ticks the fields Asha would retype.
     - The counter is computed from the demo form's real field count × 5 applications, and labelled as such.
     - One line: "Same name, same answers, every form."
     - No invented statistics.
  3. **The turn:** "Try the whole thing." The five-step playable workflow is Asha's morning, from resume, to matches,
     to swipe, to the form filling itself, to handed off. This is the centrepiece.
  4. **Control:** "Or set a rule." Autopilot is Asha's rule and its timeline of real jobs that would clear it.
  5. **Trust:** "Pay, read from the posting." One real job's pay trace: click a step to light the source words. This
     answers "can I trust the numbers?".
  6. **Proof:** "See the jobs first." The live board by role × country, with Asha's row (Data engineer × India)
     highlighted.
  7. **Offer:** "Pay for what you send." Pricing.
  8. **Objections:** "Questions people ask." The FAQ.
  9. **Close:** "Your lane is open." The final CTA band; the lane line ends here in a lime arrow.
- **Rhythm:** alternate light and one dark chapter (Control) so the scroll has beats. Neighbouring chapters never
  share a layout.
- **Word budget:** still ≤ 230 words of marketing copy outside product fragments. The story is carried by the
  fragments and the lane, not by prose.

This section takes precedence over "Page, in order" below where they differ (the theme adds the Problem and Trust
chapters, renames the close and assigns Asha).

## Look

- **Light theme.**
  - Ground: warm off-white `#F7F6F2`. Surfaces: `#FFFFFF`.
  - Ink: `#13201A`; secondary ink `#55625B`.
  - Brand: lane green `#0F5C45` for primary buttons and the match ring; lime `#C6F19D` as a highlight only.
  - Signal yellow `#FACC15` for Needs-you and the undo bar. Pass red `#E5484D` used sparingly.
  - One dark surface type: ink `#13201A`, for toasts and the autopilot panel.
- **Type:** Overpass Variable. Display 64/68 desktop and 40/44 mobile, weight 800, tight tracking. Body 17/26. Four or
  five sizes.
- **Depth through real objects, not decoration:**
  - The phone has a frame, a soft large shadow and a slight perspective tilt that eases to flat on hover.
  - Floating notes have small shadows and a gentle 6–8 s float loop (paused under reduced motion and when off screen).
  - Cards sit on the phone screen with a contact shadow.
  - No gradient meshes, glass or glow blobs. One soft brand-tint circle behind the phone is fine.
- **Words:** about 200 words of marketing copy outside product fragments. No paragraphs longer than one sentence.
  Every section heading is six words or fewer.

## The job card (the owner called the old one "very bad"; get this right)

The card is 340px wide on desktop and full width minus 24px on phones. White, radius 20, 16px padding.
1. **Row 1:** a 40px company logo or monogram; the company (15/600) with location and work mode (13, secondary)
   under it; a 44px match ring on the right showing the % in tabular figures.
2. **Role:** 20/700, at most two lines.
3. **Pay:** 16/700 in lane green, normalised ("₹38–52 L / yr" or "$210–260K"). A tiny "from posting" tooltip trigger
   shows the source words.
4. **Chips:** at most 3 skill chips, quiet grey fill, 13px.
5. **"Why it fits" line** (one line, 14px, tinted panel): "Matches 7 of 8 requirements · pay above your floor". A
   missing skill is shown as "Kubernetes isn't on your resume".
6. **Optional Needs-you row,** signal yellow: "Needs you: notice period".

There are no other lines. No "posted 19h ago, San Francisco, California, United States" clutter: use short forms
("San Francisco · Onsite", "2h"). Details open on tap (a sheet inside the phone).

## Page, in order

1. **Hero** (100svh on desktop, light ground).
   - **Left:**
     - H1, 2 lines: **"Swipe right on jobs. / We fill in the form."**
     - Sub (one sentence): "Hirelane reads {117} career sites every six hours and drafts each application. You
       approve every one."
     - Primary **Try it now**, which scrolls to the workflow. Secondary link: **Browse {16,320} jobs**.
     - A **live timeline** of 3 rows that ticks in real time. It uses the freshest real job:
       - "{2h ago} · {Stripe} posted {Staff Engineer}"
       - "{now} · Matched you at 91%"
       - "Waiting for your swipe"
       The rows update when the phone acts.
   - **Right:** a **phone frame** running the real mini app, titled "Jobs · {12} in queue":
     - the job card stack (v3 swipe physics; drag or ✕ / ✓ buttons; A, P and U keys)
     - Approve opens a **"Ready to send" sheet** inside the phone with the fields filled from the sample resume and one
       Needs-you field with quick answers; then **Send**
     - then a dark toast: "Handed off to {Company} · #{n} this week · Undo" with a 4 s drain
     - the next card slides up
   - **Floating notes** around the phone, built from real data, honest, never fake events:
     - "{Groww} posted 12 min ago"
     - "Pay read from the posting"
     - "Needs you: visa?"
   - **Phone layout:** text first, then the phone at full width.
2. **The workflow (the centrepiece): "Try the whole thing."** A playable five-step flow, with a progress rail (step
   names, the current step lit) on the left on desktop and on top on mobile. Each step unlocks the next. "Skip to the
   next step" is always available. Steps:
   1. **Your resume:** drop a PDF (browser only, never uploaded) or press **Use a sample**. The parse animation pulls
      out name, roles and 6 skill chips.
   2. **Your matches:** cards *deal* in from the resume one by one, as a fan of 5 real jobs scored against the sample
      resume's skills. Each card shows its % and why.
   3. **Swipe:** the same card stack. A counter shows approved and passed.
   4. **The form fills itself:** a realistic employer application form (name, email, LinkedIn, resume version, 2
      questions).
      - The fields *type themselves* in sequence from the sample resume.
      - It pauses on a Needs-you question until the visitor picks an answer.
      - A side note says "Hirelane never guesses."
   5. **Handed off:** a summary ("3 approved · 2 passed · 1 question answered"), with Undo on the last one and
      **Start free** and **Browse jobs**.

   Reduced motion: no typing animation; the fields appear filled. Mobile is fully playable.
3. **Autopilot: "Or set a rule."** A dark ink panel. A min-match slider (shadcn) drives the real weekly figure from
   `/api/public/stats/autopilot`. Chips set role and per-day options. Next to it, a **timeline of real recent jobs**
   that would clear the rule ("2:04 · {Company} posted · drafted"), and one "Needs you" row. Label it "Paid plans ·
   coming soon".
4. **Live board: "See the jobs first."** Real counts by role family and country from the DB, for the top 5 roles ×
   top 4 countries, as a clean table with links into `/jobs?role=…&country=…`. Add quick links ("Software engineer
   jobs in India", and similar) as chips. This replaces the reference's testimonial row: **no testimonials**.
5. **Pricing:** two or three clean plan cards (Free, then Basic/Pro as one paid card with a plan switch) plus a "what
   it costs per application" note. Use the existing `pricing-model.ts`, INR/USD by Accept-Language, and "Planned
   prices. Checkout opens soon."
6. **FAQ: "Questions people ask."** 5 questions in a shadcn Accordion, short answers: never sends without you; where
   jobs come from; Needs-you; pay honesty; your data.
7. **Final CTA band** in lane green: "Your next job is already posted." and **Try it now** / **Start free**.
8. **Footer:** the v2 site footer is fine here (columns), restyled to the light theme. Add the line "Road photos" only
   if any photo is used.

## Honesty (binding)

- Real jobs and live counts only. The sample resume is labelled "Sample resume".
- The demo never sends anything (tests assert no non-GET requests).
- No testimonials, mascot, invented interviews or replies.
- Floating notes show real data or product facts.
- No competitor names, copy or colours.

## Gates

1. **ui-ux-pro-max pre-delivery checklist:** contrast, 44px targets, keyboard, focus, reduced motion,
   375/768/1024/1440, no horizontal scroll.
2. **Word count:** ≤ 230 words of marketing copy outside product fragments.
3. **Screenshots** at 1440 and 390 of every section and every workflow step, plus the phone loop
   (card → sheet → toast → next card).
   - The card must look polished and uncluttered.
   - The first screen must read as "an app you can use right now".
4. **Verification:** axe 0 serious. `pnpm verify` green. Landing e2e rewritten for v4 (hero phone loop, all five
   workflow steps by mouse, touch and keyboard, no network on approve or send, reduced motion) green on both
   projects.
