import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonClasses } from "../ui";
import { ResumeDrop } from "./resume-drop";

export function ClosingCta() {
  return (
    <section aria-labelledby="cta-h" className="bg-canvas px-4 pb-20 pt-4 sm:px-8 sm:pb-28" data-testid="closing-cta">
      <div className="relative mx-auto grid max-w-page grid-cols-[minmax(0,1fr)] items-center gap-10 overflow-hidden rounded-[28px] bg-lane px-6 py-12 text-white shadow-pop sm:px-12 sm:py-16 lg:grid-cols-[1.1fr_0.9fr]">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-[360px] rounded-full bg-match/30 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ backgroundImage: "repeating-linear-gradient(135deg, rgb(255 255 255 / 0.05) 0 1px, transparent 1px 14px)" }} />
        <div className="relative">
          <h2 id="cta-h" className="display text-[34px] leading-[1.06] sm:text-[48px]">
            Your next application is one approval away.
          </h2>
          <p className="mt-4 max-w-[48ch] text-[17px] leading-[27px] text-white/80">
            Ten applications are free, with no card. You see every draft, answer every question it cannot, and approve each one yourself.
          </p>
          <Link href="/signup" className={buttonClasses("signal", "lg", "mt-7")}>
            Start free
            <ArrowRight aria-hidden className="size-5" />
          </Link>
        </div>
        <div className="relative">
          <div className="rounded-[20px] bg-surface p-2.5 shadow-pop">
            <ResumeDrop compact />
          </div>
        </div>
      </div>
    </section>
  );
}
