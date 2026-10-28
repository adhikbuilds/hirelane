import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StudentShell } from "@/components/student/Shell";
import { DrivesList } from "@/components/app/DrivesTracker";
import { SAMPLE_DRIVES } from "@/lib/sample/loop";

export const metadata: Metadata = { title: "Drives preview", robots: { index: false, follow: false } };

export default function DrivesPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <StudentShell active="drives" initials="R">
      <div className="wr-app">
        <p className="wr-sample">Sample drives a placement cell pasted, checked against a sample student&apos;s marks.</p>
        <h1 className="acct-display wr-hello">Drives.</h1>
        <DrivesList drives={SAMPLE_DRIVES} />
      </div>
    </StudentShell>
  );
}
