import type { Metadata } from "next";
import { ApplyStep } from "@/components/student/Onboarding";
import { AuthShell } from "@/components/student/AppShell";
import { loadOnboarding } from "@/lib/student/load";
import { SAMPLE_ADDRESS } from "@/lib/student/sample";

export const metadata: Metadata = { title: "Swipe right", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Onboarding step 4: whether a right swipe applies for the student. */
export default async function Page() {
  const s = await loadOnboarding();
  const real = s.source === "real";
  return (
    <AuthShell>
      <ApplyStep pilot={real ? s.data.pilot : true} address={real ? s.data.applyAddress : SAMPLE_ADDRESS} sample={!real} />
    </AuthShell>
  );
}
