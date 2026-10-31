import { HomeA } from "@/components/student/HomeA";
import { loadStudentHome } from "@/lib/student/load";
import { SAMPLE_HOME } from "@/lib/student/sample";

export const metadata = { title: "Home", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Student Home. Real when signed in; the labelled sample only in development when there is nothing to show. */
export default async function Page() {
  const s = await loadStudentHome();
  return <HomeA data={s.source === "real" ? s.data : SAMPLE_HOME} />;
}
