import Link from "next/link";
import type { OfferRow, ProgrammeRow } from "@/lib/sample/campus";
import { Icon, pct } from "./Console";

const OFFER_STATUS = {
  verified: { tone: "good", label: "Verified", d: "M5 12l5 5 9-10" },
  waiting: { tone: "warn", label: "Waiting for you", d: "M12 7v5l3 3" },
  rejected: { tone: "risk", label: "Not accepted", d: "M6 6l12 12M18 6L6 18" },
} as const;

/** Students: totals by programme. Rows under 10 students are hidden, never shown as numbers. */
export function StudentsPage({ rows }: { rows: ProgrammeRow[] }) {
  return (
    <>
      <header className="cp-top">
        <div>
          <h1 className="cp-title">Students by programme</h1>
          <p className="cp-sub">Batch of 2026. Totals only; you never see an individual student&apos;s marks or resume here.</p>
        </div>
        <div className="cp-actions">
          <Link className="cp-btn" data-variant="outline" href="#">
            <Icon d="M4 6h16M4 12h10M4 18h6" />
            Import your student list
          </Link>
        </div>
      </header>
      <section className="cp-card" aria-labelledby="prog-h">
        <h2 id="prog-h">Progress after on-campus drives</h2>
        <div className="cp-scroll">
          <table className="cp-table">
            <thead>
              <tr>
                <th scope="col">Programme</th>
                {["Final years", "Joined", "Resume ready", "Eligible", "Applied", "Interviews", "Offers"].map((h) => (
                  <th key={h} scope="col" className="cp-num">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) =>
                "hidden" in r ? (
                  <tr key={r.programme}>
                    <td>{r.programme}</td>
                    <td className="cp-num">{r.finalYears}</td>
                    <td colSpan={6} className="cp-hidden">
                      Fewer than 10 students joined, so this row is hidden to protect their privacy.
                    </td>
                  </tr>
                ) : (
                  <tr key={r.programme}>
                    <td>{r.programme}</td>
                    <td className="cp-num">{r.finalYears}</td>
                    <td className="cp-num">
                      {r.joined} <small>{pct(r.joined, r.finalYears)}%</small>
                    </td>
                    <td className="cp-num">{r.ready}</td>
                    <td className="cp-num">{r.eligible}</td>
                    <td className="cp-num">{r.applied}</td>
                    <td className="cp-num">{r.interviews}</td>
                    <td className="cp-num">
                      <b className="cp-good">{r.offers}</b>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
        <p className="cp-card-sub">Placed students from your on-campus drives are left out once you import your list, so these numbers are the students who still need help.</p>
      </section>
    </>
  );
}

/** Drives: paste a notice, see the rules we read, who qualifies and any scam signs, then publish. */
export function DrivesInboxPage({ notice }: { notice: string }) {
  const rules = [
    { text: "B.Com, BBA or BBM", ok: true },
    { text: "2025 or 2026 passout", ok: true },
    { text: "60% or 6.0 CGPA in graduation", ok: true },
    { text: "55% in 10th and 12th", ok: true },
    { text: "No active backlogs", ok: true },
  ];
  return (
    <>
      <header className="cp-top">
        <div>
          <h1 className="cp-title">Add a drive</h1>
          <p className="cp-sub">Paste the notice you received. We read the rules and show it only to students who qualify.</p>
        </div>
      </header>
      <div className="cp-grid">
        <section className="cp-card" aria-labelledby="paste-h">
          <h2 id="paste-h">The notice</h2>
          <form className="cp-form" action="#">
            <label htmlFor="notice">Notice text</label>
            <textarea id="notice" name="notice" rows={9} defaultValue={notice} />
            <label htmlFor="link">Apply link</label>
            <input id="link" name="link" type="url" placeholder="https://careers.example.com/..." />
            <fieldset>
              <legend>Show to</legend>
              {["B.Com, batch of 2026", "BBA, batch of 2026", "B.Com, batch of 2025"].map((c, i) => (
                <label key={c} className="cp-check">
                  <input type="checkbox" defaultChecked={i < 2} /> {c}
                </label>
              ))}
            </fieldset>
            <p className="cp-card-sub">We never open the link ourselves. Students apply on the company&apos;s own page.</p>
          </form>
        </section>
        <section className="cp-card" aria-labelledby="read-h">
          <h2 id="read-h">What we read</h2>
          <ul className="cp-rules">
            {rules.map((r) => (
              <li key={r.text}>
                <Icon d="M5 12l5 5 9-10" />
                {r.text}
              </li>
            ))}
          </ul>
          <div className="cp-naac-split">
            <p>
              <b>143</b>students qualify
            </p>
            <p>
              <b>27</b>can&apos;t be checked yet (no CGPA scale on their resume)
            </p>
          </div>
          <p className="cp-safe">
            <Icon d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
            No warning signs: no fee, a company email domain, no Telegram-only contact.
          </p>
          <div className="cp-actions">
            <button className="cp-btn" type="button">
              Publish to 143 students
            </button>
            <button className="cp-btn" data-variant="outline" type="button">
              Save as draft
            </button>
          </div>
        </section>
      </div>
    </>
  );
}

/** Outcomes and NAAC: verify offers students chose to share, then export the 5.2.1 list. */
export function OutcomesPage({ offers, outgoing, higherStudies }: { offers: OfferRow[]; outgoing: number; higherStudies: number }) {
  const verified = offers.filter((o) => o.status === "verified").length;
  const placedTotal = 96 + 22;
  return (
    <>
      <header className="cp-top">
        <div>
          <h1 className="cp-title">Outcomes and NAAC 5.2.1</h1>
          <p className="cp-sub">Offers from students who chose to share them. Nothing is counted until you verify it.</p>
        </div>
        <div className="cp-actions">
          <Link className="cp-btn" href="#">
            <Icon d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" />
            Download 5.2.1 list (CSV)
          </Link>
        </div>
      </header>
      <dl className="cp-ledger">
        <div>
          <dt>Outgoing students</dt>
          <dd>{outgoing}</dd>
        </div>
        <div>
          <dt>Placed (on campus and verified off campus)</dt>
          <dd>{placedTotal}</dd>
        </div>
        <div>
          <dt>Gone for higher studies</dt>
          <dd>{higherStudies}</dd>
        </div>
        <div>
          <dt>5.2.1 figure this year</dt>
          <dd>
            {pct(placedTotal + higherStudies, outgoing)}% <small>so far</small>
          </dd>
        </div>
      </dl>
      <section className="cp-card" aria-labelledby="offers-h">
        <h2 id="offers-h">Offers to check</h2>
        <p className="cp-card-sub">
          {offers.length - verified} waiting, {verified} verified. Each row shows the letter the student uploaded; you mark it verified or not accepted.
        </p>
        <div className="cp-scroll">
          <table className="cp-table">
            <thead>
              <tr>
                <th scope="col">Student</th>
                <th scope="col">Programme</th>
                <th scope="col">Employer</th>
                <th scope="col" className="cp-num">
                  Package
                </th>
                <th scope="col">Found through</th>
                <th scope="col">Letter</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => {
                const st = OFFER_STATUS[o.status];
                return (
                  <tr key={o.id}>
                    <td>
                      <b>{o.student}</b>
                    </td>
                    <td>{o.programme}</td>
                    <td>{o.employer}</td>
                    <td className="cp-num">{o.lpa.toFixed(1)} LPA</td>
                    <td>{o.source}</td>
                    <td>{o.letter ? <Link href="#">View letter</Link> : <span className="cp-muted">Not uploaded</span>}</td>
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
        </div>
      </section>
    </>
  );
}

/** Settings: the CGPA rule (the one setting that unlocks most "can't check" verdicts), domains, join code, staff. */
export function SettingsPage() {
  return (
    <>
      <header className="cp-top">
        <div>
          <h1 className="cp-title">Settings</h1>
          <p className="cp-sub">Set these once at the start of the year.</p>
        </div>
      </header>
      <div className="cp-grid">
        <section className="cp-card" aria-labelledby="cgpa-h">
          <h2 id="cgpa-h">CGPA to percentage</h2>
          <p className="cp-card-sub">Drives often ask for &quot;60% or 6.0 CGPA&quot;. With your university&apos;s rule we can check every student; without it, 27 students show as &quot;can&apos;t check&quot;.</p>
          <form className="cp-form" action="#">
            <label htmlFor="uni">Your university</label>
            <select id="uni" defaultValue="sample">
              <option value="sample">Sample University (rule on file)</option>
              <option value="other">My university isn&apos;t listed</option>
            </select>
            <p className="cp-formula">
              Percentage = CGPA × 9.5 <span>8.1 CGPA becomes 77.0%</span>
            </p>
            <p className="cp-card-sub">Each rule shows the university page it came from. Wrong? Upload your circular and we&apos;ll correct it.</p>
          </form>
        </section>
        <section className="cp-card" aria-labelledby="join-h">
          <h2 id="join-h">How students join</h2>
          <dl className="cp-kv">
            <div>
              <dt>College email domains</dt>
              <dd>sampleuniversity.edu.in</dd>
            </div>
            <div>
              <dt>Join code</dt>
              <dd>
                K7Q2 •••• <Link href="#">Show</Link> <Link href="#">Make a new one</Link>
              </dd>
            </div>
            <div>
              <dt>Joined with a college email</dt>
              <dd>231 of 268</dd>
            </div>
          </dl>
        </section>
        <section className="cp-card" aria-labelledby="staff-h">
          <h2 id="staff-h">Placement cell staff</h2>
          <table className="cp-table">
            <tbody>
              <tr>
                <td>
                  <b>Placement officer (sample)</b>
                  <br />
                  officer@sampleuniversity.edu.in
                </td>
                <td>Owner</td>
              </tr>
              <tr>
                <td>
                  <b>Placement coordinator (sample)</b>
                  <br />
                  coordinator@sampleuniversity.edu.in
                </td>
                <td>Can view</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section className="cp-card" aria-labelledby="priv-h">
          <h2 id="priv-h">Privacy rules</h2>
          <ul className="cp-rules">
            <li>
              <Icon d="M5 12l5 5 9-10" />
              Totals only; groups under 10 are hidden. This can&apos;t be changed.
            </li>
            <li>
              <Icon d="M5 12l5 5 9-10" />
              Students choose what you see: totals, outcomes, or applications too.
            </li>
            <li>
              <Icon d="M5 12l5 5 9-10" />
              Every time staff open a student&apos;s outcome, the student can see it.
            </li>
          </ul>
        </section>
      </div>
    </>
  );
}
