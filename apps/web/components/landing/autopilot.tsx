"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Clock, MailOpen, Pause } from "lucide-react";
import { CompanyLogo } from "../brand/CompanyLogo";
import { Chip, RangeSlider, Reveal, SegmentedControl, Select, cn } from "../ui";
import { SectionHeading } from "./section-heading";
import { asOfLabel, roleLabel } from "./demo-model";
import type { DemoJob } from "./types";

export const AUTOPILOT_DEFAULT_MIN = 70;
const CAPS = ["1", "3", "5", "10"] as const;

type Estimate = { perWeek: number; asOf: string };

/** Drafts queued in a week: the rule's volume, held down by the per-day cap. Pure so it is unit-tested. */
export function weeklyDrafts(perWeek: number, capPerDay: number): number {
  return Math.max(0, Math.min(Math.round(perWeek), capPerDay * 7));
}

export function Autopilot({ initial, roles, sample }: { initial: Estimate | null; roles: string[]; sample: DemoJob[] }) {
  const [min, setMin] = useState(AUTOPILOT_DEFAULT_MIN);
  const [role, setRole] = useState("");
  const [cap, setCap] = useState<(typeof CAPS)[number]>("3");
  const [est, setEst] = useState<Estimate | null>(initial);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const memo = useRef(new Map<string, Estimate>(initial ? [[`${AUTOPILOT_DEFAULT_MIN}|`, initial]] : []));

  useEffect(() => {
    const key = `${min}|${role}`;
    const hit = memo.current.get(key);
    if (hit) {
      setEst(hit);
      setStale(false);
      setLoading(false);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({ min: String(min) });
        if (role) qs.set("role", role);
        const res = await fetch(`/api/public/stats/autopilot?${qs}`, { signal: ctl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { perWeek: number; asOf: string };
        const e = { perWeek: body.perWeek, asOf: body.asOf };
        memo.current.set(key, e);
        setEst(e);
        setStale(false);
      } catch (err) {
        if ((err as { name?: string }).name !== "AbortError") setStale(true);
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [min, role]);

  const capN = Number(cap);
  const drafts = est ? weeklyDrafts(est.perWeek, capN) : null;
  const options = useMemo(() => [{ value: "", label: "Any role" }, ...roles.map((r) => ({ value: r, label: roleLabel(r) }))], [roles]);
  const emailRows = sample.slice(0, 3);

  return (
    <section id="autopilot" aria-labelledby="autopilot-h" className="dark-band relative scroll-mt-16 overflow-x-clip py-16 sm:py-24" data-testid="autopilot">
      <div className="mx-auto grid max-w-page grid-cols-[minmax(0,1fr)] gap-12 px-4 sm:px-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-16">
        <div>
          <Reveal>
            <Chip tone="signal" icon={<Clock aria-hidden className="size-3.5" />} className="mb-5">
              Paid plans • coming soon
            </Chip>
            <SectionHeading tone="dark" eyebrow="Autopilot" title="Set a rule. Wake up to drafts, not to surprises." id="autopilot-h">
              Autopilot drafts and queues applications that match your rule, then emails you a batch to approve. It never sends on its own.
            </SectionHeading>
          </Reveal>

          <Reveal delay={0.08}>
            <div className="mt-8 grid gap-6 rounded-[20px] border border-white/10 bg-white/[0.06] p-5 backdrop-blur sm:p-6">
              <RangeSlider
                tone="dark"
                label="Minimum match score"
                value={min}
                onValueChange={setMin}
                min={30}
                max={95}
                step={5}
                format={(v) => `${v}`}
              />
              <div className="grid gap-5 sm:grid-cols-2">
                <Select tone="dark" label="Role" value={role} onChange={(e) => setRole(e.target.value)} options={options} />
                <div className="flex flex-col gap-1.5">
                  <span id="cap-label" className="text-[13px] font-bold text-white/80">
                    Drafts per day, at most
                  </span>
                  <SegmentedControl
                    tone="dark"
                    label="Per-day cap"
                    value={cap}
                    onChange={setCap}
                    segments={CAPS.map((c) => ({ value: c, label: c }))}
                    className="w-full [&>button]:flex-1"
                  />
                </div>
              </div>
              <div className="border-t border-white/10 pt-5" aria-live="polite">
                <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[13px] font-bold text-white/60">≈</span>
                  <span
                    data-testid="autopilot-count"
                    className={cn("text-[56px] font-extrabold leading-none tracking-tight tabular-nums text-white transition-opacity duration-200 sm:text-[72px]", loading && "opacity-50")}
                  >
                    {est ? est.perWeek.toLocaleString("en-US") : "..."}
                  </span>
                  <span className="text-[17px] font-bold text-white/90">new jobs a week would clear this rule</span>
                </p>
                {drafts !== null && (
                  <p className="mt-3 text-[15px] leading-[23px] text-white/75" data-testid="autopilot-drafts">
                    With a cap of {cap} a day, Hirelane would draft and queue up to <strong className="text-white">{drafts.toLocaleString("en-US")}</strong>{" "}
                    a week for you to review.
                  </p>
                )}
                <p className="mt-3 text-[13px] leading-[19px] text-white/55">
                  Estimate from jobs posted in the last 28 days{est && asOfLabel(est.asOf) ? `, as of ${asOfLabel(est.asOf)}` : ""}. It scores how standard a
                  job is for its role; it is not a match against your resume.
                  {stale && <span className="ml-1 font-bold text-signal">Could not refresh just now, showing the last figure.</span>}
                </p>
              </div>
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.16} className="lg:pt-24">
          <div className="relative mx-auto max-w-[480px]">
            <div aria-hidden className="absolute -inset-5 rounded-[36px] bg-match/20 blur-3xl" />
            <div className="relative rotate-1 rounded-[18px] bg-surface p-5 text-ink shadow-pop transition-transform duration-300 hover:rotate-0" data-testid="batch-email">
              <div className="flex items-center gap-2.5 text-[12px] font-bold text-ink-3">
                <MailOpen aria-hidden className="size-4 text-lane" />
                Example daily batch • 7:30 am
              </div>
              <p className="mt-2 text-[18px] font-extrabold leading-6 tracking-tight">3 drafted: 2 ready to approve, 1 needs you</p>
              <ul className="mt-4 divide-y divide-line rounded-[12px] border border-line">
                {emailRows.map((j, i) => (
                  <li key={j.slug} className="flex items-center gap-3 p-3">
                    <CompanyLogo name={j.company} src={j.logoPath} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-extrabold leading-5">{j.title}</p>
                      <p className="truncate text-[13px] text-ink-2">{j.company}</p>
                    </div>
                    {i === 2 ? (
                      <Chip tone="signal">Needs you</Chip>
                    ) : (
                      <Chip tone="match" icon={<Check aria-hidden className="size-3.5" />}>
                        Ready
                      </Chip>
                    )}
                  </li>
                ))}
                {emailRows.length === 0 && <li className="p-3 text-[14px] text-ink-2">Drafts appear here once jobs are ingested.</li>}
              </ul>
              <div className="mt-4 flex gap-2" aria-hidden>
                <span className="inline-flex h-10 flex-1 items-center justify-center rounded-[12px] bg-lane text-[14px] font-bold text-white">Review drafts</span>
                <span className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[12px] border border-line px-3.5 text-[14px] font-bold text-ink-2">
                  <Pause className="size-4" /> Pause
                </span>
              </div>
              <p className="mt-3 text-[12px] text-ink-3">Nothing here has been sent. You approve each one.</p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
