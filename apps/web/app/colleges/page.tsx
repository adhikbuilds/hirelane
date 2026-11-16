import type { Metadata } from "next";
import { CollegeLanding } from "@/components/landing/Colleges";

export const metadata: Metadata = {
  title: "For placement cells",
  description: "Placement help after the drives end: eligible off-campus roles, readable resumes and outcomes you can file for NAAC.",
};

export default function CollegesPage() {
  return <CollegeLanding />;
}
