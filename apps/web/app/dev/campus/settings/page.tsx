import { notFound } from "next/navigation";
import { CampusShell, SampleNote } from "@/components/campus/Console";
import { SettingsPage } from "@/components/campus/Pages";
import { SAMPLE_CAMPUS } from "@/lib/sample/campus";

export const metadata = { title: "Console: settings", robots: { index: false, follow: false } };

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <CampusShell college={SAMPLE_CAMPUS.college} active="settings">
      <SampleNote />
      <SettingsPage />
    </CampusShell>
  );
}
