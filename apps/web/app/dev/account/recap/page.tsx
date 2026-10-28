import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StudentShell } from "@/components/student/Shell";
import { RecapCard } from "@/components/app/DrivesTracker";
import { SAMPLE_RECAP } from "@/lib/sample/loop";

export const metadata: Metadata = { title: "Recap preview", robots: { index: false, follow: false } };

export default function RecapPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <StudentShell active="home" initials="R">
      <div className="wr-app">
        <p className="wr-sample">Sample week. Counts are only what the student did; nothing is padded.</p>
        <RecapCard recap={SAMPLE_RECAP} />
      </div>
    </StudentShell>
  );
}
