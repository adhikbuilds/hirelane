import { ArrowRight } from "lucide-react";
import { Chapter } from "./chapter";
import { BROWSE_HREF, WORKFLOW_HREF } from "./links";
import { Reveal } from "./reveal";

const btn = "inline-flex h-14 items-center justify-center gap-2 rounded-full px-8 text-[18px] font-bold outline-none transition-[background-color,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[0.97]";

/** Chapter 9, the close. The lane line ends in a lime arrow just above this band. */
export function FinalCta() {
  return (
    <Chapter id="start" chapter="Your lane" label="Get started" className="!pb-24 !pt-28">
      <Reveal>
        <div className="relative overflow-hidden rounded-[36px] bg-primary px-8 py-16 text-center text-primary-foreground shadow-[0_40px_80px_-36px_rgb(15_92_69/.7)] md:px-16 md:py-24">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-8 mx-auto h-[2px] w-24 bg-[repeating-linear-gradient(90deg,var(--lime)_0_10px,transparent_10px_20px)]" />
          <h2 className="mx-auto max-w-[14ch] text-[clamp(40px,6vw,72px)] font-extrabold leading-[1] tracking-[-0.035em] text-balance">Your lane is open.</h2>
          <p className="mx-auto mt-5 max-w-[34ch] text-[19px] leading-7 text-primary-foreground/85">Your next job is already posted.</p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <a href={WORKFLOW_HREF} className={`${btn} bg-[var(--lime)] text-[#13201a] hover:bg-[#d6f6b4]`}>
              Try it now <ArrowRight aria-hidden className="size-5" />
            </a>
            <a href={BROWSE_HREF} className={`${btn} bg-white/12 text-white ring-1 ring-white/30 hover:bg-white/20`}>
              Start free
            </a>
          </div>
        </div>
      </Reveal>
    </Chapter>
  );
}
