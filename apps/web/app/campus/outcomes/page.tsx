import { CampusShell, SampleNote } from "@/components/campus/Console";
import { OutcomesPage } from "@/components/campus/Pages";
import { loadCampusOutcomes } from "@/lib/adapters/load";
import { SAMPLE_CAMPUS, SAMPLE_OFFERS } from "@/lib/sample/campus";

export const metadata = { title: "Console: outcomes", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Outcomes and NAAC from the services. Counts come from the data; names stay hidden until the staff member presses
 * "Show names", so a refresh writes nothing to any student's access log. The sample is development only.
 */
export default async function Page() {
  const s = await loadCampusOutcomes();
  if (s.source !== "real")
    return (
      <CampusShell college={SAMPLE_CAMPUS.college} active="outcomes">
        <SampleNote />
        <OutcomesPage offers={SAMPLE_OFFERS} outgoing={412} higherStudies={38} placedOnRoster={96} verified={22} waiting={9} />
      </CampusShell>
    );
  const d = s.data;
  return (
    <CampusShell college={d.college} active="outcomes">
      <OutcomesPage real offers={d.offers} outgoing={d.outgoing} higherStudies={d.higherStudies} placedOnRoster={d.placedOnRoster} verified={d.verified} waiting={d.waiting} />
    </CampusShell>
  );
}
