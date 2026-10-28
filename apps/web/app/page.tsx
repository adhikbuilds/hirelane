import type { Metadata } from "next";
import { NextLanding } from "@/components/landing/Next";
import { getLandingSnapshot, indiaRoles, loadEmployers } from "@/lib/queries/landing";

export const metadata: Metadata = {
  title: { absolute: "Hirelane: off-campus jobs, matched to your marks" },
  description: "Hirelane reads every rule in a drive notice, checks it against your marks, and applies when you swipe right. Free for students.",
};

/** Live counts come from the job index; if it's unreachable the page renders without them (never invented). */
export default async function Home() {
  const [india, employers, snap] = await Promise.all([indiaRoles(), loadEmployers(), getLandingSnapshot().catch(() => null)]);
  return <NextLanding counts={{ indiaRoles: india, companies: snap?.counts.companies ?? null, employers }} />;
}
