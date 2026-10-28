import { Public_Sans } from "next/font/google";
import Link from "next/link";
import "../../app/campus.css";
import { PublicFooter, PublicHeader } from "./Public";

const publicSans = Public_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-public", display: "swap" });

/** The main landing: one idea (a fair shot after campus drives), both products shown together, two doors. */
export function MainLanding() {
  return (
    <div className={`cpl ${publicSans.variable} ${publicSans.className}`}>
      <PublicHeader active="home" />

      <section className="mn-hero">
        <div className="mn-copy">
          <h1 className="mn-h1">A fair shot at a job, after the campus drives end.</h1>
          <p className="cpl-lede">
            Students get roles they actually qualify for, checked against their own marks. Placement cells see where students get stuck, and what to do about it.
          </p>
        </div>
        <div className="mn-stage" aria-hidden="true">
          <figure className="mn-laptop">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/previews/console-overview.png" alt="" />
          </figure>
          <figure className="mn-phone">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/previews/student-pick.png" alt="" />
          </figure>
        </div>
      </section>

      <section className="mn-doors" aria-label="Choose your side">
        <Link className="mn-door" href="/students">
          <span className="mn-door-k">For students</span>
          <b>Jobs you can actually get</b>
          <span>Check your resume, swipe roles picked for your marks, apply on the company&apos;s own site. Free.</span>
          <span className="mn-go">See how it works</span>
        </Link>
        <Link className="mn-door" data-tone="navy" href="/colleges">
          <span className="mn-door-k">For universities</span>
          <b>Placement help after the drives end</b>
          <span>See where unplaced students stop, reach only eligible students with each drive, file offers for NAAC 5.2.1.</span>
          <span className="mn-go">See the placement console</span>
        </Link>
      </section>

      <section className="mn-proof" aria-label="How Hirelane works">
        <p>
          <b>Read from company career pages.</b> Every role links to the employer&apos;s own site.
        </p>
        <p>
          <b>Students press submit.</b> Hirelane never applies for anyone or charges students.
        </p>
        <p>
          <b>Totals for colleges.</b> Groups under 10 students are always hidden.
        </p>
      </section>

      <PublicFooter />
    </div>
  );
}
