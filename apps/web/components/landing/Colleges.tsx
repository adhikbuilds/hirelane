import { Public_Sans } from "next/font/google";
import Link from "next/link";
import "../../app/campus.css";

const publicSans = Public_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-public", display: "swap" });

const FEATURES = [
  {
    title: "See where unplaced students stop",
    text: "A funnel from joined to offer, with the blocker at each step and one action you can take: a resume clinic, a reminder, a prep session.",
    img: "/previews/console-overview.png",
    alt: "Placement console overview with the conversion funnel",
  },
  {
    title: "Paste a drive, reach only eligible students",
    text: "Forward the notice you already get. We read the rules (60% throughout, backlogs, batch, branch), count who qualifies and check for scam signs before you publish.",
    img: "/previews/console-drives.png",
    alt: "Add a drive screen showing parsed eligibility rules and 143 eligible students",
  },
  {
    title: "Off-campus offers, ready for NAAC 5.2.1",
    text: "Students share offers with the letter attached. You verify them and download the list in the shape you file.",
    img: "/previews/console-outcomes.png",
    alt: "Outcomes table with offers waiting for verification",
  },
];

/** College-facing landing page in the institutional register. Server component, no client JS. */
export function CollegeLanding() {
  return (
    <div className={`cpl ${publicSans.variable} ${publicSans.className}`}>
      <header className="cpl-top">
        <span className="cpl-brand">
          hire<b>lane</b> <span>for campus</span>
        </span>
        <nav aria-label="College site">
          <a href="#features">What you get</a>
          <a href="#privacy">Privacy</a>
          <Link className="cp-btn" href="#demo">
            Book a demo
          </Link>
        </nav>
      </header>

      <section className="cpl-hero">
        <div>
          <h1 className="cpl-h1">Placement help after the drives end.</h1>
          <p className="cpl-lede">
            Hirelane works with the students your on-campus drives don&apos;t place: eligible off-campus roles, resumes that hiring software can read, and outcomes you can file.
          </p>
          <div className="cp-actions">
            <Link className="cp-btn" href="#demo">
              Book a 20-minute demo
            </Link>
            <a className="cp-btn" data-variant="outline" href="#features">
              See the console
            </a>
          </div>
          <p className="cpl-small">Works alongside your placement ERP. Import your student list from Superset, any ERP or Excel.</p>
        </div>
        <figure className="cpl-shot">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/previews/console-overview.png" alt="The Hirelane placement console for a sample university" />
        </figure>
      </section>

      <section id="features" className="cpl-features" aria-label="What you get">
        {FEATURES.map((f, i) => (
          <article key={f.title} className="cpl-feature" data-flip={i % 2 === 1 || undefined}>
            <div>
              <h2>{f.title}</h2>
              <p>{f.text}</p>
            </div>
            <figure className="cpl-shot">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.img} alt={f.alt} loading="lazy" />
            </figure>
          </article>
        ))}
      </section>

      <section id="privacy" className="cpl-privacy" aria-labelledby="privacy-h">
        <h2 id="privacy-h">Built so students trust it</h2>
        <ul>
          <li>
            <b>Totals only.</b> Any group under 10 students is hidden. You never see a student&apos;s marks or resume.
          </li>
          <li>
            <b>Students choose what you see.</b> Outcomes are shared by the student, with a log they can read.
          </li>
          <li>
            <b>No fees, no spam.</b> Students apply on the employer&apos;s own site. Hirelane never applies for them or charges them.
          </li>
        </ul>
      </section>

      <section id="demo" className="cpl-demo" aria-labelledby="demo-h">
        <div>
          <h2 id="demo-h">See it with your own batch.</h2>
          <p>A 20-minute call with your placement team. We set up a pilot for one programme and you decide after the semester.</p>
        </div>
        <form className="cp-form cpl-form" action="#">
          <label htmlFor="cname">Your name</label>
          <input id="cname" name="name" type="text" autoComplete="name" />
          <label htmlFor="ccollege">College</label>
          <input id="ccollege" name="college" type="text" />
          <label htmlFor="cemail">Work email</label>
          <input id="cemail" name="email" type="email" autoComplete="email" />
          <button className="cp-btn" type="submit">
            Request a demo
          </button>
        </form>
      </section>

      <footer className="cpl-foot">
        <span>
          hire<b>lane</b>
        </span>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/contact">Contact</Link>
      </footer>
    </div>
  );
}
