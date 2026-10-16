import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The phone: a dark bezel, a soft large shadow and a slight perspective tilt that eases flat on hover (only where
 * hover exists, and never under reduced motion). The screen is `relative overflow-hidden`, so sheets stay inside it.
 */
export function PhoneFrame({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  return (
    <div className={cn("relative mx-auto w-full max-w-[392px] [perspective:1600px]", className)}>
      {/* One soft brand-tint circle behind the phone. */}
      <div aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 -z-10 size-[120%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#E3EFE4]" />
      <div
        role="group"
        aria-label={label}
        data-testid="phone"
        className={cn(
          "relative rounded-[46px] bg-[#13201A] p-[9px] shadow-[0_2px_4px_rgb(19_32_26/0.18),0_40px_80px_-20px_rgb(19_32_26/0.45),0_90px_120px_-40px_rgb(19_32_26/0.3)]",
          "transition-transform duration-700 ease-out motion-safe:[transform:rotateY(-9deg)_rotateX(3deg)_rotateZ(0.6deg)] motion-safe:[@media(hover:hover)]:hover:[transform:none]",
        )}
      >
        <div data-testid="phone-screen" className="relative flex h-[640px] flex-col overflow-hidden rounded-[38px] bg-[#F7F6F2] text-[#13201A]">
          <div aria-hidden className="mx-auto mt-2 h-[22px] w-[84px] shrink-0 rounded-full bg-[#13201A]" />
          {children}
        </div>
      </div>
    </div>
  );
}
