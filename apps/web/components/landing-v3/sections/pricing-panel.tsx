"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { PERIODS, PLANS, priceFor, type Currency, type Period, type PlanCode } from "../../landing/pricing-model";
import { Button } from "@/components/shadcn/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/shadcn/toggle-group";
import { cn } from "@/lib/utils";
import { PANEL, PhotoBackdrop, Rise } from "./panel";

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);

/** A small toggle row. Radix sends "" when the active item is pressed again, so that is ignored. */
function Pick<T extends string>({ label, value, onChange, items }: { label: string; value: T; onChange: (v: T) => void; items: { value: T; label: string; disabled?: boolean }[] }) {
  return (
    <ToggleGroup type="single" value={value} onValueChange={(v) => v && onChange(v as T)} aria-label={label} spacing={1} className="rounded-[14px] bg-black/25 p-1">
      {items.map((it) => (
        <ToggleGroupItem
          key={it.value}
          value={it.value}
          disabled={it.disabled}
          size="sm"
          className="h-11 min-w-11 rounded-[10px] bg-transparent px-3 text-muted-foreground hover:bg-white/10 hover:text-foreground active:scale-95 data-[state=on]:bg-white/15 data-[state=on]:text-foreground"
        >
          {it.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** Decorative: how many applications each plan includes for the chosen period, the selected plan lit. */
function AllowanceBars({ code, period, reduce }: { code: PlanCode; period: Period; reduce: boolean }) {
  const counts = PLANS.map((p) => ({ code: p.code, n: p.prices ? p.prices[period].applications : (p.freeApplications ?? 0) }));
  const max = Math.max(...counts.map((c) => c.n));
  return (
    <div aria-hidden className="flex h-[168px] items-end gap-3 rounded-[20px] bg-black/20 p-4 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]">
      {counts.map((c) => (
        <motion.div
          key={c.code}
          initial={false}
          animate={{ height: `${Math.max(8, (c.n / max) * 100)}%`, opacity: c.code === code ? 1 : 0.35 }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 28 }}
          className={cn("w-8 rounded-[10px] sm:w-10", c.code === code ? "bg-primary shadow-[0_0_24px_rgb(198_241_157/0.35)]" : "bg-white/40")}
        />
      ))}
    </div>
  );
}

export function PricingPanel({ initialCurrency }: { initialCurrency: Currency }) {
  const reduce = useReducedMotion();
  const [code, setCode] = useState<PlanCode>("basic");
  const [period, setPeriod] = useState<Period>("monthly");
  const [currency, setCurrency] = useState<Currency>(initialCurrency);

  const plan = PLANS.find((p) => p.code === code)!;
  const price = priceFor(plan, period, currency);
  const unit = PERIODS.find((p) => p.value === period)!.unit;
  const bigKey = `${code}-${period}-${currency}`;

  return (
    <section id="pricing" aria-label="Pricing" className="relative isolate px-4 py-24 sm:px-8 md:py-32">
      <PhotoBackdrop src="/landing/road-1200.jpg" scrim={0.7} />
      <Rise className="mx-auto max-w-[920px]">
        <div className="relative">
          {/* Two ghost layers behind the panel give it physical depth. */}
          <div aria-hidden className="absolute inset-x-8 -bottom-3 top-6 -z-10 rounded-[28px] bg-[rgb(15_31_16/0.4)] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)] backdrop-blur-md" />
          <div aria-hidden className="absolute inset-x-16 -bottom-6 top-12 -z-20 rounded-[28px] bg-[rgb(15_31_16/0.3)] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04)]" />
          <div className={cn(PANEL, "flex flex-col gap-10 p-6 sm:p-10")} data-testid="pricing-panel">
            <div role="radiogroup" aria-label="Plan" className="relative grid grid-cols-4 gap-1 rounded-[18px] bg-black/25 p-1">
              {PLANS.map((p) => {
                const on = p.code === code;
                return (
                  <button
                    key={p.code}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setCode(p.code)}
                    onKeyDown={(e) => {
                      const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
                      if (!dir) return;
                      e.preventDefault();
                      const next = PLANS[(PLANS.findIndex((x) => x.code === code) + dir + PLANS.length) % PLANS.length]!;
                      setCode(next.code);
                      (e.currentTarget.parentElement?.querySelector(`[data-plan="${next.code}"]`) as HTMLElement | null)?.focus();
                    }}
                    data-plan={p.code}
                    tabIndex={on ? 0 : -1}
                    className={cn(
                      "t-body relative h-12 cursor-pointer rounded-[14px] font-bold outline-none transition-[color,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-95",
                      on ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {on && (
                      <motion.span
                        layoutId="plan-pill"
                        aria-hidden
                        className="absolute inset-0 rounded-[14px] bg-primary shadow-[0_8px_20px_-6px_rgb(198_241_157/0.5)]"
                        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 32 }}
                      />
                    )}
                    <span className="relative">{p.name}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-end justify-between gap-8">
            <div className="sm:min-h-[200px]" aria-live="polite" data-ui data-testid="pricing-readout">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={bigKey}
                  initial={reduce ? false : { opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: -12 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                >
                  {price ? (
                    <>
                      <p className="flex items-baseline gap-3">
                        <span className="t-display tabular-nums" data-testid="price">{price.price}</span>
                        <span className="t-statement text-muted-foreground">/{unit}</span>
                      </p>
                      <p className="t-statement mt-4 flex flex-wrap items-baseline gap-x-2 text-foreground">
                        <span className="font-bold tabular-nums" data-testid="apps">{fmt(price.applications)} applications</span>
                        <span aria-hidden className="hidden text-muted-foreground sm:inline">·</span>
                        <span className="text-primary tabular-nums" data-testid="per-app">{price.perApplication} each</span>
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="t-display" data-testid="price">Free</p>
                      <p className="t-statement mt-4">
                        <span className="font-bold tabular-nums" data-testid="apps">{fmt(plan.freeApplications ?? 0)} applications</span>
                        <span aria-hidden className="hidden text-muted-foreground sm:inline">·</span><span className="text-muted-foreground">no card</span>
                      </p>
                    </>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
            <AllowanceBars code={code} period={period} reduce={!!reduce} />
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <Button size="lg" asChild className="transition-transform duration-150 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97]">
                <a href="#start">Get early access</a>
              </Button>
              <div className="ml-auto flex flex-wrap items-center gap-3">
                <Pick<Currency> label="Currency" value={currency} onChange={setCurrency} items={[{ value: "INR", label: "INR" }, { value: "USD", label: "USD" }]} />
                <Pick<Period>
                  label="Billing period"
                  value={period}
                  onChange={setPeriod}
                  items={PERIODS.map((p) => ({ value: p.value, label: p.label, disabled: !plan.prices }))}
                />
              </div>
            </div>
            <p className="t-small text-muted-foreground">Planned prices. Checkout opens soon.</p>
          </div>
        </div>
      </Rise>
    </section>
  );
}
