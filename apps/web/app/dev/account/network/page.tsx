import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StudentShell } from "@/components/student/Shell";
import { Network, type WarmCompany } from "@/components/app/PasteNetwork";

export const metadata: Metadata = { title: "Who you know preview", robots: { index: false, follow: false } };

const COMPANIES: WarmCompany[] = [
  { company: "Zenoti", hiring: "Customer Support Associate", people: [{ initials: "AK", title: "Senior Support Engineer" }] },
  { company: "Payoneer", hiring: "Operations Analyst", people: [{ initials: "SM", title: "Team Lead" }, { initials: "RJ", title: "Analyst" }] },
  { company: "Sigmoid", hiring: "Data Operations Trainee", people: [{ initials: "PV", title: "Recruiter" }] },
];

/** Dev-only: before and after uploading connections. Sample people (initials only). */
export default function NetworkPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <StudentShell active="me" initials="R">
      <div className="wr-app">
        <p className="wr-sample">Sample connections (initials only). Real ones come from the student&apos;s own LinkedIn file and stay private to them.</p>
        <h1 className="acct-display wr-hello">Who you know.</h1>
        <Network uploaded={false} companies={[]} draftFor={null} stage="requested" />
        <Network uploaded companies={COMPANIES} draftFor={COMPANIES[0] ?? null} />
      </div>
    </StudentShell>
  );
}
