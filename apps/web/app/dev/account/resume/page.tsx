import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { assessHealth, evaluateEligibility, parseCriteria } from "@hirelane/engine";
import type { ExtractMeta } from "@hirelane/engine";
import { AccountShell } from "@/components/account/AccountShell";
import { EligibilityVerdict, ResumeHealth } from "@/components/app/ResumeHealth";
import { TabBar } from "@/components/app/TabBar";

export const metadata: Metadata = { title: "Resume preview", robots: { index: false, follow: false } };

/** A synthetic tier-3 resume (biodata habits, a fake-but-valid-looking Aadhaar is NOT used: the engine fixture style). */
const SAMPLE_TEXT = `Rahul Sample
rahul.sample@example.test | +91 90000 00001

CAREER OBJECTIVE
To work in a reputed organisation and grow with it.

EDUCATIONAL DETAILS
B.Com, Sample College of Commerce, Indore, 2022-2025, 64%
12th (MP Board), 2022, 58%
10th (MP Board), 2020, 71%

SKILLS
Tally, MS Excel, Communication

PROJECTS
GST billing sheet for a local shop

PERSONAL DETAILS
Father's Name: Sample Father
Date of Birth: 01/01/2004
Marital Status: Single

DECLARATION
I hereby declare that the above information is true.`;

const META: ExtractMeta = {
  kind: "pdf",
  pages: 2,
  pageStats: [{ chars: 520, images: 1 }, { chars: 180, images: 0 }],
  imageCount: 1,
  encrypted: false,
  flags: { javascript: false, embeddedFiles: false, macros: false, externalRefs: false },
  producerFamily: "canva",
};

const NOTICE = "Eligibility: 60% throughout in 10th, 12th and graduation. B.E/B.Tech or MCA only. 2025 and 2026 passouts.";

/** Dev-only preview: the real engine runs on synthetic text, so this is what a student would really see. */
export default function ResumePreview() {
  if (process.env.NODE_ENV === "production") notFound();
  const report = assessHealth({ text: SAMPLE_TEXT, meta: META, fileName: "WhatsApp Document 2025.pdf" });
  const result = evaluateEligibility(
    parseCriteria(NOTICE),
    { pct_10: 71, secondary_kind: "12th", pct_secondary: 58, degree: "B.Com", grad_score: 64, grad_scale: 100, grad_pct_equiv: 64, grad_conversion: "direct", passout_year: 2025, active_backlogs: 0, confirmed: true },
    { cgpaRule: null },
  );
  return (
    <AccountShell>
      <div className="wr-app">
        <p className="wr-sample">Sample resume and drive notice, checked by the real engine. Nothing here is a real person.</p>
        <h1 className="acct-display wr-hello">Your resume.</h1>
        <ResumeHealth report={report} />
        <EligibilityVerdict result={result} roleLabel="Trainee Engineer, IT services firm (sample)" />
        <TabBar active="you" />
      </div>
    </AccountShell>
  );
}
