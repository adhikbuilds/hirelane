import type { Metadata } from "next";
import { StudentShell } from "@/components/student/Shell";
import { Tracker } from "@/components/app/DrivesTracker";
import { loadTracker } from "@/lib/adapters/load";
import { SAMPLE_TRACKER } from "@/lib/sample/loop";

export const metadata: Metadata = { title: "Tracker", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function TrackerPage() {
  const s = await loadTracker();
  const real = s.source === "real";
  return (
    <StudentShell active="tracker" initials={real ? s.data.initial : "R"}>
      <div className="wr-app">
        {real ? null : <p className="wr-sample">Sample applications. Phones group them by stage; laptops show a board.</p>}
        <Tracker items={real ? s.data.items : SAMPLE_TRACKER} />
      </div>
    </StudentShell>
  );
}
