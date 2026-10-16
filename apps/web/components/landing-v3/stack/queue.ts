/**
 * The swipe queue as a reducer: which card is on top, what was decided, the undo window and the Needs-you gate.
 * Pure, so the rules (gate, undo, end-of-queue tallies) are tested without a browser.
 */
import type { Decision } from "./physics";

export type Decided = { slug: string; kind: Decision; index: number };

export type QueueState = {
  index: number;
  total: number;
  /** Decisions still standing, oldest first. Undone decisions are removed. */
  decided: Decided[];
  /** The newest decision, while its 4 s undo window is open. */
  undoable: (Decided & { id: number }) | null;
  /** Answers to Needs-you fields, by card slug. Never sent anywhere. */
  answers: Record<string, string>;
  /** Bumps each time an approve is refused for an unanswered Needs-you field. */
  gate: { slug: string; nonce: number } | null;
  /** Which way the last card left, so the exit and the undo entrance match. */
  lastExit: Decision | null;
  nextId: number;
};

export type QueueAction =
  | { type: "decide"; kind: Decision; needsAnswer: boolean }
  | { type: "undo" }
  | { type: "expire"; id: number }
  | { type: "answer"; slug: string; value: string }
  | { type: "restart" };

export const initialQueue = (total: number): QueueState => ({
  index: 0,
  total,
  decided: [],
  undoable: null,
  answers: {},
  gate: null,
  lastExit: null,
  nextId: 1,
});

/** The slug the reducer should treat as on top, given the cards. */
export function reduceQueue(state: QueueState, action: QueueAction, slugs: readonly string[]): QueueState {
  switch (action.type) {
    case "decide": {
      const slug = slugs[state.index];
      if (slug === undefined) return state;
      if (action.kind === "approve" && action.needsAnswer && !state.answers[slug]) {
        return { ...state, gate: { slug, nonce: (state.gate?.nonce ?? 0) + 1 } };
      }
      const d: Decided = { slug, kind: action.kind, index: state.index };
      return {
        ...state,
        index: state.index + 1,
        decided: [...state.decided, d],
        undoable: { ...d, id: state.nextId },
        nextId: state.nextId + 1,
        gate: null,
        lastExit: action.kind,
      };
    }
    case "undo": {
      const u = state.undoable;
      if (!u) return state;
      return {
        ...state,
        index: u.index,
        decided: state.decided.filter((d) => !(d.index === u.index && d.kind === u.kind)),
        undoable: null,
        gate: null,
        lastExit: u.kind,
      };
    }
    case "expire":
      return state.undoable?.id === action.id ? { ...state, undoable: null } : state;
    case "answer":
      return { ...state, answers: { ...state.answers, [action.slug]: action.value }, gate: state.gate?.slug === action.slug ? null : state.gate };
    case "restart":
      return initialQueue(state.total);
  }
}

export const isDone = (s: QueueState): boolean => s.total > 0 && s.index >= s.total;

export function tally(s: QueueState): { decided: number; approved: number; passed: number } {
  const approved = s.decided.filter((d) => d.kind === "approve").length;
  return { decided: s.decided.length, approved, passed: s.decided.length - approved };
}

/** "That's today's queue. 8 decided: 5 approved, 3 passed." */
export function endLine(s: QueueState): string {
  const t = tally(s);
  return `That's today's queue. ${t.decided} decided: ${t.approved} approved, ${t.passed} passed.`;
}

export function undoLabel(kind: Decision, company: string, secondsLeft: number): string {
  return kind === "approve" ? `Sending to ${company} in ${secondsLeft.toFixed(1)}s` : "Passed";
}

/** Text for the aria-live region. */
export function announce(kind: Decision, title: string, company: string): string {
  return kind === "approve"
    ? `Approved ${title} at ${company}. Sending in 4 seconds. Press U to undo.`
    : `Passed ${title} at ${company}. Press U to undo.`;
}
