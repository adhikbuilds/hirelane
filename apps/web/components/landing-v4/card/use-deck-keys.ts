"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";

/** Keystrokes aimed at a text field, slider or menu belong to that control, never to a deck. */
export function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !("tagName" in el)) return false;
  if (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return true;
  const role = el.getAttribute("role");
  return role === "slider" || role === "combobox" || role === "radio" || role === "textbox" || role === "switch";
}

/** How much of each mounted deck is on screen. Only the most visible deck answers a key aimed at the page. */
const visibility = new Map<string, number>();
const MIN_VISIBLE = 0.35;

export function mostVisible(id: string): boolean {
  const mine = visibility.get(id) ?? 0;
  if (mine < MIN_VISIBLE) return false;
  for (const [other, v] of visibility) if (other !== id && v > mine) return false;
  return true;
}

export type DeckKeyHandlers = { approve: () => void; pass: () => void; undo: () => void; open: () => void };

/**
 * A, P and U (and the arrow keys) for one deck. A key pressed while focus is inside the deck always goes to it;
 * a key pressed anywhere else goes to the single most visible deck, so two decks on one page never both react.
 */
export function useDeckKeys(rootRef: RefObject<HTMLElement | null>, enabled: boolean, handlers: DeckKeyHandlers): { id: string; visible: number } {
  const id = useId();
  const [visible, setVisible] = useState(0);
  const h = useRef(handlers);
  h.current = handlers;

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const r = entries[entries.length - 1]?.intersectionRatio ?? 0;
        visibility.set(id, r);
        setVisible(r);
      },
      { threshold: [0, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 1] },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      visibility.delete(id);
    };
  }, [id, rootRef]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!enabled || e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping(e.target)) return;
      const within = rootRef.current?.contains(e.target as Node) ?? false;
      const lower = e.key.toLowerCase();
      if (e.key === " " || e.key === "Enter") {
        const el = e.target as HTMLElement;
        if (!within || el.closest("button,a,input")) return;
        e.preventDefault();
        h.current.open();
        return;
      }
      if (!within && !mostVisible(id)) return;
      if (lower === "a" || e.key === "ArrowRight") {
        e.preventDefault();
        h.current.approve();
      } else if (lower === "p" || e.key === "ArrowLeft") {
        e.preventDefault();
        h.current.pass();
      } else if (lower === "u") {
        e.preventDefault();
        h.current.undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, id, rootRef]);

  return { id, visible };
}
