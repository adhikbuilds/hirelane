import { Public_Sans } from "next/font/google";
import Link from "next/link";
import type React from "react";
import type { CampusOverview } from "@/lib/sample/campus";
import "../../app/campus.css";

const publicSans = Public_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-public", display: "swap" });

export const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

export function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** One icon per funnel stage: joined, resume ready, eligible, applied, interview, offer. */
const STAGE_ICON = [
  "M16 19v-1a4 4 0 00-4-4H6a4 4 0 00-4 4v1M9 10a3 3 0 100-6 3 3 0 000 6M22 19v-1a4 4 0 00-3-3.9M16 4.1a3 3 0 010 5.8",
  "M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9zM14 3v6h6M9 15l2 2 4-4",
  "M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 14.4 7.2 16.9l.9-5.4-3.9-3.8 5.4-.8z",
  "M22 2L11 13M22 2l-7 20-4-9-9-4z",
  "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z",
  "M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0zM17 6h3a2 2 0 01-2 4h-1M7 6H4a2 2 0 002 4h1",
];

export const STATUS = {
  open: { tone: "good", label: "Open", d: "M5 12l5 5 9-10" },
  closing: { tone: "warn", label: "Closing soon", d: "M12 7v5l3 3" },
  closed: { tone: "risk", label: "Closed", d: "M6 6l12 12M18 6L6 18" },
} as const;

export type CampusPage = "overview" | "students" | "drives" | "outcomes" | "settings";

const NAV: { id: CampusPage; label: string; href: string }[] = [
  { id: "overview", label: "Overview", href: "/dev/campus" },
  { id: "students", label: "Students", href: "/dev/campus/students" },
  { id: "drives", label: "Drives", href: "/dev/campus/drives" },
  { id: "outcomes", label: "Outcomes and NAAC", href: "/dev/campus/outcomes" },
  { id: "settings", label: "Settings", href: "/dev/campus/settings" },
];

/** Console frame: navy sidebar with the college name. Server component. */
export function CampusShell({ college, active, children }: { college: string; active: CampusPage; children: React.ReactNode }) {
  return (
    <div className={`cp ${publicSans.variable} ${publicSans.className}`}>
      <aside className="cp-side">
        <div className="cp-college">
          <strong>{college}</strong>
          <span>Placement cell</span>
        </div>
        <nav aria-label="Console">
          <ul className="cp-nav">
            {NAV.map((n) => (
              <li key={n.id}>
                <Link href={n.href} aria-current={n.id === active ? "page" : undefined}>
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="cp-powered">
          Powered by <b>hirelane</b>
        </p>
      </aside>
      <main className="cp-main" id="console">
        {children}
      </main>
    </div>
  );
}

export function SampleNote() {
  return <p className="cp-sample">Sample cohort for demos. Real numbers come from your students&apos; activity; nothing here is a real student.</p>;
}

export function Privacy() {
  return (
    <p className="cp-privacy">
      <Icon d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      You see totals only. Any group under 10 students is hidden, and each student chooses whether to share their outcomes.
    </p>
  );
}

/** Placement console overview: the institutional register of the brand. Server component, no client JS. */
export function CampusConsole({ data }: { data: CampusOverview }) {
  const unplaced = data.finalYears - data.placedOnCampus;
  const top = data.funnel[0]?.count ?? 0;
  return (
    <CampusShell college={data.college} active="overview">
        {data.sample ? <SampleNote /> : null}

        <header className="cp-top">
          <div>
            <h1 className="cp-title">{data.cohort}</h1>
            <p className="cp-sub">Updated {data.asOf}</p>
          </div>
          <div className="cp-actions">
            <Link className="cp-btn" data-variant="outline" href="#">
              <Icon d="M12 5v14M5 12h14" />
              Add a drive
            </Link>
            <Link className="cp-btn" href="#">
              <Icon d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" />
              Download NAAC 5.2.1 list
            </Link>
          </div>
        </header>

        <Privacy />

        <dl className="cp-ledger">
          <div>
            <dt>Final-year students</dt>
            <dd>{data.finalYears}</dd>
          </div>
          <div>
            <dt>Joined Hirelane</dt>
            <dd>
              {data.joined} <small>{pct(data.joined, data.finalYears)}%</small>
            </dd>
          </div>
          <div>
            <dt>Placed in on-campus drives</dt>
            <dd>
              {data.placedOnCampus} <small>{pct(data.placedOnCampus, data.finalYears)}%</small>
            </dd>
          </div>
          <div>
            <dt>Off-campus offers through Hirelane</dt>
            <dd>
              {data.offCampusOffers.total} <small>{data.offCampusOffers.verified} verified</small>
            </dd>
          </div>
        </dl>

        <section className="cp-card" aria-labelledby="funnel-h">
          <h2 id="funnel-h">Students not placed on campus</h2>
          <p className="cp-card-sub">
            {unplaced} students. The hatched part of each column is how many stopped at that step; each column has the next thing to do.
          </p>
          <ol className="cp-funnel">
            {data.funnel.map((f, i) => {
              const prev = i > 0 ? data.funnel[i - 1] : undefined;
              const here = pct(f.count, top);
              const before = prev ? pct(prev.count, top) : here;
              const drop = prev ? prev.count - f.count : 0;
              return (
                <li key={f.label} className="cp-col">
                  <span className="cp-col-plot" aria-hidden="true" title={`${f.label}: ${f.count}${drop ? `, ${drop} dropped here` : ""}`}>
                    {drop > 0 ? (
                      <span className="cp-col-drop" style={{ bottom: `${here}%`, height: `${before - here}%` }}>
                        <em>-{drop}</em>
                      </span>
                    ) : null}
                    <span className="cp-col-bar" style={{ height: `${here}%` }} />
                  </span>
                  <span className="cp-col-n">{f.count}</span>
                  <span className="cp-col-l">{f.label}</span>
                  <span className="cp-col-p">
                    {here}% of joined{drop > 0 ? `, ${drop} stopped here` : ""}
                  </span>
                  <Link className="cp-col-btn" href="#">
                    {f.action}
                    <Icon d="M9 6l6 6-6 6" />
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>

        <div className="cp-grid">


          <section className="cp-card cp-naac" aria-labelledby="naac-h">
            <h2 id="naac-h">NAAC 5.2.1 readiness</h2>
            <p className="cp-card-sub">Off-campus offers students chose to share, with offer letters attached.</p>
            <div className="cp-naac-split">
              <p>
                <b>{data.offCampusOffers.verified}</b>verified by you
              </p>
              <p>
                <b>{data.offCampusOffers.total - data.offCampusOffers.verified}</b>waiting for your check
              </p>
            </div>
            <Link className="cp-btn" data-variant="outline" href="#">
              Review {data.offCampusOffers.total - data.offCampusOffers.verified} offer letters
            </Link>
            <div className="cp-preview">
              <span className="cp-phone">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/previews/student-home.png" alt="The student Home screen: today's picks, resume checks, drives from the placement cell" />
              </span>
              <p>
                <b>What your students see.</b> Daily roles they qualify for, a resume check, and your drives with a countdown. They apply on the
                company&apos;s own site; Hirelane never applies for them or charges them.
              </p>
            </div>
          </section>
        </div>

        <section className="cp-card" aria-labelledby="stuck-h">
          <h2 id="stuck-h">Where students get stuck</h2>
          <p className="cp-card-sub">
            The biggest blockers among students who joined, with one thing you can do about each. {data.hiddenGroups} smaller groups are hidden.
          </p>
          <table className="cp-table">
            <thead>
              <tr>
                <th scope="col">Blocker</th>
                <th scope="col" className="cp-num">
                  Students
                </th>
                <th scope="col">What helps</th>
              </tr>
            </thead>
            <tbody>
              {data.stuck.map((s) => (
                <tr key={s.blocker}>
                  <td>{s.blocker}</td>
                  <td className="cp-num">{s.students}</td>
                  <td>{s.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="cp-card" aria-labelledby="drives-h">
          <h2 id="drives-h">Drives you added</h2>
          <p className="cp-card-sub">Each notice is checked against every student&apos;s confirmed marks. Students only see drives they can apply to.</p>
          <table className="cp-table">
            <thead>
              <tr>
                <th scope="col">Company and role</th>
                <th scope="col">Rules</th>
                <th scope="col" className="cp-num">
                  Eligible
                </th>
                <th scope="col" className="cp-num">
                  Applied
                </th>
                <th scope="col">Deadline</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.drives.map((d) => {
                const st = STATUS[d.status];
                return (
                  <tr key={d.company + d.role}>
                    <td>
                      <b>{d.role}</b>
                      <br />
                      {d.company}
                    </td>
                    <td>{d.rules}</td>
                    <td className="cp-num">{d.eligible}</td>
                    <td className="cp-num">{d.applied}</td>
                    <td>{d.deadline}</td>
                    <td>
                      <span className="cp-status" data-tone={st.tone}>
                        <Icon d={st.d} />
                        {st.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
    </CampusShell>
  );
}
