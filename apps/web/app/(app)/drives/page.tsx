import type { Metadata } from "next";
import { DrivesView } from "@/components/student/DrivesView";
import { StudentShell } from "@/components/student/AppShell";
import { loadStudentDrives } from "@/lib/student/load";
import { SAMPLE_DRIVES } from "@/lib/student/sample";

export const metadata: Metadata = { title: "Drives", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function DrivesPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const { d } = await searchParams;
  const s = await loadStudentDrives();
  const real = s.source === "real";
  return (
    <StudentShell active="drives" initial={real ? s.data.initial : "R"} badge={real ? s.data.badge : 2}>
      <DrivesView drives={real ? s.data.drives : SAMPLE_DRIVES} selectedId={d ?? null} college={real ? s.data.college : "Sample University, Indore. B.Com, batch of 2026."} />
    </StudentShell>
  );
}
