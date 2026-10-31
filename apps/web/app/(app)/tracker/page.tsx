import type { Metadata } from "next";
import { StudentShell } from "@/components/student/AppShell";
import { TrackerPanes } from "@/components/student/TrackerView";
import { loadStudentTracker } from "@/lib/student/load";
import { SAMPLE_MESSAGES, SAMPLE_RECEIPT, SAMPLE_TRACKER } from "@/lib/student/sample";

export const metadata: Metadata = { title: "Tracker", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function TrackerPage({ searchParams }: { searchParams: Promise<{ a?: string; m?: string; v?: string }> }) {
  const q = await searchParams;
  const s = await loadStudentTracker({ a: q.a ?? null, m: q.m ?? null });
  const tab = q.v === "inbox" ? "inbox" : "applications";
  if (s.source === "real") {
    const d = s.data;
    return (
      <StudentShell active="tracker" initial={d.initial} badge={d.badge}>
        <TrackerPanes view={d.view} selected={d.selected} message={d.message} tab={tab} sample={false} detail={Boolean(q.a || q.m)} />
      </StudentShell>
    );
  }
  const pickId = q.a ?? "kosha";
  const row = SAMPLE_TRACKER.groups.flatMap((g) => g.rows).find((r) => r.id === pickId) ?? null;
  const selected = row ? { id: row.id, company: row.company, role: row.role, receipt: row.id === "kosha" ? SAMPLE_RECEIPT : null, fallbackUrl: row.finish ? "https://careers.brightdesk.in/jobs/csa-2026" : null } : null;
  const message = q.m ? (SAMPLE_MESSAGES.find((m) => m.id === q.m) ?? null) : (SAMPLE_MESSAGES.find((m) => m.applicationId === selected?.id) ?? null);
  return (
    <StudentShell active="tracker" initial="R" badge={SAMPLE_TRACKER.badge}>
      <TrackerPanes view={SAMPLE_TRACKER} selected={selected} message={message} tab={tab} sample detail={Boolean(q.a || q.m)} />
    </StudentShell>
  );
}
