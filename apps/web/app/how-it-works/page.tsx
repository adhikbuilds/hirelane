import type { Metadata } from "next";
import Link from "next/link";
import { PageShell, Rows, Section } from "@/components/landing/page-shell";

export const metadata: Metadata = {
  title: "How it works",
  description: "What Hirelane does with a job and your resume, and what it never does.",
};

const live = [
  { lead: "Reads public boards", text: "Jobs come from the public job board APIs that employers publish through Greenhouse, Lever and Ashby. Each job keeps a link to its source and the time it was last checked." },
  { lead: "Shows pay with its working", text: "When a posting states pay, Hirelane normalises it to a yearly figure in USD and INR and shows every step, including the exchange-rate date. When a posting states none, the pay column says so." },
  { lead: "Lists every requirement", text: "Each job page splits the posting into must-have and nice-to-have requirements, so you can judge the fit yourself." },
];

const soon = [
  { lead: "Matches in the open", text: "Your resume will be compared with each requirement. The score will be written as an equation, and each requirement will point at the line of your resume that supports it." },
  { lead: "Drafts from your resume", text: "Answers will be drafted from your resume and your saved answers, each saying where it came from." },
  { lead: "Holds what it cannot support", text: "Anything the resume does not cover, such as work authorisation, will be marked Needs you and left empty until you fill it in." },
  { lead: "Waits for your approval", text: "Nothing will leave until you approve, with a four second undo after approval." },
  { lead: "Hands off", text: "Hirelane will open the employer's own application form with your answers ready to copy. You submit it there." },
];

const never = [
  { lead: "Submit for you", text: "Hirelane is built to prepare applications and hand off to the employer's form. It will not submit them." },
  { lead: "Invent experience", text: "A draft that needs a fact your resume does not contain will be held for you rather than filled in." },
  { lead: "Estimate pay", text: "If a posting states no pay, no figure is shown. There are no salary guesses." },
  { lead: "Take jobs from social networks", text: "Only public employer board APIs are read. Nothing is taken from LinkedIn, Indeed or any other aggregator." },
  { lead: "Keep your resume today", text: "Resumes are not uploaded or stored yet. The sample on the front page runs in your browser and reads nothing. When accounts open, resumes will be encrypted, kept out of logs, and sent to a language model only if you switch that on." },
  { lead: "Sign in as you", text: "Hirelane never holds a login to an employer's system or to your inbox for sending." },
];

export default function HowItWorks() {
  return (
    <PageShell
      title="What Hirelane does, and what it never does."
      lede="A job search is logistics. Today Hirelane does the reading: a public board of real roles with honest pay. Drafting and hand-off open with early access, and every decision and every send stays with you."
    >
      <Section id="does" title="Live today">
        <Rows rows={live} />
      </Section>
      <Section id="soon" title="Coming with early access">
        <Rows rows={soon} />
      </Section>
      <Section id="never" title="What it never does">
        <Rows rows={never} />
      </Section>
      <p className="text-ink-2">
        See the live board on the <Link href="/" className="font-medium text-lane hover:underline">front page</Link>, or read{" "}
        <Link href="/compare" className="font-medium text-lane hover:underline">how this differs from other tools</Link>.
      </p>
    </PageShell>
  );
}
