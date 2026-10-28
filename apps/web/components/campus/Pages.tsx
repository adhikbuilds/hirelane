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

const STEPS = ["Notice", "Job details", "Eligibility", "Selection rounds", "Review and publish"];

function Field({ label, value, hint, wide }: { label: string; value: string; hint?: string; wide?: boolean }) {
  const id = `f-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="cp-field" data-wide={wide || undefined}>
      <label htmlFor={id}>{label}</label>
      <input id={id} defaultValue={value} />
      {hint ? <span className="cp-hint">{hint}</span> : null}
    </div>
  );
}

function Chips({ label, items, on }: { label: string; items: string[]; on: string[] }) {
  return (
    <fieldset className="cp-field" data-wide>
      <legend>{label}</legend>
      <div className="cp-chips">
        {items.map((it) => (
          <label key={it} className="cp-chip">
            <input type="checkbox" defaultChecked={on.includes(it)} />
            <span>{it}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Add a drive: a structured job profile, pre-filled from the pasted notice, with a live eligibility summary. */
export function DrivesInboxPage({ notice }: { notice: string }) {
  return (
    <>
      <header className="cp-top">
        <div>
          <h1 className="cp-title">Add a drive</h1>
          <p className="cp-sub">Paste the notice and we fill the form. Check each section, then publish to the students who qualify.</p>
        </div>
        <div className="cp-actions">
          <button className="cp-btn" data-variant="outline" type="button">
            Save as draft
          </button>
        </div>
      </header>

      <div className="cp-drive-layout">
        <nav className="cp-steps" aria-label="Sections">
          <ol>
            {STEPS.map((s, i) => (
              <li key={s} data-state={i < 4 ? "done" : "now"}>
                <a href={`#step-${i + 1}`}>
                  <span>{i + 1}</span>
                  {s}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <form className="cp-drive-form" action="#">
          <section id="step-1" className="cp-card" aria-labelledby="s1">
            <h2 id="s1">1. Notice</h2>
            <p className="cp-card-sub">Paste the email or PDF text you received. We filled 23 fields from it; the ones marked &quot;check&quot; need your eye.</p>
            <textarea className="cp-textarea" rows={5} defaultValue={notice} aria-label="Notice text" />
            <p className="cp-safe">
              <Icon d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
              No warning signs: no fee, a company email domain, no Telegram-only contact.
            </p>
          </section>

          <section id="step-2" className="cp-card" aria-labelledby="s2">
            <h2 id="s2">2. Job details</h2>
            <div className="cp-fields">
              <Field label="Company" value="SaaS company (sample)" />
              <Field label="Role" value="Customer Success Associate" />
              <Field label="Job type" value="Full time" />
              <Field label="Location" value="Bengaluru" />
              <Field label="Work mode" value="On-site" />
              <Field label="Openings" value="" hint="Not in the notice. Optional." />
              <Field label="CTC (fixed)" value="3.2 LPA" hint="Check: the notice says 3.6 LPA total" />
              <Field label="CTC (variable)" value="0.4 LPA" />
              <Field label="Bond or service agreement" value="None mentioned" />
              <Field label="Joining" value="June 2026" />
              <Field label="Apply link" value="https://careers.example.com/cs-associate" wide hint="Students apply here. We never open it ourselves." />
            </div>
          </section>

          <section id="step-3" className="cp-card" aria-labelledby="s3">
            <h2 id="s3">3. Eligibility</h2>
            <p className="cp-card-sub">These rules decide who sees the drive. Each is checked against the student&apos;s confirmed marks.</p>
            <div className="cp-fields">
              <Chips label="Degrees" items={["B.Com", "BBA", "BBM", "BCA", "B.Sc", "BA"]} on={["B.Com", "BBA", "BBM"]} />
              <Chips label="Batch" items={["2024", "2025", "2026", "2027"]} on={["2025", "2026"]} />
              <table className="cp-table cp-crit" data-wide>
                <thead>
                  <tr>
                    <th scope="col">Level</th>
                    <th scope="col">Minimum %</th>
                    <th scope="col">Or CGPA</th>
                    <th scope="col" className="cp-num">
                      Students who pass
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["10th", "55", "", "251"],
                    ["12th or diploma", "55", "", "228"],
                    ["Graduation", "60", "6.0", "196"],
                  ].map(([lvl, p, c, n]) => (
                    <tr key={lvl}>
                      <td>{lvl}</td>
                      <td>
                        <input className="cp-mini" defaultValue={p} aria-label={`${lvl} minimum percent`} />
                      </td>
                      <td>
                        <input className="cp-mini" defaultValue={c} aria-label={`${lvl} CGPA`} placeholder="none" />
                      </td>
                      <td className="cp-num">{n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Field label="Active backlogs allowed" value="0" />
              <Field label="Backlogs ever (max)" value="Any" hint="Not in the notice." />
              <Field label="Gap in education (max years)" value="Not mentioned" hint="Check: many drives allow 1 or 2." />
              <Field label="Other conditions" value="Willing to work rotational shifts" wide />
            </div>
          </section>

          <section id="step-4" className="cp-card" aria-labelledby="s4">
            <h2 id="s4">4. Selection rounds</h2>
            <ol className="cp-rounds">
              {[
                ["Online assessment", "Aptitude and English", "8 Nov, 10:00", "Online"],
                ["Group discussion", "", "12 Nov", "Bengaluru office"],
                ["HR interview", "", "12 Nov", "Bengaluru office"],
              ].map(([r, d, when, where]) => (
                <li key={r}>
                  <b>{r}</b>
                  <span>{d}</span>
                  <span>{when}</span>
                  <span>{where}</span>
                </li>
              ))}
            </ol>
            <button className="cp-btn" data-variant="outline" type="button">
              <Icon d="M12 5v14M5 12h14" />
              Add a round
            </button>
            <div className="cp-fields">
              <Field label="Last date to apply" value="6 Nov 2026" />
              <Field label="Documents to carry" value="Resume, college ID, 10th and 12th marksheets" wide />
            </div>
          </section>

          <section id="step-5" className="cp-card" aria-labelledby="s5">
            <h2 id="s5">5. Review and publish</h2>
            <p className="cp-card-sub">Students see the drive in their app with a countdown and the rules they meet. Students who don&apos;t qualify never see it.</p>
            <div className="cp-actions">
              <button className="cp-btn" type="submit">
                Publish to 143 students
              </button>
              <button className="cp-btn" data-variant="outline" type="button">
                Schedule for 9:00 tomorrow
              </button>
            </div>
          </section>
        </form>

        <aside className="cp-summary" aria-label="Who this reaches">
          <section className="cp-card">
            <h2>Who this reaches</h2>
            <p className="cp-big">143</p>
            <p className="cp-card-sub">students qualify on every rule</p>
            <table className="cp-table">
              <tbody>
                <tr>
                  <td>B.Com, batch of 2026</td>
                  <td className="cp-num">88</td>
                </tr>
                <tr>
                  <td>BBA, batch of 2026</td>
                  <td className="cp-num">41</td>
                </tr>
                <tr>
                  <td>B.Com, batch of 2025</td>
                  <td className="cp-num">14</td>
                </tr>
              </tbody>
            </table>
          </section>
          <section className="cp-card">
            <h2>Can&apos;t be checked yet</h2>
            <p className="cp-big cp-warn-text">27</p>
            <p className="cp-card-sub">CGPA without a scale on their resume. Set your university&apos;s rule in Settings and most of these resolve.</p>
            <Link className="cp-btn" data-variant="outline" href="/dev/campus/settings">
              Set the CGPA rule
            </Link>
          </section>
          <section className="cp-summary-plain">
            <h2>What students see</h2>
            <div className="cp-student-preview">
              <b>Customer Success Associate</b>
              <span>SaaS company (sample), Bengaluru</span>
              <span className="cp-status" data-tone="good">
                <Icon d="M5 12l5 5 9-10" />
                You qualify on 5 of 5 rules
              </span>
              <span>Closes in 8 days</span>
            </div>
          </section>
        </aside>
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
