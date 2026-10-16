"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_MIN, parsePerWeek, RULE_DEBOUNCE_MS, ruleUrl, SAMPLE_ROLE } from "./rule-model";

/**
 * Slider and role chip -> live weekly matches. Debounced, the previous request is aborted, and the last good
 * number stays on screen when a request fails. The server number is for the default rule, so nothing is fetched
 * until the rule differs from it.
 */
export function useAutopilotRule(initial: number | null) {
  const [min, setMin] = useState(DEFAULT_MIN);
  const [role, setRole] = useState<string | null>(SAMPLE_ROLE);
  const [perWeek, setPerWeek] = useState<number | null>(initial);
  const [pending, setPending] = useState(false);
  const initialRef = useRef(initial);

  useEffect(() => {
    if (initialRef.current !== null && min === DEFAULT_MIN && role === SAMPLE_ROLE) {
      setPerWeek(initialRef.current);
      setPending(false);
      return;
    }
    const ctl = new AbortController();
    setPending(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(ruleUrl(min, role), { signal: ctl.signal, headers: { accept: "application/json" } });
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
  }, [min, role]);

  return { min, setMin, role, setRole, perWeek, pending };
}
