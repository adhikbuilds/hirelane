import { CampusShell, SampleNote } from "@/components/campus/Console";
import { SettingsPage } from "@/components/campus/Pages";
import { loadCampusSettings } from "@/lib/adapters/load";
import { SAMPLE_CAMPUS } from "@/lib/sample/campus";

export const metadata = { title: "Console: settings", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Settings from the services: the university rule matched by the college name and the staff seats. The static sample is development only. */
export default async function Page() {
  const s = await loadCampusSettings();
  if (s.source !== "real")
    return (
      <CampusShell college={SAMPLE_CAMPUS.college} active="settings">
        <SampleNote />
        <SettingsPage />
      </CampusShell>
    );
  return (
    <CampusShell college={s.data.college} active="settings">
      <SettingsPage real college={s.data.college} universityRule={s.data.universityRule} staff={s.data.staff} />
    </CampusShell>
  );
}
