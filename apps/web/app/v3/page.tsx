import { startIndex } from "@/components/landing-v3/hero/road";
import { loadRoad } from "@/components/landing-v3/hero/road-load";
import { Hero } from "@/components/landing-v3/hero/hero";
import { FooterLine, Moments, Pricing, StartPanel } from "@/components/landing-v3/sections";
import { buildStackCards } from "@/components/landing-v3/stack/cards";
import { ScrollTour } from "@/components/landing-v3/tour/tour";
import { agoShort } from "@/components/landing/demo-model";
import { getLandingSnapshot, getStackExtras } from "@/lib/queries/landing";

const fmt = new Intl.NumberFormat("en-US");

export default async function Home() {
  const snapshot = await getLandingSnapshot();
  const extras = await getStackExtras(snapshot.demo.map((j) => j.slug));
  const now = new Date();
  const cards = buildStackCards(snapshot.demo, extras, now);
  const shots = loadRoad();
  const { counts } = snapshot;

  return (
    <div data-landing="v3" data-ground="forest" className="bg-background text-foreground">
      <Hero
        cards={cards}
        shots={shots}
        start={startIndex(now)}
        counts={{
          roles: fmt.format(counts.openJobs),
          companies: fmt.format(counts.companies),
          updated: counts.asOf ? agoShort(counts.asOf, now) : null,
        }}
      />
      <ScrollTour card={cards.find((c) => c.needs) ?? cards[0] ?? null} trace={snapshot.trace} />
      <Moments />
      <Pricing />
      <StartPanel />
      <FooterLine />
    </div>
  );
}
