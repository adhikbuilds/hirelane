import { notFound } from "next/navigation";
import { HomeA } from "@/components/student/HomeA";
import { DECK } from "@/lib/sample/deck";
import { SAMPLE_HOME } from "@/lib/sample/home";

export const metadata = { title: "Home", robots: { index: false, follow: false } };

/** Student Home, direction A, on a labelled sample student. 404 in production until picks are wired. */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <HomeA data={SAMPLE_HOME} deck={DECK} />;
}
