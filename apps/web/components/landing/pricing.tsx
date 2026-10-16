"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { Reveal, SegmentedControl, buttonClasses, cn } from "../ui";
import { SectionHeading } from "./section-heading";
import { PERIODS, PLANS, formatPrice, priceFor, quarterlySaving, type Currency, type Period } from "./pricing-model";

export function Pricing({ initialCurrency }: { initialCurrency: Currency }) {
  const [period, setPeriod] = useState<Period>("monthly");
  const [currency, setCurrency] = useState<Currency>(initialCurrency);
  const unit = PERIODS.find((p) => p.value === period)!.unit;

  return (
    <section id="pricing" aria-labelledby="pricing-h" className="scroll-mt-16 bg-surface py-16 sm:py-24" data-testid="pricing">
      <div className="mx-auto max-w-page px-4 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <Reveal>
            <SectionHeading eyebrow="Pricing" title="Start free. Pay only for the applications you hand off." id="pricing-h">
              Matching and drafting are free to look at. An application counts when you approve it and Hirelane hands it to the employer&apos;s form.
            </SectionHeading>
          </Reveal>
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl
              label="Billing period"
              value={period}
              onChange={setPeriod}
              segments={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
            />
            <SegmentedControl
              label="Currency"
              size="sm"
              value={currency}
              onChange={setCurrency}
              segments={[
                { value: "INR", label: "₹ INR" },
                { value: "USD", label: "$ USD" },
              ]}
            />
          </div>
        </div>

        <ul className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((plan, i) => {
            const p = priceFor(plan, period, currency);
            const saving = period === "quarterly" ? quarterlySaving(plan) : 0;
            return (
              <li key={plan.code} className="flex">
                <Reveal delay={i * 0.06} className="flex w-full">
                  <article
                    data-testid={`plan-${plan.code}`}
                    className={cn(
                      "relative flex w-full flex-col rounded-[18px] border bg-surface p-6 shadow-card",
                      plan.highlight ? "border-lane ring-2 ring-lane/20" : "border-line",
                    )}
                  >
                    {plan.highlight && (
                      <span className="absolute -top-3.5 left-6 inline-flex h-7 items-center rounded-full bg-lane px-3 text-[13px] font-bold text-white">
                        Includes Autopilot
                      </span>
                    )}
                    <h3 className="text-[20px] font-extrabold tracking-tight">{plan.name}</h3>
                    <p className="mt-1 min-h-12 text-[14px] leading-[22px] text-ink-2">{plan.tagline}</p>
                    <div className="mt-4 min-h-[88px]">
                      {p ? (
                        <>
                          <p className="flex items-baseline gap-1.5">
                            <span data-testid={`price-${plan.code}`} className="text-[40px] font-extrabold leading-none tracking-tight tabular-nums">
                              {p.price}
                            </span>
                            <span className="text-[15px] font-semibold text-ink-3">/ {unit}</span>
                          </p>
                          <p className="mt-2 text-[14px] font-bold text-ink" data-testid={`apps-${plan.code}`}>
                            {p.applications.toLocaleString("en-US")} applications
                          </p>
                          <p className="text-[13px] text-ink-2" data-testid={`per-app-${plan.code}`}>
                            {p.perApplication} per application
                            {saving > 0 && <span className="ml-1.5 font-bold text-lane">• {saving}% below monthly</span>}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="flex items-baseline gap-1.5">
                            <span data-testid={`price-${plan.code}`} className="text-[40px] font-extrabold leading-none tracking-tight tabular-nums">
                              {formatPrice(0, currency)}
                            </span>
                            <span className="text-[15px] font-semibold text-ink-3">no card</span>
                          </p>
                          <p className="mt-2 text-[14px] font-bold text-ink">{plan.freeApplications} applications in total</p>
                          <p className="text-[13px] text-ink-2">Your first 10 cost nothing.</p>
                        </>
                      )}
                    </div>
                    <Link href="/signup" className={buttonClasses(plan.highlight ? "primary" : "secondary", "md", "mt-5 w-full")}>
                      Start free
                    </Link>
                    <ul className="mt-5 grid gap-2.5 border-t border-line pt-5 text-[14px] leading-[21px] text-ink-2">
                      {plan.features.map((f) => (
                        <li key={f} className="flex items-start gap-2.5">
                          <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-lane" strokeWidth={3} />
                          {f}
                        </li>
                      ))}
                    </ul>
                  </article>
                </Reveal>
              </li>
            );
          })}
        </ul>
        <p className="mt-6 max-w-[80ch] text-[13px] leading-[20px] text-ink-3">
          Every plan starts on Free: you begin with 10 applications and upgrade later. Paid checkout is not open yet, so these are planned prices and may
          change before then. Currency follows your browser language; switch it any time.
        </p>
      </div>
    </section>
  );
}
