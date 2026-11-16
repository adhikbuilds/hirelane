import Link from "next/link";
import type { HomeView } from "@/lib/student/types";
import { CopyButton } from "./CopyButton";
import { Feed } from "./Feed";
import { RowLink, StudentShell } from "./AppShell";

const countLine = (d: HomeView) =>
  d.cards.length === 0 ? (
    <>No new roles yet today</>
  ) : d.newCount > 0 ? (
    <>
      <b>
        {d.newCount} new {d.newCount === 1 ? "role" : "roles"}
      </b>{" "}
      you qualify for since yesterday
    </>
  ) : (
    <>
      <b>
        {d.cards.length} {d.cards.length === 1 ? "role" : "roles"}
      </b>{" "}
      you qualify for today
    </>
  );

/** Student Home, direction A (approved): the feed is the page, and one ruled panel holds everything that needs or leads somewhere. */
export function HomeA({ data }: { data: HomeView }) {
  const needs = data.codes.length + data.finish.length;
  const replies = data.week.replies;
  return (
    <StudentShell active="home" initial={data.initial} badge={data.badge}>
      <div className="st-a-head">
        <h1 className="st-a-title">Good morning, {data.firstName}</h1>
        <p className="st-a-count">{countLine(data)}</p>
        {data.sample ? <p className="st-sample">Sample student. Real numbers appear once picks are live.</p> : null}
      </div>
      <div className="st-home">
        <Feed cards={data.cards} variant="home" autoApply={data.autoApply} address={data.applyAddress} network={!data.sample && data.pilot} />

        <div className="st-panel st-rp st-rows">
          {needs > 0 ? (
            <div>
              <div className="st-grp" style={{ display: "flex", justifyContent: "space-between" }}>
                Needs you<span className="st-num">{needs}</span>
              </div>
              {data.codes.map((c) => (
                <div className="st-rowlink" key={c.id}>
                  <div className="st-rl-main">
                    <div className="st-rl-t">Security code from {c.from}</div>
                    <div className="st-code st-num" style={{ margin: "6px 0 4px" }}>
                      {c.code}
                    </div>
                    <div className="st-rl-m">{c.note}</div>
                  </div>
                  <CopyButton text={c.code.replace(/\s/g, "")} aria="Copy code" />
                </div>
              ))}
            </div>
          ) : null}
          {data.finish.map((n) => (
            <RowLink key={n.id} href={`/tracker/${n.id}`} title={n.needsAnswers > 0 ? `${n.company} needs ${n.needsAnswers} ${n.needsAnswers === 1 ? "answer" : "answers"}` : `Finish ${n.company} on their site`} meta={n.reason} action="Finish" />
          ))}

          {data.drives.length > 0 ? (
            <div>
              <div className="st-grp" style={{ display: "flex", justifyContent: "space-between" }}>
                Drives from your college
                <Link href="/drives" style={{ color: "var(--ink-2)", textDecoration: "none" }}>
                  All drives
                </Link>
              </div>
              <RowLink href={`/drives?d=${data.drives[0]!.id}`} title={drive(data.drives[0]!)} meta={data.drives[0]!.verdict} action={data.drives[0]!.closesShort} />
            </div>
          ) : null}
          {data.drives.slice(1).map((d) => (
            <RowLink key={d.id} href={`/drives?d=${d.id}`} title={drive(d)} meta={d.verdict} action={d.closesShort} />
          ))}

          {data.resume ? (
            <div>
              <div className="st-grp">Your resume</div>
              <RowLink href="/resume" title={`${data.resume.passed} of ${data.resume.total} checks pass`} meta={data.resume.topFix ?? "Nothing to fix right now."} action={data.resume.topFix ? "Fix next" : undefined} />
            </div>
          ) : (
            <RowLink href="/resume" title="Add your resume" meta="We check it the way hiring software reads it, and fill your applications from it." />
          )}
          {data.marks ? <RowLink href="/you" title={data.marks.label} meta={`${data.marks.moreDrives} more ${data.marks.moreDrives === 1 ? "drive" : "drives"} you can check`} /> : null}
          <RowLink
            href="/tracker"
            title={`${data.week.applied} applied this week, ${replies} ${replies === 1 ? "reply" : "replies"}`}
            meta={data.week.replyLine ?? "See where each one stands"}
            action="Tracker"
          />
          <RowLink href="/paste" title="Found a job somewhere else?" meta="Paste it. We check if you qualify and if it looks like a scam." />
        </div>
      </div>
    </StudentShell>
  );
}

const drive = (d: { role: string; company: string | null }) => (d.company ? `${d.role}, ${d.company}` : d.role);
