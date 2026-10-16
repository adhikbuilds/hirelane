import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  /** Lifts on hover; use for whole-card links and selectable rows. */
  interactive?: boolean;
  /** Flat border only, no shadow. */
  flat?: boolean;
  /** Left rule in signal yellow: the "Needs you" marker. */
  needsYou?: boolean;
  padded?: boolean;
};

export function Card({ interactive, flat, needsYou, padded = true, className, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "relative rounded-[16px] border border-line bg-surface",
        !flat && "shadow-card",
        padded && "p-5 sm:p-6",
        interactive &&
          "transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-lane/30 hover:shadow-pop",
        needsYou && "border-l-4 border-l-signal",
        className,
      )}
      {...rest}
    />
  );
}
