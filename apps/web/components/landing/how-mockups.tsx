import { Check, FileText, Inbox, Mail, Sparkles, X } from "lucide-react";
import { Chip, MatchRing, cn } from "../ui";

/** Invented names throughout: these mockups are fixtures, not real postings or people. */
const frame = "min-w-0 max-w-full overflow-hidden rounded-[16px] border border-line bg-surface p-5 shadow-pop";

export function UploadMock() {
  return (
    <div className={frame}>
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-[12px] bg-lane-50 text-lane">
          <FileText aria-hidden className="size-5" />
        </span>
        <div>
          <p className="font-extrabold leading-5">resume_v3.pdf</p>
          <p className="text-[13px] text-ink-3">Read in your browser, 2 pages</p>
        </div>
        <Chip tone="match" className="ml-auto" icon={<Check aria-hidden className="size-3.5" />}>
          Parsed
        </Chip>
      </div>
      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-3 text-[14px]">
        <Row k="Name" v="Asha Verma" />
        <Row k="Roles" v={<div className="flex gap-1.5"><Chip tone="lane">Data engineer</Chip><Chip tone="lane">Analytics engineer</Chip></div>} />
        <Row k="Skills" v={<div className="flex flex-wrap gap-1.5">{["Python", "PostgreSQL", "Kafka", "Airflow", "dbt", "AWS"].map((s) => <Chip key={s}>{s}</Chip>)}</div>} />
        <Row k="Pay floor" v={<span className="font-extrabold">₹30 L a year</span>} />
      </div>
      <p className="mt-4 flex items-center gap-2 rounded-[10px] bg-signal-50 px-3 py-2 text-[13px] font-semibold text-signal-ink">
        <Sparkles aria-hidden className="size-4" /> Fix anything it got wrong before a single job is matched.
      </p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] sm:grid-cols-[76px_minmax(0,1fr)] items-center gap-3">
      <span className="font-bold text-ink-3">{k}</span>
      <div>{v}</div>
    </div>
  );
}

const MATCHES = [
  { title: "Senior data engineer", co: "Northwind Freight", score: 91, maths: "9 of 10 requirements • pay above floor", miss: "Spark" },
  { title: "Analytics engineer", co: "Larkspur Health", score: 82, maths: "7 of 9 requirements • pay above floor", miss: "Looker" },
  { title: "Platform engineer", co: "Quillon Systems", score: 58, maths: "5 of 9 requirements • pay below floor", miss: "Kubernetes" },
];

export function MatchMock() {
  return (
    <div className={cn(frame, "grid grid-cols-[minmax(0,1fr)] gap-3")}>
      {MATCHES.map((m) => (
        <div key={m.title} className="flex items-center gap-3.5 rounded-[12px] border border-line p-3">
          <MatchRing score={m.score} size={54} strokeWidth={5} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-extrabold leading-5">{m.title}</p>
            <p className="truncate text-[13px] text-ink-2">{m.co}</p>
            <p className="mt-1 text-[13px] font-semibold leading-4 text-ink">{m.maths}</p>
          </div>
          <span className="hidden shrink-0 sm:block">
            <Chip tone="miss" icon={<X aria-hidden className="size-3.5" />}>
              {m.miss}
            </Chip>
          </span>
        </div>
      ))}
      <p className="text-[13px] text-ink-3">Every term of the score is shown, so you can see why a job ranks where it does.</p>
    </div>
  );
}

export function ApproveMock() {
  return (
    <div className={frame}>
      <p className="text-[13px] font-bold text-ink-3">Draft for Northwind Freight • Senior data engineer</p>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2.5 text-[14px]">
        <div className="rounded-[10px] border border-line p-3">
          <p className="text-[12px] font-bold text-ink-3">Why this role</p>
          <p className="mt-0.5">Four years building batch and streaming pipelines on Postgres and Kafka, the stack this team runs.</p>
          <p className="mt-1 text-[12px] text-lane">Drafted from your resume, work history</p>
        </div>
        <div className="rounded-[10px] border border-l-4 border-line border-l-signal bg-signal-50/60 p-3">
          <p className="text-[12px] font-extrabold text-signal-ink">Needs you • Work authorisation for Germany?</p>
          <p className="mt-0.5 text-ink-2">Your profile has no answer for this. Hirelane does not guess it.</p>
        </div>
      </div>
      <div className="mt-4 overflow-hidden rounded-[12px] border border-signal/70 bg-signal-50">
        <div className="flex items-center justify-between px-3.5 py-2.5 text-[14px] font-bold">
          <span>Sending to Northwind Freight</span>
          <span className="tabular-nums">2.8s</span>
        </div>
        <div className="h-1.5 bg-signal/30">
          <div className="h-full w-[70%] bg-ink" />
        </div>
      </div>
    </div>
  );
}

export function RepliesMock() {
  const rows = [
    { who: "Northwind Freight", what: "Interview invite: Thursday 11:00", tone: "lane" as const, tag: "Reply" },
    { who: "Larkspur Health", what: "Application received", tone: "neutral" as const, tag: "Filed" },
    { who: "Quillon Systems", what: "Not moving forward", tone: "neutral" as const, tag: "Soft-filed" },
  ];
  return (
    <div className={frame}>
      <div className="flex items-center gap-2 text-[14px] font-extrabold">
        <Inbox aria-hidden className="size-4 text-lane" /> Replies, filed on each application
      </div>
      <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2">
        {rows.map((r) => (
          <li key={r.who} className="flex items-center gap-3 rounded-[12px] border border-line p-3">
            <span className="grid size-9 place-items-center rounded-full bg-lane-50 text-lane">
              <Mail aria-hidden className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-extrabold">{r.who}</p>
              <p className="truncate text-[13px] text-ink-2">{r.what}</p>
            </div>
            <Chip tone={r.tone}>{r.tag}</Chip>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] text-ink-3">Each application has its own address, so replies never get lost in your inbox.</p>
    </div>
  );
}
