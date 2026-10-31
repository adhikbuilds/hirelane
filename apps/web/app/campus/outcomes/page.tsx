import { CampusShell, SampleNote } from "@/components/campus/Console";
import { OutcomesPage } from "@/components/campus/Pages";
import { loadCampusOutcomes } from "@/lib/adapters/load";
import { SAMPLE_CAMPUS, SAMPLE_OFFERS } from "@/lib/sample/campus";

export const metadata = { title: "Console: outcomes", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Development only until OutcomesPage stops hard-coding its placed total (production answers 404, as before). */
export default async function Page() {
  const s = await loadCampusOutcomes();
  const real = s.source === "real";
  return (
    <CampusShell college={real ? s.data.college : SAMPLE_CAMPUS.college} active="outcomes">
      {real ? null : <SampleNote />}
      <OutcomesPage offers={real ? s.data.offers : SAMPLE_OFFERS} outgoing={real ? s.data.outgoing : 412} higherStudies={real ? 0 : 38} />
    </CampusShell>
  );
}
