import Link from "next/link";
import { AccountShell } from "@/components/account/AccountShell";
import { Button } from "@/components/shadcn/button";

const STEPS = [
  { n: "1", title: "Check your resume", text: "See what a company's hiring software sees, and fix it in minutes. Or build one from 8 short questions." },
  { n: "2", title: "See roles you qualify for", text: "We read every rule: 60% throughout, backlogs, batch, branch. You only swipe jobs you can actually apply to." },
  { n: "3", title: "Apply on the company's site", text: "Your answers are ready to copy. You press submit; we track the reply." },
];

/** Student landing page in the Wrapped register. Server component, no client JS. */
export function StudentLanding() {
  return (
    <AccountShell
      right={
        <nav className="ld-nav" aria-label="Site">
          <Link href="/jobs">Browse jobs</Link>
          <Link href="/colleges">For colleges</Link>
          <Button asChild variant="lime" size="pill-sm">
            <Link href="/signin">Sign in</Link>
          </Button>
        </nav>
      }
    >
      <div className="ld">
        <section className="ld-hero">
          <div>
            <h1 className="acct-display ld-h1">Jobs you can actually get.</h1>
            <p className="acct-lede">For freshers and final-years. Fresh roles from company career pages, checked against your marks, applied on the company&apos;s own site.</p>
            <div className="ld-cta">
              <Button asChild variant="lime" size="pill">
                <Link href="/signin">Check my resume, free</Link>
              </Button>
            </div>
            <p className="ld-note">Free for students. Hirelane never charges you to apply.</p>
          </div>
          <figure className="ld-phone">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/previews/student-pick.png" alt="A pick card: Customer Support Associate at Zenoti, 4 of 5 must-haves, you qualify on 2 of 2 rules" />
          </figure>
        </section>

        <section className="ld-steps" aria-labelledby="how-h">
          <h2 id="how-h" className="ld-h2">
            Three steps, no forms twice.
          </h2>
          <ol>
            {STEPS.map((s) => (
              <li key={s.n} className="wr-tile wr-tile-cream">
                <span className="ld-step-n" aria-hidden="true">
                  {s.n}
                </span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="ld-split" aria-labelledby="scam-h">
          <div className="wr-tile wr-tile-pink">
            <h2 id="scam-h" className="ld-h2 ld-on-colour">
              Got a job on WhatsApp? Paste it.
            </h2>
            <p>We tell you if you qualify, and if it looks like a scam: fees, Telegram-only HR, pay too good to be true.</p>
          </div>
          <div className="wr-tile wr-tile-lime">
            <h2 className="ld-h2 ld-on-colour">See who you know there.</h2>
            <p>Add your LinkedIn connections and every role shows who you know at that company. Only you can see them.</p>
          </div>
        </section>

        <section className="wr-tile wr-tile-blue ld-college" aria-labelledby="college-h">
          <h2 id="college-h" className="ld-h2 ld-on-colour">
            Your placement cell on Hirelane?
          </h2>
          <p>Join with your college email and see their drives too, only the ones you&apos;re eligible for, with a countdown.</p>
          <Button asChild variant="on-night" size="pill-sm">
            <Link href="/signin">Join with my college email</Link>
          </Button>
        </section>

        <section className="ld-never" aria-labelledby="never-h">
          <h2 id="never-h" className="ld-h2">
            What we never do
          </h2>
          <ul>
            <li>Apply or message anyone in your name</li>
            <li>Show your marks or resume to your college</li>
            <li>Charge you to apply</li>
            <li>Sell your data</li>
          </ul>
        </section>
      </div>
    </AccountShell>
  );
}
