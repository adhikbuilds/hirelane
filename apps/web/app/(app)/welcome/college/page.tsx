import type { Metadata } from "next";
import { CollegeStep } from "@/components/student/Onboarding";
import { AuthShell } from "@/components/student/AppShell";
import { loadOnboarding } from "@/lib/student/load";

export const metadata: Metadata = { title: "Join your college", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Onboarding step 5: join the placement cell's drives. Skippable. */
export default async function Page() {
  const s = await loadOnboarding();
  const real = s.source === "real";
  return (
    <AuthShell>
      <CollegeStep sample={!real} joined={real ? s.data.joined : false} />
    </AuthShell>
  );
}
