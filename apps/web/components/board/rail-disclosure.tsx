"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Filters are always open from lg up; below that they fold into a disclosure that starts closed. */
export function RailDisclosure({ summary, children }: { summary: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 64rem)");
    const sync = () => {
      if (ref.current) ref.current.open = mq.matches;
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return (
    <details ref={ref} open className="group">
      <summary className="flex h-11 cursor-pointer items-center justify-between border-y border-rule px-1 text-[15px] font-semibold lg:hidden">
        {summary}
        <span className="text-[13px] font-normal text-ink-3 group-open:hidden">Show</span>
        <span className="hidden text-[13px] font-normal text-ink-3 group-open:inline">Hide</span>
      </summary>
      {children}
    </details>
  );
}
