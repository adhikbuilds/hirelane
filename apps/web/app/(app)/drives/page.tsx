import type { Metadata } from "next";
import { StudentShell } from "@/components/student/Shell";
import { DrivesList } from "@/components/app/DrivesTracker";
import { loadDrives } from "@/lib/adapters/load";
import { SAMPLE_DRIVES } from "@/lib/sample/loop";

export const metadata: Metadata = { title: "Drives", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function DrivesPage() {
  const s = await loadDrives();
  const real = s.source === "real";
  return (
    <StudentShell active="drives" initials={real ? s.data.initial : "R"}>
      <div className="wr-app">
        {real ? null : <p className="wr-sample">Sample drives a placement cell pasted, checked against a sample student&apos;s marks.</p>}
        <h1 className="acct-display wr-hello">Drives.</h1>
        <DrivesList drives={real ? s.data.drives : SAMPLE_DRIVES} />
      </div>
    </StudentShell>
  );
}
