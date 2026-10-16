import type { ReactNode } from "react";
import { cn } from "../ui";

export function SectionHeading({
  eyebrow,
  title,
  children,
  tone = "light",
  className,
  id,
}: {
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
  tone?: "light" | "dark";
  className?: string;
  id?: string;
}) {
  const dark = tone === "dark";
  return (
    <div className={cn("max-w-[720px]", className)}>
      <p className={cn("text-[13px] font-extrabold tracking-[0.02em]", dark ? "text-match" : "text-lane")}>{eyebrow}</p>
      <h2 id={id} className={cn("display mt-2 text-[32px] leading-[1.08] sm:text-[44px]", dark ? "text-white" : "text-ink")}>
        {title}
      </h2>
      {children && <p className={cn("mt-4 text-[17px] leading-[27px]", dark ? "text-white/75" : "text-ink-2")}>{children}</p>}
    </div>
  );
}
