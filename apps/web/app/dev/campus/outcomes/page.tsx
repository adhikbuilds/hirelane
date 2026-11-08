import { devPagesOpen } from "@/lib/dev-gate";
import { notFound } from "next/navigation";
import { CampusShell, SampleNote } from "@/components/campus/Console";
import { OutcomesPage } from "@/components/campus/Pages";
import { SAMPLE_CAMPUS, SAMPLE_OFFERS } from "@/lib/sample/campus";

export const metadata = { title: "Console: outcomes", robots: { index: false, follow: false } };

export default function Page() {
  if (!devPagesOpen()) notFound();
  return (
    <CampusShell college={SAMPLE_CAMPUS.college} active="outcomes">
      <SampleNote />
      <OutcomesPage offers={SAMPLE_OFFERS} outgoing={412} higherStudies={38} placedOnRoster={96} verified={22} waiting={9} />
    </CampusShell>
  );
}
