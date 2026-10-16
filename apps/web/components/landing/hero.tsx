import { ShieldCheck } from "lucide-react";
import { DemoStack } from "./demo-stack";
import { LiveCounts } from "./live-counts";
import { ResumeDrop } from "./resume-drop";
import type { LandingSnapshot } from "./types";

export function Hero({ snapshot, now }: { snapshot: LandingSnapshot; now: Date }) {
  const { counts, demo } = snapshot;
  return (
    <section className="hero-mesh relative overflow-x-clip" aria-labelledby="hero-h">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-100 [mask-image:linear-gradient(180deg,#000,transparent_85%)]">
        <div className="absolute inset-0" style={{ backgroundImage: "repeating-linear-gradient(135deg, rgb(15 92 69 / 0.05) 0 1px, transparent 1px 14px)" }} />
      </div>
      <div className="relative mx-auto grid w-full max-w-page grid-cols-[minmax(0,1fr)] items-start gap-12 px-4 pb-16 pt-16 sm:px-8 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)] lg:gap-10 lg:pb-24 lg:pt-20">
        <div>
          <p className="inline-flex h-8 items-center gap-2 rounded-full border border-lane-100 bg-surface/80 px-3 text-[13px] font-bold text-lane shadow-control backdrop-blur">
            <ShieldCheck aria-hidden className="size-4" />
            You approve every application
          </p>
          <h1 id="hero-h" className="display-hero mt-5 text-ink [text-wrap:balance]">
            Apply to the right jobs while you sleep. <span className="text-lane">You approve every one.</span>
          </h1>
          <p className="mt-5 max-w-[56ch] text-[17px] leading-[27px] text-ink-2 sm:text-[18px] sm:leading-[28px]" data-testid="hero-subline">
            Hirelane reads <strong className="font-extrabold text-ink">{counts.companies.toLocaleString("en-US")}</strong> company career sites every six
            hours, matches roles to your resume and drafts each application for you to approve.
          </p>
          <ResumeDrop className="mt-7 max-w-[560px]" />
          <LiveCounts counts={counts} now={now} />
        </div>
        <DemoStack jobs={demo} />
      </div>
    </section>
  );
}
