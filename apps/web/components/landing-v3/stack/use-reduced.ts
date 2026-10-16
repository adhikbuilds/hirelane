"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * `prefers-reduced-motion`, safe for hydration: the server and the first client render both say `false`, then the
 * real value arrives in the next render. (motion's own hook reads the media query during the first client render, which
 * makes server and client markup differ for people who have reduced motion on.)
 */
export function useReduced(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(QUERY);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
