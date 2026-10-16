import type { ReactNode } from "react";
import { cn } from "./cn";

export type MarqueeProps = {
  /** One element per entry; links inside stay keyboard reachable. */
  children: ReactNode[];
  /** Seconds each item adds to one full loop (default 4), so long lists do not race. */
  secondsPerItem?: number;
  label: string;
  className?: string;
};

/**
 * A looping ticker. It pauses on hover and on keyboard focus (CSS), and under reduced motion it becomes a static,
 * scrollable row with the duplicate hidden. The second copy is aria-hidden and unfocusable so assistive tech reads each item once.
 */
export function Marquee({ children, secondsPerItem = 4, label, className }: MarqueeProps) {
  const duration = Math.max(20, children.length * secondsPerItem);
  const copy = (hidden: boolean) => (
    <ul
      className="marquee-copy flex shrink-0 items-center gap-3 pr-3"
      aria-hidden={hidden || undefined}
      inert={hidden}
    >
      {children.map((c, i) => (
        <li key={i} className="shrink-0">
          {c}
        </li>
      ))}
    </ul>
  );
  return (
    <div
      role="region"
      aria-label={label}
      className={cn(
        "marquee overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_6%,#000_94%,transparent)]",
        className,
      )}
    >
      <div className="marquee-track flex w-max" style={{ ["--marquee-duration" as string]: `${duration}s` }}>
        {copy(false)}
        {copy(true)}
      </div>
    </div>
  );
}
