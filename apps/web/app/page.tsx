import type { Metadata } from "next";
import { StudentLanding } from "@/components/landing/Students";

export const metadata: Metadata = {
  title: { absolute: "Hirelane: jobs you can actually get" },
  description: "For freshers and final-years: fresh roles from company career pages, checked against your marks, applied on the company's own site.",
};

export default function Home() {
  return <StudentLanding />;
}
