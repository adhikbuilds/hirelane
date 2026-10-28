import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StudentShell } from "@/components/student/Shell";
import { Tracker } from "@/components/app/DrivesTracker";
import { SAMPLE_TRACKER } from "@/lib/sample/loop";

export const metadata: Metadata = { title: "Tracker preview", robots: { index: false, follow: false } };

export default function TrackerPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <StudentShell active="tracker" initials="R">
      <div className="wr-app">
        <p className="wr-sample">Sample applications. Phones group them by stage; laptops show a board.</p>
        <Tracker items={SAMPLE_TRACKER} />
      </div>
    </StudentShell>
  );
}
