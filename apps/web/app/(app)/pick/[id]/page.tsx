import { notFound } from "next/navigation";
import { AccountShell } from "@/components/account/AccountShell";
import { JobDetail } from "@/components/app/Detail";
import { DECK } from "@/lib/sample/deck";

export const metadata = { title: "Role", robots: { index: false, follow: false } };

/** Sample job page until picks are wired (HLD M3). 404 in production. */
export default async function PickPage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { id } = await params;
  const card = DECK.find((c) => c.id === id);
  if (!card) notFound();
  return (
    <AccountShell>
      <JobDetail card={card} sample />
    </AccountShell>
  );
}
