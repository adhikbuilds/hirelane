"use client";

import { useEffect, useRef, useState } from "react";
import { Ic } from "./Icon";

/** Copies text to the clipboard and says so. Falls back to a hidden textarea where the async clipboard is blocked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const t = document.createElement("textarea");
      t.value = text;
      t.setAttribute("readonly", "");
      t.style.position = "fixed";
      t.style.opacity = "0";
      document.body.appendChild(t);
      t.select();
      const ok = document.execCommand("copy");
      t.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function CopyButton({ text, label = "Copy", done = "Copied", aria, small = true, onCopied, icon = true }: { text: string; label?: string; done?: string; aria?: string; small?: boolean; onCopied?: () => void; icon?: boolean }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (t.current) clearTimeout(t.current);
    },
    [],
  );
  return (
    <button
      type="button"
      className={`st-btn${small ? " st-sm" : ""}${state === "ok" ? " st-copy-ok" : ""}`}
      aria-label={aria ?? `${label} ${text.length > 24 ? "" : text}`.trim()}
      onClick={async () => {
        const ok = await copyText(text);
        setState(ok ? "ok" : "fail");
        if (ok) onCopied?.();
        if (t.current) clearTimeout(t.current);
        t.current = setTimeout(() => setState("idle"), 2000);
      }}
    >
      {state === "ok" ? null : icon ? <Ic name="copy" small /> : null}
      <span aria-live="polite">{state === "ok" ? done : state === "fail" ? "Select and copy" : label}</span>
    </button>
  );
}

/** A small icon-only copy button (the apply address on a receipt). */
export function CopyIcon({ text, aria }: { text: string; aria: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="st-cp"
      aria-label={ok ? "Copied" : aria}
      onClick={async () => {
        setOk(await copyText(text));
        setTimeout(() => setOk(false), 2000);
      }}
    >
      <Ic name={ok ? "check" : "copy"} small />
    </button>
  );
}
