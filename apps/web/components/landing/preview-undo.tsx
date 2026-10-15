"use client";

import { useEffect, useState } from "react";
import { UNDO_MS } from "./model";

const HOLD_MS = 2500;
const TICK_MS = 100;

/**
 * Approve bar for the preview: a 4px signal bar draining linearly over 4 seconds plus a tabular countdown.
 * It replays so the preview can be read at any time. With reduced motion the bar is hidden and only the number shows.
 */
export function PreviewUndo() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => (e + TICK_MS >= UNDO_MS + HOLD_MS ? 0 : e + TICK_MS)), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const left = Math.max(0, UNDO_MS - elapsed);
  const open = left > 0;
  return (
    <div data-testid="undo-bar">
      <div className="h-1 w-full bg-rule motion-reduce:hidden" aria-hidden="true">
        <div
          className="h-1 bg-signal"
          style={{ width: `${(left / UNDO_MS) * 100}%`, transition: `width ${TICK_MS}ms linear` }}
        />
      </div>
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <p className="text-[15px]">
          {open ? (
            <>
              Approved. You can undo for <span className="figure font-semibold bg-signal px-1 text-ink">{(left / 1000).toFixed(1)} s</span>
            </>
          ) : (
            "Handed off. Your resume and answers are ready on the employer's own form."
          )}
        </p>
        <span className="text-[13px] text-ink-2 hidden sm:inline">
          Press <kbd className="font-semibold">U</kbd> or <kbd className="font-semibold">Esc</kbd> to undo
        </span>
      </div>
    </div>
  );
}
