import type { Metadata } from "next";
import { PasteForm } from "@/components/student/PasteForm";
import { StudentShell } from "@/components/student/AppShell";
import { loadStudentChrome } from "@/lib/student/load";

export const metadata: Metadata = { title: "Paste a job", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function PastePage() {
  const s = await loadStudentChrome();
  const real = s.source === "real";
  return (
    <StudentShell active={null} initial={real ? s.data.initial : "R"} badge={real ? s.data.badge : 2}>
      <div className="st-a-head">
        <h1 className="st-a-title">Found a job somewhere else?</h1>
        <p className="st-a-count">Paste it. We check if you qualify and if it looks like a scam.</p>
        {real ? null : <p className="st-sample">Sample student. The check below is a fixed example.</p>}
      </div>
      <PasteForm sample={!real} />
    </StudentShell>
  );
}
