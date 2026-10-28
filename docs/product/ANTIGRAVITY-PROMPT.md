You are building the Hirelane mobile-first app screens in ~/hirelane (Next.js 15 App Router, React 19, TypeScript strict, Tailwind v4, shadcn/ui, motion, lucide-react; pnpm; dev server on :3001; Postgres on :5433).

READ FIRST, IN THIS ORDER (don't skip):
1. ~/hirelane/CLAUDE.md: house rules. Its legal and privacy rules bind you; ignore its agent roster.
2. ~/hirelane/docs/product/FINAL-PRD.md: §3 requirements, §4 screen list, §5 non-functional requirements.
3. ~/hirelane/docs/mocks/README.md, then open these in the browser and study every state:
   - docs/mocks/genz-a-detail.html: the spec for the 10 screens
   - docs/mocks/genz-a-hubs-states.html
   - docs/mocks/genz-a-swipe.html
   - docs/mocks/genz-a-more.html
   Rejected, never copy: app-refined.html, genz-photo-led.html, genz-a-hubs-detail.html.
4. Skills (plain markdown in ~/hirelane/.claude/skills/<name>/SKILL.md; read them and follow them):
   - ui-ux-pro-max: interaction, mobile, accessibility and stack rules
   - design-system: build ONE three-layer token system (primitive → semantic → component)
   - shadcn and ui-styling: components, built on the existing components.json
   - fixing-accessibility: run it on every screen before you call it done
   - fixing-motion-performance: run it on the swipe stack and every animation
   - high-end-visual-design: use only its craft rules (spacing, shadows, states). Do NOT adopt its palette or "premium" look; the brand is Wrapped.
   - design-taste-frontend and landing-page: only for the landing page, not app screens.

THE LOOK (approved, non-negotiable): "Wrapped"
- Font: Bricolage Grotesque, 800 for display and 500 for body.
- Tokens: ink #0B0B0F, lane #0F5C45, lime #C8FF3D, pink #FF4FA3, blue #3D5AFE, sun #FFC83D, cream #FFF6E8.
- Bold colour blocks that change per card or section; giant numbers as graphics; APPLY/SKIP stamps; tilted card stacks; story bars; a recap card.
- Photos small and supporting, never full-bleed.
- Detail density matches genz-a-detail. Every card carries:
  - a source and freshness line ("Rubrik careers page · read 2h ago")
  - the match maths (✓ with the posting's words, ✕ said plainly)
  - an honest pay line ("Pay not in the posting · we never guess")
  - timestamped activity rows
  - a 4-second undo ring
- No soft-skill chips (Collaboration, Communication…).
- Contrast: no text under 18px in a colour on pink or lime. Use ink or white.

WHAT TO BUILD (FINAL-PRD §4, R1 screens):
- Tabs: Home · Discover · Companies · Tracker · You
- Screens:
  1. Home
  2. Picks: rest, drag-right with APPLY, drag-left with SKIP plus a 1-tap reason
  3. Check before hand-off: answers with their sources, Needs-you in pink, resume swap
  4. Hand-off plus undo
  5. Job detail
  6. Company
  7. Discover: search with live counts, filter bottom sheet
  8. Tracker with a timeline
  9. You: rules, resumes, pause, "What Hirelane never does"
  10. Weekly recap
  11. Onboarding: resume → preferences → rules
- Put them under a preview route group: apps/web/app/(app-preview)/...
  - Each page shows a small "Preview · sample data" badge.
  - Not linked from the public nav.
  - noindex.

DATA (important: most of the backend doesn't exist yet):
- Real data where it exists: jobs and companies through the existing query layer in apps/web/lib/queries/* (read it first). Use real roles, real pay (only when stated), real freshness.
- Everything user-specific (profile, matches, answers, tracker, recap, streak) comes from typed fixtures in apps/web/lib/preview/fixtures.ts behind ONE interface, apps/web/lib/preview/data.ts. That way the real API replaces it later without touching components.
- Asha Iyer (BITS Pilani CS '26) is the labelled sample user.
- Do not add database tables, migrations, API routes or server actions. Do not touch packages/* or workers/*.

INTERACTION AND QUALITY BARS:
- Gestures, each with a visible button:
  - swipe right = get ready
  - swipe left = skip
  - tap = details
  - long-press = save
- Keyboard: arrows plus Space. NO single-letter global shortcuts (WCAG 2.1.4).
- Motion:
  - spring physics on the stack
  - the stamp locks at ⅔ of the drag
  - the ✓ button swells
  - small confetti on hand-off
  - everything respects prefers-reduced-motion
  - animate transform and opacity only
- Must pass:
  - 390×844 and 360×800 with no horizontal overflow
  - tap targets ≥ 44px
  - safe-area insets
  - Lighthouse mobile performance ≥ 85 and accessibility ≥ 95 on each screen
  - axe: 0 serious or critical
- Components are written so they could port to React Native later: no hover-only behaviour, gesture-first.
- Copy: short, casual, honest. Never claim Hirelane submits, guesses pay or invents answers. The user always submits on the employer's own site.

PROCESS:
- Work on a new git branch: feat/app-preview-screens. Don't commit to main. Don't push.
- Build in this order: tokens and primitives → pick card plus stack → Home → Check → Hand-off → Job → Company → Discover → Tracker → You → Recap → Onboarding.
- After each screen:
  1. open it in the browser at 390×844
  2. screenshot it
  3. compare it side by side with the matching mock state
  4. list the differences and fix them
  5. save the final shot to docs/screens/preview/<screen>.png
- Tests:
  - vitest plus Testing Library for components (stack gestures through buttons, undo timer, Needs-you blocking)
  - a Playwright spec in e2e/preview.spec.ts for the 390px overflow and axe checks
  - `pnpm --filter @hirelane/web test` and typecheck must be green (ignore pre-existing stale .next/types errors, but report them)
- Use only the libraries already in apps/web/package.json. Ask before adding any dependency.
- Commit at each screen with a conventional message (feat(web): ...). No AI attribution lines in commits.

WHEN DONE, report:
- a table of screen → route → screenshot path → mock it matches → known gaps
- every place where real data was missing, and what you used instead
- test and Lighthouse results, quoted, not summarised
