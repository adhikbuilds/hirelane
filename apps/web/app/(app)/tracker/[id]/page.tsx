import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { FinishView } from "@/components/student/FinishView";
import { StudentShell } from "@/components/student/AppShell";
import { loadFinish } from "@/lib/student/load";
import { SAMPLE_FINISH, SAMPLE_HOME } from "@/lib/student/sample";

export const metadata: Metadata = { title: "Finish on their site", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** An application that stopped on something only the student can do. One that is not blocked goes back to the Tracker. */
export default async function FinishPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await loadFinish(id);
  if (s.source === "real") {
    if (!s.data.finish) redirect(`/tracker?a=${encodeURIComponent(id)}`);
    return (
      <StudentShell active="tracker" initial={s.data.chrome.initial} badge={s.data.chrome.badge}>
        <FinishView finish={s.data.finish} sample={false} />
      </StudentShell>
    );
  }
  if (id !== SAMPLE_FINISH.id) notFound();
  return (
    <StudentShell active="tracker" initial="R" badge={2}>
      <FinishView finish={SAMPLE_FINISH} sample codes={SAMPLE_HOME.codes} />
    </StudentShell>
  );
}
