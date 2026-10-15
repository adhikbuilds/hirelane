import { HeroLedger } from "@/components/landing/hero-ledger";
import { getLandingData } from "@/components/landing/data";
import { PricingPlaceholder } from "@/components/landing/pricing";
import { ApplicationPreview } from "@/components/landing/preview";

export const revalidate = 300;

export default async function Home() {
  const data = await getLandingData(12);
  const now = new Date();

  return (
    <div className="mx-auto w-full max-w-page px-4 sm:px-8 py-12">
      <h1 className="display max-w-[26ch] text-[40px] sm:text-[56px]">
        Applications drafted from your resume, handed to the employer&apos;s form only when you approve.
      </h1>
      <div className="mt-12">
        <HeroLedger data={data} now={now} />
      </div>
      <ApplicationPreview />
      <PricingPlaceholder />
    </div>
  );
}
