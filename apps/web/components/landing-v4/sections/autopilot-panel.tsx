"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertCircle, ArrowRight } from "lucide-react";
import { agoShort } from "../../landing/demo-model";
import { Slider } from "@/components/shadcn/slider";
import { cn } from "@/lib/utils";
import { clearing, cappedPerWeek, DEFAULT_PER_DAY, PER_DAY, RULE_ROLES, type RuleJob } from "./rule-model";
import { useAutopilotRule } from "./use-autopilot-rule";

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
export const TIMELINE_ROWS = 5;

function Chip({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-11 cursor-pointer items-center rounded-full px-4 text-[14px] font-bold outline-none transition-[background-color,color,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-95",
        on ? "bg-[var(--lime)] text-[#13201a]" : "bg-white/10 text-[#e4ebe7] hover:bg-white/20",
      )}
    >
      {children}
    </button>
  );
}

export function AutopilotPanel({ initialPerWeek, jobs, nowIso }: { initialPerWeek: number | null; jobs: RuleJob[]; nowIso: string }) {
  const { min, setMin, role, setRole, perWeek, pending } = useAutopilotRule(initialPerWeek);
  const [perDay, setPerDay] = useState<number>(DEFAULT_PER_DAY);
  const now = new Date(nowIso);
  const rows = clearing(jobs, min, role).slice(0, TIMELINE_ROWS);
  const weekly = perWeek === null ? null : cappedPerWeek(perWeek, perDay);
  const roleLabel = RULE_ROLES.find((r) => r.value === role)?.label ?? "Any role";

  return (
    <div
      data-surface="ink"
      data-testid="autopilot"
      className="grid gap-10 rounded-[32px] bg-[var(--ink)] p-7 text-foreground shadow-[0_40px_80px_-32px_rgb(19_32_26/.7)] md:p-12 lg:grid-cols-[1fr_1.05fr] lg:gap-14"
    >
      <div>
        <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[13px] font-bold text-[var(--lime)]">
          <span aria-hidden className="size-1.5 rounded-full bg-[var(--lime)]" />
          Asha&apos;s rule · sample profile
        </p>
        <h2 className="mt-5 text-[clamp(34px,4.6vw,56px)] font-extrabold leading-[1.02] tracking-[-0.03em] text-balance">Or set a rule.</h2>

        <div className="mt-8 flex items-end gap-3" aria-live="polite">
          <p className={cn("text-[72px] font-extrabold leading-[0.9] tracking-[-0.04em] tabular-nums transition-opacity duration-150", pending && "opacity-50")} data-testid="weekly">
            {weekly === null ? "–" : fmt(weekly)}
          </p>
          <p className="pb-1 text-[15px] leading-5 text-muted-foreground">
            jobs a week would clear
            <br />
            this rule, up to {perDay} a day
          </p>
        </div>

        <div className="mt-8">
          <div className="flex items-baseline justify-between">
            <label id="min-label" className="text-[15px] font-bold">
              Minimum match
            </label>
            <output htmlFor="min-slider" className="text-[22px] font-extrabold tabular-nums" data-testid="min-value">
              {min}%
            </output>
          </div>
          <Slider id="min-slider" aria-labelledby="min-label" min={0} max={100} step={5} value={[min]} onValueChange={(v) => setMin(v[0] ?? min)} className="mt-4 h-11" />
        </div>

        <div className="mt-6 space-y-4">
          <div role="group" aria-label="Role" className="flex flex-wrap gap-2">
            {RULE_ROLES.map((r) => (
              <Chip key={r.label} on={r.value === role} onClick={() => setRole(r.value)}>
                {r.label}
              </Chip>
            ))}
          </div>
          <div role="group" aria-label="Applications per day" className="flex flex-wrap gap-2">
            {PER_DAY.map((n) => (
              <Chip key={n} on={n === perDay} onClick={() => setPerDay(n)} label={`${n} per day`}>
                {n} a day
              </Chip>
            ))}
          </div>
        </div>
        <p className="mt-6 text-[13px] leading-5 text-muted-foreground">Estimate from jobs posted in the last 28 days. Paid plans · coming soon.</p>
      </div>

      <div className="min-w-0">
        <p className="text-[13px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Would clear it · {roleLabel}</p>
        <ol className="mt-3 divide-y divide-white/10 rounded-[20px] bg-white/[0.05] ring-1 ring-white/10" data-testid="timeline">
          {rows.length === 0 && <li className="p-5 text-[15px] text-muted-foreground">Nothing in the latest postings clears this rule. Lower the match.</li>}
          {rows.map((j) => (
            <li key={j.slug}>
              <Link
                href={`/job/${j.slug}`}
                className="group flex min-h-14 items-center gap-3 px-4 py-3 outline-none transition-colors duration-150 first:rounded-t-[20px] last:rounded-b-[20px] hover:bg-white/10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <time dateTime={j.freshAt} className="w-14 shrink-0 text-[13px] font-bold tabular-nums text-[var(--lime)]">
                  {agoShort(j.freshAt, now)}
                </time>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold leading-5">{j.company}</span>
                  <span className="block truncate text-[13px] leading-4 text-muted-foreground">{j.title} · would draft</span>
                </span>
                <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[12px] font-bold tabular-nums">{j.score}%</span>
                <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
          <li className="flex items-start gap-3 rounded-b-[20px] bg-[var(--signal)] px-4 py-3 text-[#3b2a05]">
            <AlertCircle aria-hidden className="mt-0.5 size-5 shrink-0" />
            <p className="text-[14px] font-bold leading-5">Needs you: any question your resume can&apos;t answer. Hirelane stops and asks.</p>
          </li>
        </ol>
      </div>
    </div>
  );
}
