import type { Metadata } from "next";
import Link from "next/link";
import { PageShell, Rows, Section } from "@/components/landing/page-shell";

export const metadata: Metadata = {
  title: "How it works",
  description: "What Hirelane does with a job and your resume, and what it never does.",
};

const does = [
  { lead: "Reads public boards", text: "Jobs come from the public job board APIs that employers publish through Greenhouse, Lever and Ashby. Each job keeps a link to its source." },
  { lead: "Shows pay with its working", text: "When a posting states pay, Hirelane normalises it to a yearly figure in USD and INR and shows every step, including the exchange-rate date. When a posting states none, the pay column says so." },
  { lead: "Matches in the open", text: "Your resume is compared with each requirement. The score is written as an equation, and each requirement points at the line of your resume that supports it." },
  { lead: "Drafts from your resume", text: "Answers are drafted from your resume and your saved answers. Each draft says where it came from." },
  { lead: "Holds what it cannot support", text: "Anything the resume does not cover, such as work authorisation, is marked Needs you and stays empty until you fill it in." },
  { lead: "Waits for your approval", text: "Nothing leaves until you approve. After approval there is a four second undo window." },
  { lead: "Hands off", text: "After the undo window, Hirelane gives you the employer's own application form with your resume and answers ready to copy. You submit it there." },
];

const never = [
  { lead: "Submit for you", text: "Hirelane prepares applications and hands off to the employer's form. It does not submit them." },
  { lead: "Invent experience", text: "A draft that needs a fact your resume does not contain is held for you rather than filled in." },
  { lead: "Estimate pay", text: "If a posting states no pay, no figure is shown. There are no salary guesses." },
  { lead: "Take jobs from social networks", text: "Only public employer board APIs are read. Nothing is taken from LinkedIn, Indeed or any other aggregator." },
  { lead: "Use your resume without consent", text: "Your resume is stored encrypted, kept out of logs, and sent to a language model only if you switch that on." },
  { lead: "Sign in as you", text: "Hirelane never holds a login to an employer's system or to your inbox for sending." },
];

export default function HowItWorks() {
  return (
    <PageShell
      title="What Hirelane does, and what it never does."
      lede="A job search is logistics. Hirelane does the reading and the drafting, and leaves every decision and every send to you."
    >
      <Section id="does" title="What it does">
        <Rows rows={does} />
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
