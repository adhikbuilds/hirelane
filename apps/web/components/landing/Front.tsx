import { Public_Sans } from "next/font/google";
import Link from "next/link";
import type { EligibilityResult } from "@hirelane/engine";
import "../../app/campus.css";
import { PublicHeader, PublicFooter } from "./Public";

const publicSans = Public_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-public", display: "swap" });

export type DemoInput = { notice: string; pct10: string; pct12: string; grad: string; degree: string; year: string; backlogs: string };

const EXAMPLE =
  "Off-campus drive: Process Associate. Eligibility: B.Com, BBA, BCA. 2025 or 2026 passouts. Minimum 55% throughout in 10th, 12th and graduation. No active backlogs.";

const STATUS_WORD = { pass: "You meet this", fail: "You don't meet this", unknown: "We couldn't check this" } as const;

/**
 * The "For students" sub-page of the public site: the live eligibility demo (a GET form, works without JS, real
 * engine on the server), how it works and the never-does promises.
 */
export function StudentsPage({ demo, result }: { demo: DemoInput | null; result: EligibilityResult | null }) {
  const d = demo ?? { notice: EXAMPLE, pct10: "71", pct12: "58", grad: "64", degree: "B.Com", year: "2025", backlogs: "0" };
  return (
    <div className={`cpl ${publicSans.variable} ${publicSans.className}`}>
      <PublicHeader active="students" />

      <section className="fr-sub-hero">
        <h1 className="cpl-h1">For students: jobs you can actually get.</h1>
        <p className="cpl-lede">Try the eligibility check below. Sign in to check your resume and swipe roles picked for your marks.</p>
        <Link className="cp-btn" href="/signin">
          Sign in, free
        </Link>
      </section>

      <section id="try" className="fr-try" aria-labelledby="try-h">
        <div className="fr-try-copy">
          <h2 id="try-h">Paste a drive notice. See if you qualify.</h2>
          <p>The same check every student gets: we read the rules in the notice and compare them with your marks. Nothing is saved.</p>
        </div>
        <form className="fr-try-form" action="/students#try" method="get">
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
            <span>Your answers are ready. You press submit. Reply tracking opens with early access.</span>
          </li>
        </ol>
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

      <PublicFooter />
    </div>
  );
}
