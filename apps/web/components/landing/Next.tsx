import { Geist } from "next/font/google";
import Link from "next/link";
import "../../app/next.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });

export type NextCounts = { indiaRoles: number | null; companies: number | null; employers: string[] };

const fmt = (n: number) => n.toLocaleString("en-IN");

/**
 * Landing, motion edition (owner-approved concept, 2026-10-29): no screenshots. The hero tells one application's
 * story in CSS: a notice types in, its rules lift out and tick against the student's marks, a role card is swiped
 * right and stamped Applied, a reply pings. Every animation ends on a readable final frame under reduced motion.
 */
export function NextLanding({ counts }: { counts: NextCounts }) {
  return (
    <div className={`nx ${geist.variable}`}>
      <header className="nx-nav">
        <Link href="/" className="nx-logo">
          <span className="nx-mark" aria-hidden="true" />
          hirelane
        </Link>
        <nav aria-label="Site">
          <Link href="/students">For students</Link>
          <Link href="/colleges">For universities</Link>
          <Link href="/jobs">Jobs</Link>
        </nav>
        <div className="nx-nav-cta">
          <Link href="/signin" className="nx-quiet">
            Sign in
          </Link>
          <Link href="/signin" className="nx-btn">
            Get started
          </Link>
        </div>
      </header>

      <section className="nx-hero">
        <div className="nx-hero-copy">
          <h1>Off-campus jobs, matched to your marks.</h1>
          <p>Hirelane reads every rule in a drive notice, checks it against your marks, and applies the moment you swipe right.</p>
          <div className="nx-ctas">
            <Link href="/signin" className="nx-btn nx-btn-lg">
              Get started, free
            </Link>
            <Link href="/colleges" className="nx-btn nx-btn-lg" data-variant="ghost">
              For universities
            </Link>
          </div>
          {counts.indiaRoles ? (
            <p className="nx-live">
              <span aria-hidden="true" />
              {fmt(counts.indiaRoles)} open roles in India{counts.companies ? `, from ${fmt(counts.companies)} companies' own career pages` : ""}
            </p>
          ) : null}
        </div>

        <div className="nx-story" aria-label="How one application goes: a drive notice is read, its rules are checked against your marks, you swipe right and it's applied, and a reply arrives.">
          <div className="nx-notice" aria-hidden="true">
            <span className="nx-notice-from">Placement cell, forwarded</span>
            <p>
              <span className="nx-type">Off-campus drive: Process Associate. Eligibility: 60% throughout, no active backlogs, 2026 batch.</span>
            </p>
          </div>
          <ul className="nx-chips" aria-hidden="true">
            <li>
              60% throughout <i>71, 62, 64</i>
            </li>
            <li>
              No backlogs <i>0 active</i>
            </li>
            <li>
              2026 batch <i>2026</i>
            </li>
          </ul>
          <div className="nx-card" aria-hidden="true">
            <b>Process Associate</b>
            <span>Bengaluru, 3.2 LPA</span>
            <em>You qualify on 3 of 3 rules</em>
            <strong className="nx-stamp">Applied</strong>
          </div>
          <div className="nx-reply" aria-hidden="true">
            <span className="nx-ping" />
            <div>
              <b>Reply to your Hirelane address</b>
              <span>&quot;Can you do a call on Thursday?&quot;</span>
            </div>
          </div>
        </div>
      </section>

      {counts.employers.length > 0 ? (
        <section className="nx-employers" aria-label="Employers in our index">
          <p>Roles in India from companies like</p>
          <div className="nx-marquee">
            <ul>
              {[...counts.employers, ...counts.employers].map((e, i) => (
                <li key={`${e}-${i}`} aria-hidden={i >= counts.employers.length || undefined}>
                  {e}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <section className="nx-feature">
        <div>
          <h2>Every rule, checked before you apply.</h2>
          <p>Percentage throughout, backlogs, batch, branch, gap years. If a drive says 60% and you have 58% in 12th, you&apos;ll know in a second, not after the test.</p>
        </div>
        <div className="nx-demo nx-match" aria-hidden="true">
          {[
            ["60% in 10th", "71%", "pass"],
            ["60% in 12th", "58%", "fail"],
            ["60% in graduation", "64%", "pass"],
            ["No active backlogs", "0", "pass"],
          ].map(([rule, mark, st], i) => (
            <div key={rule} className="nx-match-row" data-s={st} style={{ animationDelay: `${i * 0.35}s` }}>
              <span>{rule}</span>
              <span className="nx-arrow" />
              <span className="nx-mark-val">{mark}</span>
              <span className="nx-verdict">{st === "pass" ? "Meets" : "Short by 2%"}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="nx-feature" data-flip>
        <div>
          <h2>Swipe right. It&apos;s applied.</h2>
          <p>Your answers come from your resume and the questions you answered once. Hirelane fills the employer&apos;s form and submits it with your Hirelane address. If a site blocks us, you finish it in one tap.</p>
        </div>
        <div className="nx-demo nx-stack" aria-hidden="true">
          {["Customer Support Associate", "Operations Analyst Trainee", "Data Operations Trainee"].map((r, i) => (
            <div key={r} className="nx-mini" style={{ animationDelay: `${i * 2}s` }}>
              <b>{r}</b>
              <span>You qualify</span>
              <strong>Applied</strong>
            </div>
          ))}
          <p className="nx-count">
            Applied today <span className="nx-count-n" />
          </p>
        </div>
      </section>

      <section className="nx-feature">
        <div>
          <h2>Replies come to you, not to spam.</h2>
          <p>Every application uses your own Hirelane address. Employer replies land in your tracker and on your phone, so nothing gets lost in a promotions folder.</p>
        </div>
        <div className="nx-demo nx-inbox" aria-hidden="true">
          {[
            ["Zenoti", "Can you do a call on Thursday?", "Interview"],
            ["Payoneer", "Thanks for applying. Next step: online test.", "Test"],
            ["Sigmoid", "Your application was received.", "Received"],
          ].map(([co, msg, tag], i) => (
            <div key={co} className="nx-mail" style={{ animationDelay: `${i * 0.8}s` }}>
              <b>{co}</b>
              <span>{msg}</span>
              <em>{tag}</em>
            </div>
          ))}
        </div>
      </section>

      <section className="nx-uni">
        <div>
          <h2>For universities: see where unplaced students stop.</h2>
          <p>Paste a drive and it reaches only students who qualify. Watch the funnel from joined to offer, act on each step, and download your NAAC 5.2.1 list.</p>
          <Link href="/colleges" className="nx-btn nx-btn-lg" data-variant="light">
            See the placement console
          </Link>
        </div>
        <div className="nx-funnel" aria-hidden="true">
          {[
            ["Joined", 100],
            ["Resume ready", 75],
            ["Eligible", 65],
            ["Applied", 44],
            ["Interview", 17],
            ["Offer", 12],
          ].map(([l, v], i) => (
            <div key={l} className="nx-bar" style={{ animationDelay: `${i * 0.12}s` }}>
              <span>{l}</span>
              <i style={{ width: `${v}%` }} />
            </div>
          ))}
        </div>
      </section>

      <section className="nx-final">
        <h2>Your next job is probably already posted.</h2>
        <div className="nx-ctas">
          <Link href="/signin" className="nx-btn nx-btn-lg">
            Get started, free
          </Link>
          <Link href="/students#try" className="nx-btn nx-btn-lg" data-variant="ghost">
            Check a drive without signing in
          </Link>
        </div>
      </section>

      <footer className="nx-foot">
        <span className="nx-logo">
          <span className="nx-mark" aria-hidden="true" />
          hirelane
        </span>
        <Link href="/students">For students</Link>
        <Link href="/colleges">For universities</Link>
        <Link href="/jobs">Jobs</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/contact">Contact</Link>
      </footer>
    </div>
  );
}
