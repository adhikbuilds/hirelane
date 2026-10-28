import Link from "next/link";
import { Button } from "@/components/shadcn/button";
import type { DriveItem, Recap, TrackerItem } from "@/lib/sample/loop";

const DRIVE_PILL = { eligible: "You qualify", check: "Check", not_eligible: "Not this one", scam: "Looks like a scam" } as const;

/** Drives tab: notices the placement cell pasted, checked against the student's own marks. */
export function DrivesList({ drives }: { drives: DriveItem[] }) {
  return (
    <section className="wr-drive-list" aria-labelledby="drives-list-h">
      <h2 id="drives-list-h" className="wr-feed-h">
        From your placement cell
      </h2>
      <ul>
        {drives.map((d) => (
          <li key={d.id} className="wr-tile" data-status={d.status}>
            <div className="wr-drive-top">
              <span className="wr-pill" data-status={d.status}>
                {DRIVE_PILL[d.status]}
              </span>
              <span className="wr-countdown">{d.daysLeft === 0 ? "Closes today" : `${d.daysLeft} days left`}</span>
            </div>
            <h3 className="wr-drive-role">{d.role}</h3>
            <p className="wr-drive-co">
              {d.company}
              {d.ctc ? `, ${d.ctc}` : ""}
            </p>
            <p className="wr-drive-headline">{d.headline}</p>
            {d.status === "scam" ? (
              <p className="wr-tile-fix">Real employers never charge you to apply. Don&apos;t pay, and tell your placement cell.</p>
            ) : (
              <details className="wr-rules">
                <summary>See the {d.rules.length} rules</summary>
                <ul>
                  {d.rules.map((r) => (
                    <li key={r.text} data-status={r.status}>
                      {r.text}
                      <span className="sr-only">: {r.status === "pass" ? "you meet it" : r.status === "fail" ? "you don't" : "can't check"}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {d.status === "eligible" || d.status === "check" ? (
              <div className="wr-drive-actions">
                <Button asChild variant="lime" size="pill-sm">
                  <Link href="#">Apply on their site</Link>
                </Button>
                <Button asChild variant="outline" size="pill-sm">
                  <Link href="#">Not for me</Link>
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

const STATE_PILL = {
  handed_off: "Handed off",
  replied: "Reply",
  interview: "Interview",
  offer: "Offer",
  quiet: "Quiet 6 days",
  not_this_time: "Not this time",
} as const;

const COLUMNS: { id: string; label: string; states: TrackerItem["state"][] }[] = [
  { id: "handed", label: "Handed off", states: ["handed_off", "quiet"] },
  { id: "replied", label: "Replied", states: ["replied"] },
  { id: "interview", label: "Interview", states: ["interview"] },
  { id: "offer", label: "Offer", states: ["offer"] },
];

/** Tracker: a paper trail with times and outcome buttons (the north-star metric). Stage groups stack on phones and become board columns on desktop. */
export function Tracker({ items }: { items: TrackerItem[] }) {
  const counts = { all: items.length, replied: items.filter((i) => i.state === "replied").length, interview: items.filter((i) => i.state === "interview").length };
  return (
    <section className="wr-tracker" aria-labelledby="tracker-h">
      <div className="wr-swipe-top">
        <h1 id="tracker-h" className="acct-display wr-hello">
          Tracker
        </h1>
        <p className="wr-tile-label">{items.length} this week</p>
      </div>
      <ul className="wr-filters" aria-label="Filter">
        <li>
          <Link href="#" aria-current="true">
            All {counts.all}
          </Link>
        </li>
        <li>
          <Link href="#">Replied {counts.replied}</Link>
        </li>
        <li>
          <Link href="#">Interview {counts.interview}</Link>
        </li>
      </ul>
      <div className="wr-board">
        {COLUMNS.map((col) => {
          const inCol = items.filter((t) => col.states.includes(t.state));
          return (
            <section key={col.id} className="wr-board-col" aria-labelledby={`col-${col.id}`}>
              <h2 id={`col-${col.id}`} className="wr-board-h">
                {col.label} <span>{inCol.length}</span>
              </h2>
              <ol className="wr-track-list">
                {inCol.map((t) => (
          <li key={t.id} className="wr-tile" data-state={t.state}>
            <header className="wr-pick-head">
              <span className="wr-logo" aria-hidden="true">
                {t.initial}
              </span>
              <div>
                <p className="wr-pick-co">{t.company}</p>
                <p className="wr-tile-fix">{t.role}</p>
              </div>
              <span className="wr-pill" data-state={t.state}>
                {STATE_PILL[t.state]}
              </span>
            </header>
            {t.state === "replied" || t.state === "interview" ? (
              <>
                <ol className="wr-timeline">
                  {t.steps.map((s) => (
                    <li key={s.at + s.text} data-done={s.done || undefined}>
                      <span>{s.text}</span>
                      <time>{s.at}</time>
                    </li>
                  ))}
                </ol>
                <div className="wr-drive-actions">
                  <Button asChild variant="lime" size="pill-sm">
                    <Link href="#">{t.state === "interview" ? "I got an offer" : "I got an interview"}</Link>
                  </Button>
                  <Button asChild variant="outline" size="pill-sm">
                    <Link href="#">Add a note</Link>
                  </Button>
                </div>
              </>
            ) : (
              <div className="wr-drive-actions">
                <Button asChild variant="outline" size="pill-sm">
                  <Link href="#">They replied</Link>
                </Button>
              </div>
            )}
          </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
      <p className="wr-feed-note">Rejections are filed quietly as &quot;Not this time&quot;. Your college sees outcomes only if you share them.</p>
    </section>
  );
}

/** Weekly recap: Wrapped-style story slides. One big moment per slide; honest counts; built to be shared. No JS. */
export function RecapCard({ recap }: { recap: Recap }) {
  const slides = [
    { tone: "blue", kicker: `Your week, ${recap.weekLabel}`, big: "23", line: "roles checked against your marks.", sub: "4 were worth your time." },
    { tone: "lime", kicker: "Applied, on their own sites", big: String(recap.handedOff), line: "applications. Zero retyping.", sub: "Every answer came from your resume.", stamp: "Applied" },
    { tone: "pink", kicker: "Somebody wrote back", big: String(recap.replies), line: `reply. ${recap.bestMatch} wants a call.`, sub: "Thursday, 4 pm. Good luck." },
    { tone: "sun", kicker: "You levelled up", big: "7/9", line: "resume checks pass now.", sub: "It was 3/9 on Monday. Next week: roles at 2 companies where you know someone." },
  ];
  return (
    <section className="wr-recap" aria-labelledby="recap-h">
      <h1 id="recap-h" className="sr-only">
        Your week on Hirelane
      </h1>
      <ol className="wr-recap-reel">
        {slides.map((s, i) => (
          <li key={s.kicker} className="wr-slide" data-tone={s.tone}>
            <ol className="acct-bars wr-slide-bars" aria-hidden="true">
              {slides.map((_, j) => (
                <li key={j} data-state={j < i ? "done" : j === i ? "now" : "todo"} />
              ))}
            </ol>
            <p className="wr-slide-kicker">{s.kicker}</p>
            <p className="wr-slide-big">{s.big}</p>
            <p className="wr-slide-line">{s.line}</p>
            <p className="wr-slide-sub">{s.sub}</p>
            {s.stamp ? (
              <span className="wr-slide-stamp" aria-hidden="true">
                {s.stamp}
              </span>
            ) : null}
            <p className="wr-slide-brand" aria-hidden="true">
              hire<b>lane</b>
            </p>
          </li>
        ))}
      </ol>
      <aside className="wr-share" aria-label="Share your week">
        <h2 className="wr-paste-title">Share your week</h2>
        <p className="wr-tile-fix">Made for a 9:16 story. Your marks and companies you skipped are never on it.</p>
        <Button asChild variant="lime" size="pill">
          <Link href="#">Share to Instagram story</Link>
        </Button>
        <Button asChild variant="on-night" size="pill">
          <Link href="#">Download the image</Link>
        </Button>
        <Button asChild variant="on-night" size="pill">
          <Link href="#">Send on WhatsApp</Link>
        </Button>
      </aside>
    </section>
  );
}
