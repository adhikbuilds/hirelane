"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { initialQueue, isDone, reduceQueue, tally, type QueueState } from "../../landing-v3/stack/queue";
import type { Decision } from "../../landing-v3/stack/physics";
import type { DeckExit } from "./swipe-deck";
import type { V4Card } from "./model";

export const UNDO_MS = 4000;

export type DeckListener = {
  onDecide?: (kind: Decision, card: V4Card, approvedSoFar: number) => void;
  onUndo?: (kind: Decision, card: V4Card) => void;
};

/**
 * The queue behind a deck: which card is on top, what was decided, the 4 s undo window. Pure rules live in the v3
 * `queue.ts` reducer; this hook adds the timer and the exit direction. It never touches the network.
 */
export function useDeckQueue(cards: readonly V4Card[], listener?: DeckListener) {
  const slugs = useMemo(() => cards.map((c) => c.slug), [cards]);
  const [state, dispatch] = useReducer((s: QueueState, a: Parameters<typeof reduceQueue>[1]) => reduceQueue(s, a, slugs), cards.length, initialQueue);
  const stateRef = useRef(state);
  stateRef.current = state;
  const lis = useRef(listener);
  lis.current = listener;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [exit, setExit] = useState<DeckExit>({ kind: "approve", vx: 0 });
  const [entry, setEntry] = useState<{ slug: string; from: Decision } | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const commit = useCallback(
    (kind: Decision, vx = 0): V4Card | null => {
      const s = stateRef.current;
      const card = cards[s.index];
      if (!card) return null;
      setExit({ kind, vx });
      setEntry(null);
      dispatch({ type: "decide", kind, needsAnswer: false });
      if (timer.current) clearTimeout(timer.current);
      const id = s.nextId;
      timer.current = setTimeout(() => dispatch({ type: "expire", id }), UNDO_MS);
      const approved = tally(s).approved + (kind === "approve" ? 1 : 0);
      lis.current?.onDecide?.(kind, card, approved);
      return card;
    },
    [cards],
  );

  const undo = useCallback(() => {
    const u = stateRef.current.undoable;
    if (!u) return;
    if (timer.current) clearTimeout(timer.current);
    setEntry({ slug: u.slug, from: u.kind });
    dispatch({ type: "undo" });
    const card = cards[u.index];
    if (card) lis.current?.onUndo?.(u.kind, card);
  }, [cards]);

  const restart = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setEntry(null);
    dispatch({ type: "restart" });
  }, []);

  return {
    state,
    remaining: useMemo(() => cards.slice(state.index), [cards, state.index]),
    done: isDone(state),
    tally: tally(state),
    undoable: state.undoable,
    exit,
    entry,
    commit,
    undo,
    restart,
  };
}
