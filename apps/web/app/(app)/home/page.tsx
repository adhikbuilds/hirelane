import { HomeA } from "@/components/student/HomeA";
import { loadHome } from "@/lib/adapters/load";
import { DECK } from "@/lib/sample/deck";
import { SAMPLE_HOME } from "@/lib/sample/home";

export const metadata = { title: "Home", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Student Home. Real when signed in; the labelled sample only in development when there is nothing to show. */
export default async function Page() {
  const s = await loadHome();
  // No picks service yet (HLD M3), so a real student's deck is empty rather than sample cards.
  return s.source === "real" ? <HomeA data={s.data.home} deck={[]} /> : <HomeA data={SAMPLE_HOME} deck={DECK} />;
}
