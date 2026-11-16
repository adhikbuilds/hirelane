import { devPagesOpen } from "@/lib/dev-gate";
import { notFound } from "next/navigation";
import { HomeA } from "@/components/student/HomeA";
import { SAMPLE_HOME } from "@/lib/student/sample";

export const metadata = { title: "Home", robots: { index: false, follow: false } };

/** Student Home, direction A, on a labelled sample student. 404 in production; the real route is /home. */
export default function Page() {
  if (!devPagesOpen()) notFound();
  return <HomeA data={SAMPLE_HOME} />;
}
