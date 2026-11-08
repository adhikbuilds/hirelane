import { devPagesOpen } from "@/lib/dev-gate";
import { notFound } from "next/navigation";
import { NextLanding } from "@/components/landing/Next";
import { getLandingSnapshot, indiaRoles, loadEmployers } from "@/lib/queries/landing";

export const metadata = { title: "Landing preview", robots: { index: false, follow: false } };

export default async function Page() {
  if (!devPagesOpen()) notFound();
  const [india, employers, snap] = await Promise.all([indiaRoles(), loadEmployers(), getLandingSnapshot().catch(() => null)]);
  return <NextLanding counts={{ indiaRoles: india, companies: snap?.counts.companies ?? null, employers }} />;
}
