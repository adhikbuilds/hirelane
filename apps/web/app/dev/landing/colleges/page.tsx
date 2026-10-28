import { notFound } from "next/navigation";
import { CollegeLanding } from "@/components/landing/Colleges";

export const metadata = { title: "College landing preview", robots: { index: false, follow: false } };

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CollegeLanding />;
}
