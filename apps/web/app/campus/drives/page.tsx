import { CampusShell, SampleNote } from "@/components/campus/Console";
import { DriveConsole } from "@/components/campus/DriveConsole";
import { DrivesInboxPage } from "@/components/campus/Pages";
import { loadCampusDrives } from "@/lib/adapters/load";
import { SAMPLE_CAMPUS, SAMPLE_NOTICE } from "@/lib/sample/campus";

export const metadata = { title: "Console: drives", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** The drive inbox: paste a notice, check it, save a draft, announce, close. All steps call the TPO drive routes. The static sample form is development only. */
export default async function Page() {
  const s = await loadCampusDrives();
  if (s.source !== "real")
    return (
      <CampusShell college={SAMPLE_CAMPUS.college} active="drives">
        <SampleNote />
        <DrivesInboxPage notice={SAMPLE_NOTICE} />
      </CampusShell>
    );
  return (
    <CampusShell college={s.data.college} active="drives">
      <DriveConsole data={s.data} />
    </CampusShell>
  );
}
