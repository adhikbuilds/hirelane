import { notFound } from "next/navigation";
import { CampusShell, SampleNote } from "@/components/campus/Console";
import { DrivesInboxPage } from "@/components/campus/Pages";
import { SAMPLE_CAMPUS, SAMPLE_NOTICE } from "@/lib/sample/campus";

export const metadata = { title: "Console: drives", robots: { index: false, follow: false } };

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <CampusShell college={SAMPLE_CAMPUS.college} active="drives">
      <SampleNote />
      <DrivesInboxPage notice={SAMPLE_NOTICE} />
    </CampusShell>
  );
}
