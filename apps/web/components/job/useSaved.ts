"use client";

import { useCallback, useSyncExternalStore } from "react";

export const SAVED_KEY = "hirelane:saved-jobs";
const EVENT = "hirelane:saved-change";

export function readSaved(storage: Pick<Storage, "getItem"> = window.localStorage): string[] {
  try {
    const v: unknown = JSON.parse(storage.getItem(SAVED_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function toggleSaved(slug: string, storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage): boolean {
  const cur = readSaved(storage);
  const next = cur.includes(slug) ? cur.filter((s) => s !== slug) : [slug, ...cur].slice(0, 200);
  try {
    storage.setItem(SAVED_KEY, JSON.stringify(next));
  } catch {
    /* storage full or blocked: the save simply does not persist */
  }
  window.dispatchEvent(new Event(EVENT));
  return next.includes(slug);
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** Local-only save state for one job, hydration safe (false on the server). */
export function useSaved(slug: string): [boolean, () => void] {
  const saved = useSyncExternalStore(
    subscribe,
    () => readSaved().includes(slug),
    () => false,
  );
  const toggle = useCallback(() => void toggleSaved(slug), [slug]);
  return [saved, toggle];
}
