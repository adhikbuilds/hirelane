import { devPagesOpen } from "@/lib/dev-gate";
import { notFound } from "next/navigation";
import { CollegeLanding } from "@/components/landing/Colleges";

export const metadata = { title: "College landing preview", robots: { index: false, follow: false } };

export default function Page() {
  if (!devPagesOpen()) notFound();
  return <CollegeLanding />;
}
