import { headers } from "next/headers";
import { ROLE_FAMILIES } from "@hirelane/engine";
import { Autopilot } from "@/components/landing/autopilot";
import { ClosingCta } from "@/components/landing/closing-cta";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { NeverDoes } from "@/components/landing/never-does";
import { Pricing } from "@/components/landing/pricing";
import { currencyFor } from "@/components/landing/pricing-model";
import { SalaryTruth } from "@/components/landing/salary-truth";
import { Ticker } from "@/components/landing/ticker";
import { getLandingSnapshot } from "@/lib/queries/landing";

export default async function Home() {
  const [snapshot, h] = await Promise.all([getLandingSnapshot(), headers()]);
  const now = new Date();
  const currency = currencyFor(h.get("accept-language"));

  return (
    <>
      <Hero snapshot={snapshot} now={now} />
      <Ticker jobs={snapshot.ticker} now={now} />
      <HowItWorks />
      <SalaryTruth trace={snapshot.trace} withSalary={snapshot.counts.withSalary} openJobs={snapshot.counts.openJobs} />
      <Autopilot initial={snapshot.autopilot} roles={[...ROLE_FAMILIES]} sample={snapshot.demo} />
      <NeverDoes />
      <Pricing initialCurrency={currency} />
      <ClosingCta />
    </>
  );
}
