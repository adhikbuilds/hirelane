/** The four tour stages. Headings are six words or fewer; there is no other copy. */
export const TOUR_STAGES = [
  { id: "maths", heading: "Every match shows its maths." },
  { id: "pay", heading: "Pay, read from the posting." },
  { id: "asks", heading: "It asks. It never guesses." },
  { id: "undo", heading: "4 seconds to change your mind." },
] as const;

export type TourStage = 0 | 1 | 2 | 3;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Where the scroll is, as stage and progress inside it. `p` is 0..1 over the whole pinned run. */
export function tourAt(p: number): { stage: TourStage; local: number; started: boolean } {
  const v = Number.isFinite(p) ? clamp(p, 0, 1) : 0;
  const stage = Math.min(3, Math.floor(v * 4)) as TourStage;
  return { stage, local: clamp(v * 4 - stage, 0, 1), started: v > 0.01 };
}

/** The Needs-you answer lands this far into the third stage. */
export const ANSWER_AT = 0.45;
/** The undo bar has drained by this share of its stage and the toast takes over. */
export const HANDOFF_AT = 0.93;

export type TourFrame = { answered: boolean; handed: boolean; secondsLeft: number };

/** What the card shows at a point in the tour. Seconds count 4.0 down to 0.0 across stage 4. */
export function frameAt(stage: TourStage, local: number): TourFrame {
  const answered = stage > 2 || (stage === 2 && local >= ANSWER_AT);
  const drained = stage === 3 ? clamp(local / HANDOFF_AT, 0, 1) : 0;
  return {
    answered,
    handed: stage === 3 && local >= HANDOFF_AT,
    secondsLeft: Math.round(4 * (1 - drained) * 10) / 10,
  };
}

export type LitWindow = { before: string; lit: string; after: string; source: string };

const WINDOW = 70;

/**
 * A short slice of a real posting with the words that gave the pay lit: the first step that quotes the posting text.
 * The offsets are the ones `buildTraceDemo` already verified against the stored description, so the lit words are
 * exactly what the posting says. Returns null when no step points at text.
 */
export function litWindow(trace: { excerpt: string; company: string; title: string; steps: readonly { span: { start: number; end: number } | null }[] } | null): LitWindow | null {
  if (!trace) return null;
  const step = trace.steps.find((s) => s.span && s.span.end > s.span.start && s.span.end <= trace.excerpt.length);
  if (!step?.span) return null;
  const { start, end } = step.span;
  const from = Math.max(0, start - WINDOW);
  const to = Math.min(trace.excerpt.length, end + WINDOW);
  const clip = (t: string) => t.replace(/\s+/g, " ");
  return {
    before: (from > 0 ? "\u2026" : "") + clip(trace.excerpt.slice(from, start)),
    lit: clip(trace.excerpt.slice(start, end)),
    after: clip(trace.excerpt.slice(end, to)) + (to < trace.excerpt.length ? "\u2026" : ""),
    source: `${trace.company}, ${trace.title}`,
  };
}
