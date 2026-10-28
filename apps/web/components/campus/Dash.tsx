import Link from "next/link";
import type { CampusOverview } from "@/lib/sample/campus";
import { CampusShell, Icon, pct, Privacy, SampleNote } from "./Console";

export type DashBy = "programme" | "blocker" | "drive";

/** Deterministic sample series: applications per day for 90 days (Aug 1 to Oct 29). Real data: product_events. */
function series(): number[] {
  return Array.from({ length: 90 }, (_, i) => {
    const wave = Math.sin(i / 4.2) * 6 + Math.sin(i / 11) * 4;
    const trend = i * 0.18;
    const weekday = i % 7 === 5 || i % 7 === 6 ? -5 : 0;
    return Math.max(0, Math.round(8 + wave + trend + weekday));
  });
}

const W = 640;
const H = 220;
const PAD = { l: 36, r: 8, t: 8, b: 24 };

function AreaChart({ data }: { data: number[] }) {
  const max = Math.ceil(Math.max(...data) / 10) * 10 || 10;
  const x = (i: number) => PAD.l + (i / (data.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const line = data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const ticks = [0, max / 2, max];
  const labels = [
    { i: 0, t: "Aug 1" },
    { i: 45, t: "Sep 15" },
    { i: 89, t: "Oct 29" },
  ];
  const day = (i: number) => {
    const d = new Date(Date.UTC(2026, 7, 1 + i));
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  };
  return (
    <svg className="dk-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Applications per day, Aug 1 to Oct 29. Peak ${Math.max(...data)} in a day.`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="dk-grid" />
          <text x={PAD.l - 8} y={y(t) + 4} className="dk-axis" textAnchor="end">
            {t}
          </text>
        </g>
      ))}
      <path d={area} className="dk-area" />
      <path d={line} className="dk-line" />
      {labels.map((l) => (
        <text key={l.t} x={x(l.i)} y={H - 6} className="dk-axis" textAnchor={l.i === 0 ? "start" : l.i === 89 ? "end" : "middle"}>
          {l.t}
        </text>
      ))}
      {data.map((v, i) => (
        <rect key={i} className="dk-hit" x={x(i) - 3.5} y={PAD.t} width={7} height={H - PAD.t - PAD.b}>
          <title>{`${day(i)}: ${v} applications`}</title>
        </rect>
      ))}
    </svg>
  );
}

const PROGRAMME_ROWS = [
  { name: "B.Com (General)", count: 56, offers: 14, dot: "a" },
  { name: "BBA", count: 33, offers: 8, dot: "b" },
  { name: "B.Com (Computer Applications)", count: 25, offers: 8, dot: "c" },
  { name: "Smaller programmes (2, combined)", count: 4, offers: 1, dot: "d" },
];

/** Placement console overview in the dark analytics register the owner picked (2026-10-29). No client JS. */
export function CampusDash({ data, by }: { data: CampusOverview; by: DashBy }) {
  const s = series();
  const total = s.reduce((a, b) => a + b, 0);
  const joined = data.funnel[0]?.count ?? 0;
  const stops = data.funnel.slice(0, -1).map((f, i) => ({ label: `Stopped before ${data.funnel[i + 1]!.label.toLowerCase()}`, n: f.count - data.funnel[i + 1]!.count }));
  const stopTotal = stops.reduce((a, b) => a + b.n, 0);
  const rows =
    by === "blocker"
      ? data.stuck.map((b) => ({ name: b.blocker, value: b.students, note: b.action }))
      : by === "drive"
        ? data.drives.map((d) => ({ name: `${d.role}, ${d.company}`, value: d.applied, note: `${d.eligible} eligible, closes ${d.deadline}` }))
        : PROGRAMME_ROWS.map((p) => ({ name: p.name, value: p.count, note: `${p.offers < 10 ? "under 10" : p.offers} offers` }));
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
            off-campus offers, {data.offCampusOffers.verified} verified by you <span>from {joined} students who joined</span>
          </p>
          <ul className="dk-break">
            {PROGRAMME_ROWS.map((p) => (
              <li key={p.name}>
                <span className="dk-dot" data-c={p.dot} aria-hidden="true" />
                <span>
                  <b>{p.name}</b> <small>{p.count} applied</small>
                  <em>{pct(p.offers, data.offCampusOffers.total)}% of offers</em>
                </span>
                <strong>{p.offers < 10 ? "under 10" : p.offers}</strong>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="dk-h">Applications per day</h2>
          <p className="dk-sub">{total.toLocaleString("en-IN")} in the last 90 days. Hover a day for its count.</p>
          <AreaChart data={s} />
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
              <Link href="#">{f.action}</Link>
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
