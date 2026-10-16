"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { PERIODS, PLANS, priceFor, type Currency, type Period, type PlanCode } from "../../landing/pricing-model";
import { ToggleGroup, ToggleGroupItem } from "@/components/shadcn/toggle-group";
import { cn } from "@/lib/utils";
import { START_HREF } from "./links";

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
const PAID = PLANS.filter((p) => p.prices);
const FREE = PLANS.find((p) => !p.prices)!;

/** A small single-choice toggle row. Radix sends "" when the active item is pressed again, so that is ignored. */
function Pick<T extends string>({ label, value, onChange, items }: { label: string; value: T; onChange: (v: T) => void; items: { value: T; label: string }[] }) {
  return (
    <ToggleGroup type="single" value={value} onValueChange={(v) => v && onChange(v as T)} aria-label={label} spacing={1} className="rounded-[14px] bg-accent p-1">
      {items.map((it) => (
        <ToggleGroupItem
          key={it.value}
          value={it.value}
          size="sm"
          className="h-11 min-w-11 cursor-pointer rounded-[10px] bg-transparent px-3.5 text-[14px] font-bold text-muted-foreground hover:bg-card/70 hover:text-foreground active:scale-95 data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-[0_2px_6px_rgb(19_32_26/.14)]"
        >
          {it.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

const cta = "inline-flex h-12 items-center justify-center rounded-full px-6 text-[16px] font-bold outline-none transition-[background-color,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.97]";

function Features({ items }: { items: string[] }) {
  return (
    <ul className="mt-6 space-y-2.5">
      {items.map((f) => (
        <li key={f} className="flex gap-2.5 text-[15px] leading-6">
          <Check aria-hidden className="mt-1 size-4 shrink-0 text-primary" />
          {f}
        </li>
      ))}
    </ul>
  );
}

export function PricingCards({ initialCurrency }: { initialCurrency: Currency }) {
  const [code, setCode] = useState<PlanCode>("pro");
  const [period, setPeriod] = useState<Period>("monthly");
  const [currency, setCurrency] = useState<Currency>(initialCurrency);

  const plan = PAID.find((p) => p.code === code)!;
  const price = priceFor(plan, period, currency)!;
  const unit = PERIODS.find((p) => p.value === period)!.unit;

  return (
    <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]" data-testid="pricing">
      <article className="flex flex-col rounded-[28px] bg-card p-7 ring-1 ring-black/10" data-testid="plan-free">
        <h3 className="text-[15px] font-bold text-muted-foreground">{FREE.name}</h3>
        <p className="mt-3 text-[56px] font-extrabold leading-[1] tracking-[-0.035em]">Free</p>
        <p className="mt-2 text-[15px] font-bold tabular-nums">{FREE.freeApplications} applications, no card</p>
        <Features items={FREE.features.slice(1)} />
        <a href={START_HREF} className={cn(cta, "mt-auto bg-[var(--ink)] text-[#f7f6f2] hover:bg-[#233a30]")} style={{ marginTop: 28 }}>
          Start free
        </a>
      </article>

      <article className="relative flex flex-col rounded-[28px] bg-card p-7 shadow-[0_28px_56px_-28px_rgb(15_92_69/.5)] ring-2 ring-primary" data-testid="plan-paid">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Pick<PlanCode> label="Plan" value={code} onChange={setCode} items={PAID.map((p) => ({ value: p.code, label: p.name }))} />
          <Pick<Currency> label="Currency" value={currency} onChange={setCurrency} items={[{ value: "INR", label: "INR" }, { value: "USD", label: "USD" }]} />
        </div>

        <div className="mt-7 min-h-[132px]" aria-live="polite" data-testid="pricing-readout">
          <p className="flex items-baseline gap-2">
            <span className="text-[64px] font-extrabold leading-[1] tracking-[-0.04em] tabular-nums" data-testid="price">{price.price}</span>
            <span className="text-[17px] text-muted-foreground">/ {unit}</span>
          </p>
          <p className="mt-3 text-[16px] font-bold tabular-nums">
            <span data-testid="apps">{fmt(price.applications)} applications</span>
            <span className="font-semibold text-primary"> · <span data-testid="per-app">{price.perApplication}</span> each</span>
          </p>
        </div>

        <div className="mt-5">
          <Pick<Period> label="Billing period" value={period} onChange={setPeriod} items={PERIODS.map((p) => ({ value: p.value, label: p.label }))} />
        </div>
        <Features items={plan.features} />
        <a href={START_HREF} className={cn(cta, "mt-7 bg-primary text-primary-foreground hover:bg-[#0b4a37] sm:self-start")}>
          Start free
        </a>
        <p className="mt-4 text-[13px] text-muted-foreground">Planned prices. Checkout opens soon.</p>
      </article>
    </div>
  );
}
