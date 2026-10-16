import type { HTMLAttributes } from "react";
import { cn } from "./cn";

/** A shimmering placeholder block. Decorative: hidden from assistive tech. */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("skeleton rounded-[8px]", className)} {...rest} />;
}

/** Stacked text-line placeholders; the last line is shorter. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2.5", className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3.5", i === lines - 1 && lines > 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

/** Wrapper that tells screen readers something is loading, once. */
export function LoadingRegion({ label = "Loading", children, className }: { label?: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
