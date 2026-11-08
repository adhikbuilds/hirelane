import { devPagesOpen } from "@/lib/dev-gate";
import { notFound } from "next/navigation";
import { CampusShell, Privacy, SampleNote } from "@/components/campus/Console";
import { StudentsPage } from "@/components/campus/Pages";
import { SAMPLE_CAMPUS, SAMPLE_PROGRAMMES } from "@/lib/sample/campus";

export const metadata = { title: "Console: students", robots: { index: false, follow: false } };

export default function Page() {
  if (!devPagesOpen()) notFound();
  return (
    <CampusShell college={SAMPLE_CAMPUS.college} active="students">
      <SampleNote />
      <StudentsPage rows={SAMPLE_PROGRAMMES} />
      <Privacy />
    </CampusShell>
  );
}
