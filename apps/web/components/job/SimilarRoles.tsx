"use client";

import Link from "next/link";
import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { CompanyLogo } from "@/components/brand/CompanyLogo";
import { Chip } from "@/components/ui/Chip";
import { cn } from "@/components/ui/cn";
import type { SimilarJob } from "./similar-model";

const WORKPLACE = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" } as const;

export function SimilarRoles({ jobs, roleLabel }: { jobs: SimilarJob[]; roleLabel: string }) {
  const track = useRef<HTMLUListElement>(null);
  if (jobs.length === 0) return null;
  const scroll = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * Math.max(280, el.clientWidth * 0.8), behavior: reduce ? "auto" : "smooth" });
  };
  const arrow =
    "hidden size-11 place-items-center rounded-full border border-line bg-surface text-ink shadow-control hover:border-lane/40 hover:bg-lane-50 sm:grid";
  return (
    <section aria-labelledby="similar-h" data-testid="similar-roles" className="mx-auto w-full max-w-page px-4 pt-16 sm:px-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 id="similar-h" className="text-[28px] font-extrabold tracking-[-0.03em]">
            Similar roles
          </h2>
          <p className="mt-1 text-ink-2">{roleLabel}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" aria-label="Previous roles" onClick={() => scroll(-1)} className={arrow}>
            <ChevronLeft aria-hidden className="size-5" />
          </button>
          <button type="button" aria-label="Next roles" onClick={() => scroll(1)} className={arrow}>
            <ChevronRight aria-hidden className="size-5" />
          </button>
        </div>
      </div>
      <ul
        ref={track}
        className="-mx-4 mt-6 flex snap-x snap-mandatory scroll-pl-4 sm:scroll-pl-8 gap-4 overflow-x-auto px-4 pb-6 pt-1 [scrollbar-width:none] sm:-mx-8 sm:px-8 [&::-webkit-scrollbar]:hidden"
      >
        {jobs.map((j) => (
          <li key={j.slug} className="w-[286px] shrink-0 snap-start">
            <Link
              href={`/job/${j.slug}`}
              className={cn(
                "group flex h-full flex-col rounded-[16px] border border-line bg-surface p-5 shadow-card",
                "transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-lane/30 hover:shadow-pop",
              )}
            >
              <CompanyLogo name={j.company} src={j.logoPath} size={44} />
              <h3 className="mt-4 line-clamp-2 min-h-[48px] text-[18px] font-extrabold leading-6 tracking-[-0.02em] group-hover:text-lane">
                {j.title}
              </h3>
              <p className="mt-1 truncate text-[15px] text-ink-2">{j.company}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {j.workplace ? <Chip>{WORKPLACE[j.workplace]}</Chip> : null}
                {j.place ? <Chip className="max-w-full"><span className="truncate">{j.place}</span></Chip> : null}
              </div>
              <p className="figure mt-auto pt-4 text-[15px] font-bold text-lane">{j.salary ?? <span className="font-medium text-ink-3">Pay not stated</span>}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
