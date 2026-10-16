"use client";

import { memo } from "react";
import Link from "next/link";
import { Banknote, MapPin } from "lucide-react";
import { CompanyLogo } from "../brand/CompanyLogo";
import { cn } from "../ui/cn";
import { FRESH_LABEL, type BoardRow } from "./row-model";

const DOT: Record<BoardRow["fresh"], string> = { new: "bg-match", week: "bg-lane/60", old: "bg-ink-3/50" };

export function FreshDot({ fresh, age, at }: { fresh: BoardRow["fresh"]; age: string; at: string }) {
  return (
    <time dateTime={at} title={FRESH_LABEL[fresh]} className="figure inline-flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-ink-2">
      <span aria-hidden="true" className={cn("size-2 rounded-full", DOT[fresh], fresh === "new" && "shadow-[0_0_0_3px_rgb(16_185_129/.2)]")} />
      <span className="sr-only">{FRESH_LABEL[fresh]}, </span>
      {age}
    </time>
  );
}

/** One job row. The title link stretches over the row (so the whole row is clickable) while the company link stays its own target. */
export const JobRow = memo(function JobRow({
  row,
  active,
  onActivate,
}: {
  row: BoardRow;
  active: boolean;
  onActivate: (slug: string, how: "hover" | "focus") => void;
}) {
  return (
    <li
      data-slug={row.slug}
      data-active={active || undefined}
      onMouseEnter={() => onActivate(row.slug, "hover")}
      onFocus={() => onActivate(row.slug, "focus")}
      className={cn(
        "group/row relative border-b border-line last:border-b-0 transition-colors duration-150",
        "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-lane before:opacity-0 before:transition-opacity",
        "hover:bg-lane-50/60 focus-within:bg-lane-50/60 data-[active]:before:opacity-100",
      )}
    >
      <div className="flex gap-3.5 px-4 py-3.5 sm:px-5">
        <CompanyLogo name={row.company.name} src={row.company.logoPath} size={44} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="min-w-0 text-[16px] font-bold leading-6 tracking-[-0.01em]">
              <Link
                href={`/job/${row.slug}`}
                data-row-link
                className="block line-clamp-2 after:absolute sm:line-clamp-1 after:inset-0 after:content-[''] hover:text-lane focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-lane"
              >
                {row.title}
              </Link>
            </h3>
            <FreshDot fresh={row.fresh} age={row.age} at={row.freshAt} />
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-ink-2">
            <Link href={`/company/${row.company.slug}`} className="relative z-10 truncate font-semibold hover:text-lane hover:underline">
              {row.company.name}
            </Link>
            {row.chips.map((c, i) => (
              <span key={c} className="inline-flex items-center gap-1 rounded-full bg-ink/[0.05] px-2 py-0.5 text-[12.5px] font-medium leading-5 text-ink-2">
                {i === 0 ? <MapPin aria-hidden className="size-3 text-ink-3" /> : null}
                {c}
              </span>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {row.pay ? (
              <span
                title={row.payNote ? `Posted as ${row.payNote}` : undefined}
                className="figure inline-flex items-center gap-1 rounded-full border border-lane-100 bg-lane-50 px-2.5 py-0.5 text-[13px] font-bold leading-5 text-lane"
              >
                <Banknote aria-hidden className="size-3.5" />
                {row.pay}
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full border border-dashed border-line px-2.5 py-0.5 text-[12.5px] leading-5 text-ink-3">Pay not stated</span>
            )}
            {row.skills.map((s) => (
              <span key={s} className="inline-flex items-center rounded-full border border-line bg-surface px-2.5 py-0.5 text-[12.5px] font-medium leading-5 text-ink-2">
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>
    </li>
  );
});

export function RowSkeletons({ n = 6 }: { n?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <li key={i} aria-hidden="true" data-skeleton className="flex gap-3.5 border-b border-line px-4 py-4 last:border-b-0 sm:px-5">
          <div className="skeleton size-11 shrink-0 rounded-[11px]" />
          <div className="flex-1 space-y-2.5">
            <div className="skeleton h-4 w-2/3 rounded-md" />
            <div className="skeleton h-3.5 w-1/2 rounded-md" />
            <div className="flex gap-2">
              <div className="skeleton h-5 w-28 rounded-full" />
              <div className="skeleton h-5 w-16 rounded-full" />
              <div className="skeleton h-5 w-20 rounded-full" />
            </div>
          </div>
        </li>
      ))}
    </>
  );
}
