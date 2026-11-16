import Link from "next/link";
import type { CampusOverview } from "@/lib/sample/campus";
import { CampusShell, Icon, pct, Privacy, SampleNote } from "./Console";

export type DashBy = "programme" | "blocker" | "drive";

/** Sample weekly series for 12 weeks: applications and employer replies, plus weeks a drive closed. Real data: applications + inbound_messages. */
const WEEKS = ["Aug 4", "Aug 11", "Aug 18", "Aug 25", "Sep 1", "Sep 8", "Sep 15", "Sep 22", "Sep 29", "Oct 6", "Oct 13", "Oct 20"];
const APPS = [41, 52, 38, 61, 73, 66, 58, 84, 97, 88, 112, 126];
const REPLIES = [3, 5, 4, 8, 9, 11, 7, 13, 16, 14, 19, 23];
const DRIVE_WEEKS: Record<number, string> = {
  4: "Bank drive closed",
  8: "Mass recruiter drive closed",
  11: "Process Associate drive closed",
};

function WeeklyBars() {
  const W = 640;
  const H = 240;
  const P = { l: 36, r: 8, t: 24, b: 28 };
  const max = 140;
  const slot = (W - P.l - P.r) / WEEKS.length;
  const bw = slot * 0.32;
  const y = (v: number) => P.t + (1 - v / max) * (H - P.t - P.b);
  return (
    <svg className="dk-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Applications and replies per week for 12 weeks. Latest week: ${APPS[11]} applications, ${REPLIES[11]} replies.`}>
      {[0, 70, 140].map((t) => (
        <g key={t}>
          <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} className="dk-grid" />
          <text x={P.l - 8} y={y(t) + 4} className="dk-axis" textAnchor="end">
            {t}
          </text>
        </g>
      ))}
      {WEEKS.map((w, i) => {
        const x0 = P.l + i * slot + slot * 0.16;
        return (
          <g key={w}>
            <rect x={x0} y={y(APPS[i]!)} width={bw} height={y(0) - y(APPS[i]!)} rx="3" className="dk-bar-a" />
            <rect x={x0 + bw + 2} y={y(REPLIES[i]!)} width={bw} height={y(0) - y(REPLIES[i]!)} rx="3" className="dk-bar-b" />
            {DRIVE_WEEKS[i] ? <circle cx={x0 + bw} cy={P.t - 10} r="4" className="dk-marker" /> : null}
            {i % 3 === 0 || i === WEEKS.length - 1 ? (
              <text x={x0 + bw} y={H - 8} className="dk-axis" textAnchor="middle">
                {w}
              </text>
            ) : null}
            <rect x={P.l + i * slot} y={P.t - 18} width={slot} height={H - P.t - P.b + 18} className="dk-hit">
              <title>{`Week of ${w}: ${APPS[i]} applications, ${REPLIES[i]} replies (${Math.round((REPLIES[i]! / APPS[i]!) * 100)}%)${DRIVE_WEEKS[i] ? `. ${DRIVE_WEEKS[i]}` : ""}`}</title>
            </rect>
          </g>
        );
      })}
    </svg>
  );
}

const SAMPLE_ACT = [
  {
    n: 82,
    text: "eligible students haven't applied to Process Associate, closing Saturday",
    cta: "Remind them",
    href: "/campus/drives",
  },
  {
    n: 46,
    text: "students haven't opened Hirelane in 7 days",
    cta: "Send a nudge",
    href: "#",
  },
  {
    n: 27,
    text: "students can't be checked for CGPA drives",
    cta: "Set the CGPA rule",
    href: "/campus/settings",
  },
  {
    n: 9,
    text: "offer letters are waiting for you",
    cta: "Verify offers",
    href: "/campus/outcomes",
  },
];

interface ProgRow {
  name: string;
  /** Null when the group is hidden (under 10): printed as "hidden", never as 0. */
  count: number | null;
  offers: number | null;
  dot: string;
}
const SAMPLE_PROGRAMMES: ProgRow[] = [
  { name: "B.Com (General)", count: 56, offers: 14, dot: "a" },
  { name: "BBA", count: 33, offers: 8, dot: "b" },
  { name: "B.Com (Computer Applications)", count: 25, offers: 8, dot: "c" },
  { name: "Smaller programmes (2, combined)", count: 4, offers: 1, dot: "d" },
];

/** What to do this week, from the figures the console actually has. Nothing here is a made-up number. */
function actFor(data: CampusOverview): { n: number; text: string; cta: string; href: string }[] {
  const out: { n: number; text: string; cta: string; href: string }[] = [];
  for (const b of data.stuck.slice(0, 3))
    out.push({
      n: b.students,
      text: b.blocker.charAt(0).toLowerCase() + b.blocker.slice(1),
      cta: "Students",
      href: "/campus/students",
    });
  if (data.drives.length === 0)
    out.push({
      n: 0,
      text: "No drive is published yet",
      cta: "Add a drive",
      href: "/campus/drives",
    });
  return out;
}

/** Placement console overview in the dark analytics register the owner picked (2026-10-29). No client JS. */
export function CampusDash({ data, by }: { data: CampusOverview; by: DashBy }) {
  const joined = data.funnel[0]?.count ?? 0;
  const stops = data.funnel.slice(0, -1).map((f, i) => ({
    label: `Stopped before ${data.funnel[i + 1]!.label.toLowerCase()}`,
    n: f.count - data.funnel[i + 1]!.count,
  }));
  const stopTotal = stops.reduce((a, b) => a + b.n, 0);
  const sample = data.sample;
  const prog: ProgRow[] = sample
    ? SAMPLE_PROGRAMMES
    : (data.programmes ?? []).map((p, i) => ({
        name: p.name,
        count: p.joined,
        offers: p.offers,
        dot: "abcd"[i % 4]!,
      }));
  const act = sample ? SAMPLE_ACT : actFor(data);
  const rows =
    by === "blocker"
      ? data.stuck.map((b) => ({
          name: b.blocker,
          value: b.students,
          note: b.action,
        }))
      : by === "drive"
        ? data.drives.map((d) => ({
            name: `${d.role}, ${d.company}`,
            value: d.applied,
            note: `${d.eligible} eligible, closes ${d.deadline}`,
          }))
        : prog.map((p) => ({
            name: p.name,
            value: p.count ?? 0,
            note: p.count === null ? "hidden: fewer than 10 students" : `${p.offers === null || p.offers < 10 ? "under 10" : p.offers} offers`,
          }));
  const rowMax = Math.max(1, ...rows.map((r) => r.value));
  const rowTotal = rows.reduce((a, b) => a + b.value, 0);

  return (
    <CampusShell college={data.college} active="overview">
      {data.sample ? <SampleNote /> : null}
      <header className="cp-top">
        <div>
          <h1 className="cp-title">{data.cohort}</h1>
          <p className="cp-sub">Updated {data.asOf}</p>
        </div>
        <div className="cp-actions">
          <Link className="cp-btn" data-variant="outline" href="/campus/drives">
            <Icon d="M12 5v14M5 12h14" />
            Add a drive
          </Link>
          <Link className="cp-btn" href="/campus/outcomes">
            <Icon d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" />
            NAAC 5.2.1 list
          </Link>
        </div>
      </header>

      <section className="dk-top">
        <div>
          <p className="dk-hero">{data.offCampusOffers.total}</p>
          <p className="dk-hero-sub">
            {sample ? (
              <>
                off-campus offers, {data.offCampusOffers.verified} verified by you <span>from {joined} students who joined</span>
              </>
            ) : (
              <>
                off-campus offers reported by students <span>from {joined} students who joined. Verify them in Outcomes.</span>
              </>
            )}
          </p>
          <ul className="dk-break">
            {prog.map((p) => (
              <li key={p.name}>
                <span className="dk-dot" data-c={p.dot} aria-hidden="true" />
                <span>
                  <b>{p.name}</b> <small>{p.count === null ? "hidden" : sample ? `${p.count} applied` : `${p.count} joined`}</small>
                  {p.offers !== null && p.offers >= 10 ? <em>{pct(p.offers, data.offCampusOffers.total)}% of offers</em> : null}
                </span>
                <strong>{p.offers === null || p.offers < 10 ? "under 10" : p.offers}</strong>
              </li>
            ))}
          </ul>
        </div>
        <div className="dk-right">
          {sample ? (
            <>
              <div className="dk-row-head">
                <h2 className="dk-h">Applications and replies per week</h2>
                <ul className="dk-key" aria-hidden="true">
                  <li>
                    <span className="dk-sq" data-c="0" />
                    Applications
                  </li>
                  <li>
                    <span className="dk-sq" data-c="1" />
                    Replies
                  </li>
                  <li>
                    <span className="dk-mk" />
                    Drive closed
                  </li>
                </ul>
              </div>
              <p className="dk-sub">
                Replies are {Math.round((REPLIES[11]! / APPS[11]!) * 100)}% of applications this week, up from {Math.round((REPLIES[0]! / APPS[0]!) * 100)}% in August. Hover a week for counts.
              </p>
              <WeeklyBars />
            </>
          ) : null}
          <h2 className="dk-h dk-act-h">Act this week</h2>
          <ul className="dk-act">
            {act.map((a) => (
              <li key={a.cta}>
                <b>{a.n > 0 ? a.n : ""}</b>
                <span>{a.text}</span>
                <Link href={a.href}>{a.cta}</Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="totals-h">
        <h2 id="totals-h" className="dk-h">
          Totals
        </h2>
        <dl className="dk-totals">
          {data.funnel.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.count}</dd>
              {sample ? <Link href="#">{f.action}</Link> : <span>{f.action}</span>}
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="stop-h">
        <h2 id="stop-h" className="dk-h">
          Where students stop
        </h2>
        <div className="dk-stack" role="img" aria-label={stops.map((x) => `${x.label}: ${x.n}`).join("; ")}>
          {stops.map((x, i) => (
            <span key={x.label} data-c={i} style={{ flexGrow: x.n }} title={`${x.label}: ${x.n}`} />
          ))}
        </div>
        <ul className="dk-legend">
          {stops.map((x, i) => (
            <li key={x.label}>
              <span className="dk-sq" data-c={i} aria-hidden="true" />
              {x.label} <b>{x.n}</b> <small>{pct(x.n, stopTotal)}%</small>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="bd-h">
        <div className="dk-row-head">
          <h2 id="bd-h" className="dk-h">
            Breakdown
          </h2>
          <nav className="dk-seg" aria-label="Break down by">
            {(["programme", "blocker", "drive"] as DashBy[]).map((k) => (
              <Link key={k} href={`/campus?by=${k}#bd-h`} aria-current={by === k ? "page" : undefined}>
                {k === "programme" ? "Programme" : k === "blocker" ? "Blocker" : "Drive"}
              </Link>
            ))}
          </nav>
        </div>
        <table className="dk-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">{by === "programme" ? "Programme" : by === "blocker" ? "Blocker" : "Drive"}</th>
              <th scope="col" className="cp-num">
                {by === "programme" ? "Applied" : by === "blocker" ? "Students" : "Applied"}
              </th>
              <th scope="col" className="cp-num">
                Share
              </th>
              <th scope="col">Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.name}>
                <td className="dk-idx">{i + 1}</td>
                <td>
                  <span className="dk-name">{r.name}</span>
                  <span className="dk-under" style={{ width: `${(r.value / rowMax) * 100}%` }} aria-hidden="true" />
                </td>
                <td className="cp-num">{r.value}</td>
                <td className="cp-num dk-muted">{pct(r.value, rowTotal)}%</td>
                <td className="dk-muted">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <Privacy />
    </CampusShell>
  );
}
