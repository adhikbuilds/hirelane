import { Geist } from "next/font/google";
import Link from "next/link";
import "../../app/site.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });

export type SiteCounts = { openJobs: number; companies: number; withSalary: number; indiaRoles: number | null; readAgo: string | null } | null;

/** Employers with the most open India roles in our index (public career pages), shown as plain text, never logos. */
export type Employers = string[];

const fmt = (n: number) => n.toLocaleString("en-IN");

const STEPS = [
  { k: "Pick", title: "Pick roles you qualify for", text: "Every pick is checked against your marks: percentage, backlogs, batch, branch." },
  { k: "Check", title: "Check your answers", text: "We will fill the employer's questions from your resume. Anything we can't know, we ask." },
  { k: "Open", title: "Open the employer's form", text: "Answers ready to copy, resume ready to attach, on the company's own site." },
  { k: "Submit", title: "You press submit", text: "Hirelane never applies for you. Replies land in your tracker." },
];

const FAQ = [
  { q: "Does Hirelane apply for me?", a: "No. We prepare your answers and open the employer's own form. You read everything and press submit yourself." },
  { q: "Where do the jobs come from?", a: "From companies' own career pages, read several times a day. Every role links to the employer's site." },
  { q: "Is it free for students?", a: "Yes. Students never pay to apply. Universities pay for the placement console." },
  { q: "Can my college see my marks?", a: "No. Placement cells see totals, and your outcomes only if you choose to share them." },
  { q: "What if I don't qualify for a role?", a: "We say which rule you miss and show roles you do qualify for instead." },
];

/** Public landing: one claim, real product, live counts, the apply flow, then each audience. Server component. */
export function MainLanding({ counts, employers }: { counts: SiteCounts; employers: Employers }) {
  return (
    <div className={`site ${geist.variable}`}>
      <p className="site-bar">
        Pilot open for the 2026 batch. <Link href="/colleges">Universities, book a demo</Link>
      </p>

      <header className="site-nav">
        <Link href="/" className="site-logo">
          <span className="site-mark" aria-hidden="true" />
          hirelane
        </Link>
        <nav aria-label="Site">
          <Link href="/students">For students</Link>
          <Link href="/colleges">For universities</Link>
          <Link href="/jobs">Jobs</Link>
        </nav>
        <div className="site-nav-cta">
          <Link href="/signin" className="site-link">
            Sign in
          </Link>
          <Link href="/signin" className="site-btn">
            Get started
          </Link>
        </div>
      </header>

      <section className="site-hero">
        <h1>Off-campus jobs, matched to your marks.</h1>
        <p className="site-sub">
          Hirelane reads company career pages, checks every role against your percentage, backlogs and batch, and gets your application ready. You press submit.
        </p>
        <div className="site-ctas">
          <Link href="/signin" className="site-btn site-btn-lg">
            Get started, it&apos;s free
          </Link>
          <Link href="/colleges" className="site-btn site-btn-lg" data-variant="ghost">
            For universities
          </Link>
        </div>
        {counts ? (
          <p className="site-live">
            <span className="site-dot" aria-hidden="true" />
            {counts.indiaRoles ? `${fmt(counts.indiaRoles)} open roles in India` : `${fmt(counts.openJobs)} open roles`}, read from {fmt(counts.companies)} companies&apos; own career pages{counts.readAgo ? `, ${counts.readAgo}` : ""}
          </p>
        ) : null}

        <div className="site-shot">
          <figure className="site-browser">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/marketing/console.png" alt="The Hirelane placement console: 31 off-campus offers, applications per day, and where students stop" />
          </figure>
          <figure className="site-phone">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/marketing/student-phone.png" alt="The student app on a phone: three new roles you qualify for, and a role card with Skip, Save and Apply" />
          </figure>
        </div>
      </section>

      {employers.length > 0 ? (
        <section className="site-logos" aria-label="Employers in our index">
          <p>Roles in India from companies like</p>
          <ul>
            {employers.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {counts ? (
        <section className="site-stats" aria-label="Live from our index">
          <div>
            <b>{fmt(counts.indiaRoles ?? counts.openJobs)}</b>
            <span>{counts.indiaRoles ? "open roles in India" : "open roles"}</span>
          </div>
          <div>
            <b>{fmt(counts.companies)}</b>
            <span>company career pages read</span>
          </div>
          <div>
            <b>{fmt(counts.withSalary)}</b>
            <span>roles that state their pay</span>
          </div>
          <div>
            <b>0</b>
            <span>applications sent without the student</span>
          </div>
        </section>
      ) : null}

      <section className="site-section" aria-labelledby="apply-h">
        <h2 id="apply-h">How applying works: pick to submitted, no retyping.</h2>
        <ol className="site-flow">
          {STEPS.map((s, i) => (
            <li key={s.k} style={{ animationDelay: `${i * 1.5}s` }}>
              <div className="site-flow-ui" aria-hidden="true">
                {i === 0 ? (
                  <div className="ui-card">
                    <b>Customer Support Associate</b>
                    <span>Zenoti, Hyderabad</span>
                    <em>You qualify: 3 of 3 rules</em>
                  </div>
                ) : i === 1 ? (
                  <div className="ui-list">
                    <span>Graduation: 2025, B.Com</span>
                    <span>Languages: English, Hindi</span>
                    <span className="ui-ask">When can you join? Needs you</span>
                  </div>
                ) : i === 2 ? (
                  <div className="ui-form">
                    <span className="ui-url">careers.zenoti.com/apply</span>
                    <span className="ui-field">Full name</span>
                    <span className="ui-field">Graduation year</span>
                    <span className="ui-chip">Answers ready to copy</span>
                  </div>
                ) : (
                  <div className="ui-reply">
                    <span className="ui-chip">Submitted on zenoti.com</span>
                    <b>Reply from Zenoti</b>
                    <span>&quot;Can you do a call Thursday?&quot;</span>
                  </div>
                )}
              </div>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="site-section" aria-labelledby="feat-h">
        <h2 id="feat-h">Everything a fresher needs to get a reply.</h2>
        <div className="site-rows">
          <article className="site-row">
            <div>
              <h3>Know before you apply</h3>
              <p>Paste any drive notice or job post. We read every rule (percentage throughout, backlogs, batch, degree) and check it against your marks. This is real output from our engine.</p>
              <Link href="/students#try" className="site-text-link">
                Try it without signing in
              </Link>
            </div>
            <figure className="site-frame">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/marketing/verdict.png" alt="Eligibility result: you qualify, with each rule checked against your marks" loading="lazy" />
            </figure>
          </article>
          <article className="site-row" data-flip>
            <div>
              <h3>Roles picked for your marks</h3>
              <p>Every card shows pay in rupees, the rules you meet, the must-haves you match, and who you already know at the company.</p>
            </div>
            <figure className="site-frame site-frame-narrow">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/marketing/card.png" alt="A role card: Customer Support Associate at Zenoti, 3.6 LPA, you qualify on 3 of 3 rules, 4 of 5 must-haves, Aman K. works here" loading="lazy" />
            </figure>
          </article>
          <article className="site-row">
            <div>
              <h3>A resume hiring software can read</h3>
              <p>Nine plain checks, failing ones first, each with the fix. Made in Canva or scanned? We tell you before an employer&apos;s software throws it out.</p>
            </div>
            <figure className="site-frame site-frame-narrow">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/marketing/resume-health.png" alt="Resume check: 3 of 9 checks pass, with fixes for each failing check" loading="lazy" />
            </figure>
          </article>
        </div>
      </section>

      <section className="site-section" aria-labelledby="cmp-h">
        <h2 id="cmp-h">Not another job board.</h2>
        <table className="site-cmp">
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col">Mass job boards</th>
              <th scope="col">Hirelane</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Checks your marks against every rule before you apply", false, true],
              ["Jobs read from the company's own career page", false, true],
              ["Flags fees, Telegram-only HR and fake offers", false, true],
              ["Your college can see off-campus outcomes, only if you share", false, true],
              ["Applies or messages anyone in your name", "Often", "Never"],
            ].map(([label, a, b]) => (
              <tr key={String(label)}>
                <th scope="row">{label}</th>
                <td>{a === false ? <span className="site-no">No</span> : a}</td>
                <td>{b === true ? <span className="site-yes">Yes</span> : <b>{b}</b>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="site-uni" aria-labelledby="uni-h">
        <div>
          <h2 id="uni-h">For universities: placement help after the drives end.</h2>
          <ul>
            <li>See where unplaced students stop, with one action per step.</li>
            <li>Paste a drive notice; it reaches only students who qualify.</li>
            <li>Verify off-campus offers and download your NAAC 5.2.1 list.</li>
          </ul>
          <Link href="/colleges" className="site-btn site-btn-lg" data-variant="light">
            See the placement console
          </Link>
        </div>
        <figure className="site-browser">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/marketing/chart.png" alt="Placement console: 31 off-campus offers by programme, and applications per day" loading="lazy" />
        </figure>
      </section>

      <section className="site-section" aria-labelledby="faq-h">
        <h2 id="faq-h">Questions</h2>
        <div className="site-faq">
          {FAQ.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="site-final">
        <h2>Your next job is probably already posted.</h2>
        <p>Check which roles you qualify for.</p>
        <div className="site-ctas">
          <Link href="/signin" className="site-btn site-btn-lg">
            Get started, it&apos;s free
          </Link>
          <Link href="/students#try" className="site-btn site-btn-lg" data-variant="ghost">
            Try it without signing in
          </Link>
        </div>
      </section>

      <footer className="site-foot">
        <div>
          <span className="site-logo">
            <span className="site-mark" aria-hidden="true" />
            hirelane
          </span>
          <p>Off-campus jobs, matched to your marks.</p>
        </div>
        <nav aria-label="Product">
          <b>Product</b>
          <Link href="/students">For students</Link>
          <Link href="/colleges">For universities</Link>
          <Link href="/jobs">Browse jobs</Link>
        </nav>
        <nav aria-label="Company">
          <b>Company</b>
          <Link href="/contact">Contact</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </footer>
    </div>
  );
}
