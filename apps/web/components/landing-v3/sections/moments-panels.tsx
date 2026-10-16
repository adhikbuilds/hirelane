"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { animate, motion, useMotionValue, useReducedMotion, type AnimationPlaybackControls } from "motion/react";
import { agoShort } from "../../landing/demo-model";
import type { TickerJob } from "../../landing/types";
import { Slider } from "@/components/shadcn/slider";
import { cn } from "@/lib/utils";
import { PANEL, PhotoBackdrop, Rise } from "./panel";
import { useAutopilotRate } from "./rule-model";

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);

export type MomentsProps = {
  ticker: TickerJob[];
  openJobs: number;
  companies: { name: string; openRoles: number }[];
  totalCompanies: number;
  initialPerWeek: number | null;
  nowIso: string;
};

export function MomentsPanels({ ticker, openJobs, companies, totalCompanies, initialPerWeek, nowIso }: MomentsProps) {
  return (
    <section id="moments" aria-label="Live from the boards" className="relative isolate px-4 py-24 sm:px-8 md:py-32">
      <PhotoBackdrop src="/landing/road-0600.jpg" scrim={0.72} />
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-5 lg:grid-cols-12">
        <Rise index={0} className="min-w-0 lg:col-span-7 lg:row-span-2">
          <LiveBoard jobs={ticker.slice(0, 6)} openJobs={openJobs} nowIso={nowIso} />
        </Rise>
        <Rise index={1} className="min-w-0 lg:col-span-5">
          <YourRule initialPerWeek={initialPerWeek} />
        </Rise>
        <Rise index={2} className="min-w-0 lg:col-span-5">
          <CompanyCloud companies={companies} totalCompanies={totalCompanies} />
        </Rise>
      </div>
    </section>
  );
}

function Monogram({ name }: { name: string }) {
  return (
    <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-primary/15 font-extrabold text-primary shadow-[inset_0_0_0_1px_rgb(198_241_157/0.25)]">
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** The freshest postings scroll upward inside the panel. Hover or focus pauses it; reduced motion is a static list. */
export function LiveBoard({ jobs, openJobs, nowIso }: { jobs: TickerJob[]; openJobs: number; nowIso: string }) {
  const reduce = useReducedMotion();
  const now = new Date(nowIso);
  const y = useMotionValue(0);
  const copy = useRef<HTMLUListElement>(null);
  const ctl = useRef<AnimationPlaybackControls | null>(null);

  useEffect(() => {
    if (reduce || jobs.length === 0) {
      y.set(0); // reduced motion can resolve after the first render: never leave the list mid-scroll
      return;
    }
    const h = copy.current?.offsetHeight ?? 0;
    if (!h) return;
    ctl.current = animate(y, [0, -h], { duration: Math.max(24, jobs.length * 5), ease: "linear", repeat: Infinity });
    return () => ctl.current?.stop();
  }, [reduce, jobs.length, y]);

  const pause = () => ctl.current?.pause();
  const play = () => ctl.current?.play();

  const list = (hidden: boolean) => (
    <ul ref={hidden ? undefined : copy} aria-hidden={hidden || undefined} inert={hidden} className="flex flex-col gap-3 pb-3">
      {jobs.map((j) => (
        <li key={j.slug}>
          <Link
            href={`/job/${j.slug}`}
            data-ui
            className="group flex items-center gap-4 rounded-[20px] bg-white/[0.06] p-4 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)] transition-[background-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:bg-white/[0.11] hover:shadow-[inset_0_0_0_1px_rgb(198_241_157/0.4),0_12px_24px_-12px_rgb(0_0_0/0.6)] focus-visible:-translate-y-0.5 active:scale-[0.99]"
          >
            <Monogram name={j.company} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold leading-6">{j.title}</span>
              <span className="block truncate text-sm text-muted-foreground">{j.company}</span>
            </span>
            <time dateTime={j.freshAt} className="shrink-0 text-sm font-bold text-primary">
              {agoShort(j.freshAt, now)}
            </time>
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <div className={cn(PANEL, "flex h-full flex-col p-6 sm:p-8")} data-testid="moment-board">
      <div className="flex items-center gap-3">
        <span aria-hidden className="relative grid size-3 place-items-center">
          <span className="absolute size-3 rounded-full bg-primary/40 motion-safe:animate-ping" />
          <span className="size-2 rounded-full bg-primary" />
        </span>
        <p className="t-statement font-bold">
          <span data-ui className="tabular-nums">{fmt(openJobs)}</span> roles. Refreshed every six hours.
        </p>
      </div>
      <div
        role="region"
        aria-label="Newest job postings"
        onMouseEnter={pause}
        onMouseLeave={play}
        onFocus={pause}
        onBlur={play}
        className="relative mt-6 min-h-[380px] flex-1 [mask-image:linear-gradient(180deg,transparent,#000_10%,#000_88%,transparent)]"
      >
        <div className="absolute inset-0 overflow-hidden motion-reduce:overflow-y-auto">
          <motion.div style={{ y }} className="will-change-transform motion-reduce:!transform-none">
            {list(false)}
            <div className="motion-reduce:hidden">{list(true)}</div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

/** One shadcn Slider (minimum match) and the live weekly count behind it. */
export function YourRule({ initialPerWeek }: { initialPerWeek: number | null }) {
  const { min, setMin, perWeek, pending } = useAutopilotRate(initialPerWeek);
  const reduce = useReducedMotion();
  // No entrance on the server-rendered number: `initial` must match between server and client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const shown = perWeek === null ? "-" : fmt(perWeek);

  return (
    <div className={cn(PANEL, "flex h-full flex-col justify-between gap-8 p-6 sm:p-8")} data-testid="moment-rule">
      <p aria-live="polite" aria-atomic="true" className="flex flex-col gap-1">
        <span className="flex items-baseline gap-2">
          <span aria-hidden className="t-statement self-start pt-3 text-muted-foreground">≈</span>
          <span className="sr-only">About </span>
          <motion.span
            key={shown}
            data-ui
            data-testid="rule-number"
            initial={mounted && !reduce ? { opacity: 0, y: 8 } : false}
            animate={{ opacity: pending ? 0.55 : 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="t-display text-primary tabular-nums"
          >
            {shown}
          </motion.span>
        </span>
        <span className="t-statement font-bold">new matches a week.</span>
      </p>
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <label id="rule-min-label" className="t-small font-bold text-muted-foreground">
            Minimum match
          </label>
          <span data-ui className="t-small font-bold tabular-nums">{min}%</span>
        </div>
        <Slider
          value={[min]}
          onValueChange={(v) => setMin(v[0] ?? min)}
          min={0}
          max={100}
          step={5}
          aria-labelledby="rule-min-label"
          className="h-11 cursor-pointer"
        />
      </div>
    </div>
  );
}

/** Deterministic drift so the server and client render the same cloud. */
const drift = (i: number) => ({
  x: [0, ((i * 37) % 17) - 8, 0, -(((i * 53) % 13) - 6), 0],
  y: [0, -(((i * 29) % 11) - 5), ((i * 41) % 9) - 4, 0],
  duration: 14 + ((i * 7) % 9),
});

export function CompanyCloud({ companies, totalCompanies }: { companies: { name: string; openRoles: number }[]; totalCompanies: number }) {
  const reduce = useReducedMotion();
  const more = Math.max(0, totalCompanies - Math.min(2, companies.length));
  const [a, b] = companies;
  return (
    <div className={cn(PANEL, "flex h-full min-h-[300px] flex-col gap-6 p-6 sm:p-8")} data-testid="moment-companies">
      <p className="t-statement font-bold">
        Reading open roles at{" "}
        {a && <span data-ui className="text-primary">{a.name}</span>}
        {b && (
          <>
            , <span data-ui className="text-primary">{b.name}</span>
          </>
        )}{" "}
        and <span data-ui className="tabular-nums">{fmt(more)}</span> more.
      </p>
      <ul className="flex flex-1 flex-wrap content-center items-center justify-center gap-x-5 gap-y-3" aria-label="Companies with the most open roles">
        {companies.map((c, i) => {
          const d = drift(i);
          return (
            <motion.li
              key={c.name}
              data-ui
              animate={reduce ? undefined : { x: d.x, y: d.y }}
              transition={{ duration: d.duration, repeat: Infinity, ease: "easeInOut" }}
              className={cn(
                "cursor-default select-none transition-colors duration-200 hover:text-primary",
                i < 3 ? "t-statement font-extrabold text-foreground" : "t-body font-semibold text-muted-foreground",
              )}
              title={`${fmt(c.openRoles)} open roles`}
            >
              {c.name}
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}
