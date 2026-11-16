import { devPagesOpen } from "@/lib/dev-gate";
import { notFound } from "next/navigation";
import { StudentLanding } from "@/components/landing/Students";

export const metadata = { title: "Student landing preview", robots: { index: false, follow: false } };

export default function Page() {
  if (!devPagesOpen()) notFound();
  return <StudentLanding />;
}
