import { Autopilot, Faq, FinalCta, LaneLine, LiveBoard, PayTrust, Pricing, Problem } from "@/components/landing-v4/sections";
import { getLandingSnapshot } from "@/lib/queries/landing";

export const dynamic = "force-dynamic";

export default async function Preview() {
  const snap = await getLandingSnapshot();
  return (
    <div data-landing="v4" className="bg-background text-foreground">
      <LaneLine>
        <div data-chapter="Hook" className="h-[60vh] px-12 pt-40 text-5xl font-extrabold">Hero stand-in</div>
        <Problem />
        <div id="workflow" data-chapter="Try it" className="h-[50vh] px-12 pt-24 text-3xl font-extrabold">Workflow stand-in</div>
        <Autopilot />
        <PayTrust trace={snap.trace} />
        <LiveBoard />
        <Pricing />
        <Faq />
        <FinalCta />
      </LaneLine>
    </div>
  );
}
