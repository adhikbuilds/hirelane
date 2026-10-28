import { notFound } from "next/navigation";
import { StudentShell } from "@/components/student/Shell";
import { CompanyPage } from "@/components/app/Detail";
import { DECK } from "@/lib/sample/deck";

export const metadata = { title: "Company", robots: { index: false, follow: false } };

/** Sample company page until the company graph is wired. 404 in production. */
export default async function CoPage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { id } = await params;
  const card = DECK.find((c) => c.id === id);
  if (!card) notFound();
  return (
    <StudentShell active="jobs" initials="R">
      <CompanyPage card={card} roles={[card]} sample />
    </StudentShell>
  );
}
