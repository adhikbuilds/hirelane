"use client";

import { useEffect, useRef, useState } from "react";

export const DEFAULT_MIN = 70;
export const RULE_DEBOUNCE_MS = 300;

/** Only `min` is sent: the route is strict and rejects unknown parameters. */
export function ruleUrl(min: number): string {
  const m = Math.min(100, Math.max(0, Math.round(Number.isFinite(min) ? min : DEFAULT_MIN)));
  return `/api/public/stats/autopilot?min=${m}`;
}

export function parsePerWeek(body: unknown): number | null {
  if (typeof body !== "object" || body === null) return null;
  const v = (body as { perWeek?: unknown }).perWeek;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

/**
 * Slider value -> live weekly matches. Debounced, the previous request is aborted, and the last good number stays
 * on screen when a request fails. The server-rendered number is for `initialMin`, so nothing is fetched on mount.
 */
export function useAutopilotRate(initial: number | null, initialMin = DEFAULT_MIN) {
  const [min, setMin] = useState(initialMin);
  const [perWeek, setPerWeek] = useState<number | null>(initial);
  const [pending, setPending] = useState(false);
  const first = useRef(initial !== null);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const ctl = new AbortController();
    setPending(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(ruleUrl(min), { signal: ctl.signal, headers: { accept: "application/json" } });
        if (!res.ok) return;
        const n = parsePerWeek(await res.json());
        if (n !== null && !ctl.signal.aborted) setPerWeek(n);
      } catch {
        /* aborted or offline: keep the last value */
      } finally {
        if (!ctl.signal.aborted) setPending(false);
      }
    }, RULE_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [min]);

  return { min, setMin, perWeek, pending };
}
