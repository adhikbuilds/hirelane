import { Public_Sans } from "next/font/google";
import Link from "next/link";
import type { EligibilityResult } from "@hirelane/engine";
import "../../app/campus.css";

const publicSans = Public_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-public", display: "swap" });

export type DemoInput = { notice: string; pct10: string; pct12: string; grad: string; degree: string; year: string; backlogs: string };

const EXAMPLE =
  "Off-campus drive: Process Associate. Eligibility: B.Com, BBA, BCA. 2025 or 2026 passouts. Minimum 55% throughout in 10th, 12th and graduation. No active backlogs.";

const STATUS_WORD = { pass: "You meet this", fail: "You don't meet this", unknown: "We couldn't check this" } as const;

/**
 * The public front door for both audiences, in the calm register: paper, ink, navy, one green accent. The live
 * demo is a GET form, so it works with JavaScript off and runs the real eligibility engine on the server.
 */
export function FrontPage({ demo, result }: { demo: DemoInput | null; result: EligibilityResult | null }) {
  const d = demo ?? { notice: EXAMPLE, pct10: "71", pct12: "58", grad: "64", degree: "B.Com", year: "2025", backlogs: "0" };
  return (
    <div className={`cpl ${publicSans.variable} ${publicSans.className}`}>
      <header className="cpl-top">
        <span className="cpl-brand">
          hire<b>lane</b>
        </span>
        <nav aria-label="Site">
          <a href="#try">Try it</a>
          <Link href="/jobs">Browse jobs</Link>
          <Link href="/colleges">For colleges</Link>
          <Link className="cp-btn" href="/signin">
            Sign in
          </Link>
        </nav>
      </header>

      <section className="cpl-hero fr-hero">
        <div>
          <h1 className="cpl-h1">Off-campus jobs students can actually get.</h1>
          <p className="cpl-lede">
            Fresh roles from company career pages, checked against each student&apos;s own marks, applied on the company&apos;s own site. Free for students.
          </p>
          <div className="fr-doors">
            <Link className="fr-door" href="/signin">
              <b>I&apos;m a student</b>
              <span>Check my resume and see roles I qualify for</span>
            </Link>
            <Link className="fr-door" href="/colleges">
              <b>I run placements</b>
              <span>Help the students your drives don&apos;t place</span>
            </Link>
          </div>
        </div>
        <figure className="fr-device">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/previews/student-pick.png" alt="A role card in the student app: Customer Support Associate at Zenoti, you qualify on 3 of 3 rules" />
        </figure>
      </section>

      <section id="try" className="fr-try" aria-labelledby="try-h">
        <div className="fr-try-copy">
          <h2 id="try-h">Paste a drive notice. See if you qualify.</h2>
          <p>The same check every student gets: we read the rules in the notice and compare them with your marks. Nothing is saved.</p>
        </div>
        <form className="fr-try-form" action="/#try" method="get">
          <label htmlFor="notice">Drive notice or job post</label>
          <textarea id="notice" name="notice" rows={4} defaultValue={d.notice} />
          <div className="fr-marks">
            {[
              ["pct10", "10th %", d.pct10],
              ["pct12", "12th or diploma %", d.pct12],
              ["grad", "Graduation %", d.grad],
              ["degree", "Degree", d.degree],
              ["year", "Passout year", d.year],
              ["backlogs", "Active backlogs", d.backlogs],
            ].map(([name, label, value]) => (
              <label key={name} className="fr-mark">
                <span>{label}</span>
                <input name={name} defaultValue={value} inputMode={name === "degree" ? "text" : "decimal"} />
              </label>
            ))}
          </div>
          <button className="cp-btn fr-check" type="submit">
            Check my eligibility
          </button>
        </form>
        {result ? (
          <div className="fr-result" role="status" data-overall={result.overall}>
            <p className="fr-verdict">
              {result.overall === "pass" ? "You qualify." : result.overall === "fail" ? "Not this one." : "Probably, but we couldn't check every rule."}
            </p>
            <ul>
              {result.verdicts.map((v, i) => (
                <li key={i} data-status={v.status}>
                  <span className="fr-dot" aria-hidden="true" />
                  <span>
                    <b>{STATUS_WORD[v.status]}.</b> {v.reason.charAt(0).toUpperCase() + v.reason.slice(1)}
                  </span>
                </li>
              ))}
            </ul>
            {result.verdicts.length === 0 ? <p>We didn&apos;t find eligibility rules in that text. Try pasting the full notice.</p> : null}
          </div>
        ) : null}
      </section>

      <section className="fr-how" aria-labelledby="how-h">
        <h2 id="how-h">How it works for students</h2>
        <ol>
          <li>
            <b>Check your resume</b>
            <span>See what a company&apos;s hiring software sees, and fix it.</span>
          </li>
          <li>
            <b>Swipe roles you qualify for</b>
            <span>Every rule is read: percentage, backlogs, batch, branch.</span>
          </li>
          <li>
            <b>Apply on the company&apos;s site</b>
            <span>Your answers are ready. You press submit; we track replies.</span>
          </li>
        </ol>
      </section>

      <section className="fr-colleges" aria-labelledby="col-h">
        <div>
          <h2 id="col-h">For placement cells</h2>
          <p>See where unplaced students stop, reach only eligible students with each drive, and file off-campus offers for NAAC 5.2.1.</p>
          <Link className="cp-btn" href="/colleges">
            See the placement console
          </Link>
        </div>
        <figure className="cpl-shot">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/previews/console-overview.png" alt="The placement console overview with the student funnel" loading="lazy" />
        </figure>
      </section>

      <section className="cpl-privacy" aria-labelledby="never-h">
        <h2 id="never-h">What Hirelane never does</h2>
        <ul>
          <li>
            <b>Never applies for you.</b> Students press submit on the employer&apos;s own site.
          </li>
          <li>
            <b>Never charges students.</b> No fees to apply, ever.
          </li>
          <li>
            <b>Never shows marks to colleges.</b> Placement cells see totals; outcomes only if a student shares them.
          </li>
        </ul>
      </section>

      <footer className="cpl-foot">
        <span>
          hire<b>lane</b>
        </span>
        <Link href="/jobs">Jobs</Link>
        <Link href="/colleges">For colleges</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/contact">Contact</Link>
      </footer>
    </div>
  );
}
