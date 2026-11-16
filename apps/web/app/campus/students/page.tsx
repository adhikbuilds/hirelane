import { CampusShell, Privacy, SampleNote } from "@/components/campus/Console";
import { StudentsPage } from "@/components/campus/Pages";
import { loadCampusStudents } from "@/lib/adapters/load";
import { SAMPLE_CAMPUS, SAMPLE_PROGRAMMES } from "@/lib/sample/campus";

export const metadata = { title: "Console: students", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Totals by programme from the nightly snapshot, plus the roster import. A hidden cell prints as hidden; Eligible and Applied have no source, so they are not shown. */
export default async function Page() {
  const s = await loadCampusStudents();
  const real = s.source === "real";
  return (
    <CampusShell college={real ? s.data.college : SAMPLE_CAMPUS.college} active="students">
      {real ? null : <SampleNote />}
      {real ? <StudentsPage real rows={s.data.rows} cohorts={s.data.cohorts} /> : <StudentsPage rows={SAMPLE_PROGRAMMES} />}
      <Privacy />
    </CampusShell>
  );
}
