"use client";

import { useEffect } from "react";
import { isTypingTarget, nextIndex } from "./keys";

/** Attaches the board keys. Rows expose their link as [data-row-link]; the search box has id="board-q". */
export function LedgerKeys() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target as HTMLElement | null)) return;
      if (e.key === "/") {
        const q = document.getElementById("board-q");
        if (q) {
          e.preventDefault();
          q.focus();
        }
        return;
      }
      if (e.key !== "j" && e.key !== "k") return;
      const links = Array.from(document.querySelectorAll<HTMLElement>("[data-row-link]"));
      const current = links.findIndex((l) => l === document.activeElement);
      const idx = nextIndex(current, e.key, links.length);
      if (idx < 0) return;
      e.preventDefault();
      links[idx]!.focus();
      links[idx]!.scrollIntoView({ block: "nearest" });
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
