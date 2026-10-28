import { Geist } from "next/font/google";
import Link from "next/link";
import "../../app/site.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });

export type SiteCounts = { openJobs: number; companies: number; withSalary: number; readAgo: string | null } | null;

const fmt = (n: number) => n.toLocaleString("en-IN");

const STEPS = [
  { k: "Swipe", title: "Swipe roles you qualify for", text: "Every pick is checked against your marks: percentage, backlogs, batch, branch." },
  { k: "Check", title: "Check your answers", text: "We fill the employer's questions from your resume. Anything we can't know, we ask." },
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
export function MainLanding({ counts }: { counts: SiteCounts }) {
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
            {fmt(counts.openJobs)} open roles from {fmt(counts.companies)} companies{counts.readAgo ? `, read ${counts.readAgo}` : ""}
          </p>
        ) : null}

        <div className="site-shot">
          <figure className="site-browser">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/previews/console-overview.png" alt="The Hirelane placement console: 31 off-campus offers, applications per day, and where students stop" />
          </figure>
          <figure className="site-phone">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/previews/student-pick.png" alt="The student app on a phone: three new roles you qualify for, and a role card you can swipe" />
          </figure>
        </div>
      </section>

      {counts ? (
        <section className="site-stats" aria-label="Live from our index">
          <div>
            <b>{fmt(counts.openJobs)}</b>
            <span>open roles</span>
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
        <h2 id="apply-h">How applying works: swipe to submitted, no retyping.</h2>
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
        <div className="site-bento">
          <article className="site-tile">
            <div className="ui-verdict" aria-hidden="true">
              <span data-s="pass">55% in 10th, 12th, graduation</span>
              <span data-s="pass">No active backlogs</span>
              <span data-s="unknown">6.0 CGPA: add your scale</span>
            </div>
            <h3>Know before you apply</h3>
            <p>Every drive and job is checked against your own marks, rule by rule.</p>
          </article>
          <article className="site-tile">
            <div className="ui-meter" aria-hidden="true">
              <b>3 of 9</b>
              <i>
                <s style={{ width: "33%" }} />
              </i>
              <span>Fix next: trim to one page</span>
            </div>
            <h3>A resume software can read</h3>
            <p>See what hiring software sees, and fix it in minutes. Or build one from 8 questions.</p>
          </article>
          <article className="site-tile">
            <div className="ui-scam" aria-hidden="true">
              <b>Looks like a scam</b>
              <span>Asks for a ₹1,500 fee</span>
              <span>HR only on Telegram</span>
            </div>
            <h3>Scam check on anything you paste</h3>
            <p>Got a job on WhatsApp? Paste it. We flag fees, Telegram-only HR and pay too good to be true.</p>
          </article>
          <article className="site-tile">
            <div className="ui-warm" aria-hidden="true">
              <i>AK</i>
              <span>Aman K. works at Zenoti</span>
            </div>
            <h3>See who you know there</h3>
            <p>Add your LinkedIn connections and every role shows who can refer you. Only you can see them.</p>
          </article>
        </div>
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
          <img src="/previews/console-drives.png" alt="Adding a drive: the notice is read into rules and the console shows how many students qualify" loading="lazy" />
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
        <p>Check which roles you qualify for in under a minute.</p>
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
