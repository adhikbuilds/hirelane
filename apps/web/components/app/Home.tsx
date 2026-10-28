import Link from "next/link";
import { Button } from "@/components/shadcn/button";
import type { HomeData } from "@/lib/sample/home";
import { TabBar } from "./TabBar";

/**
 * Student Home: a bento, not a list (approved mocks genz-a-app-v2 and genz-a-detail, adapted for campus).
 * Hooks, each tied to a real next action:
 * - picks: a small honest daily count with a time cost
 * - the resume health score: the fix that unlocks matches
 * - "roles you qualify for", and the cutoff blocking the rest
 * - drives from the placement cell, with a countdown
 * - a no-shame streak with exam pause
 * - the while-you-slept feed
 * - the weekly recap
 * Server component, no client JS.
 */
export function Home({ data }: { data: HomeData }) {
  const { picks, resume, qualify, drives, feed, week } = data;
  return (
    <div className="wr-app wr-home">
      {data.sample ? (
        <p className="wr-sample wr-area-sample">
          Sample student. This is how Home looks; real numbers appear once picks are live.
        </p>
      ) : null}

      <header className="wr-home-head wr-area-head">
        <div>
          <p className="wr-date">{data.dateLabel}</p>
          <h1 className="acct-display wr-hello">Morning, {data.firstName}.</h1>
          {data.college ? <p className="wr-college">{data.college}</p> : null}
        </div>
        <Streak days={data.streakDays} paused={data.paused} />
      </header>

      <section className="wr-tile wr-tile-pink wr-picks wr-area-picks" aria-labelledby="picks-h">
        <h2 id="picks-h" className="wr-tile-label">
          Today&apos;s picks, read {picks.readAgo}
        </h2>
        <div className="wr-picks-row">
          <p className="wr-big" aria-hidden="true">
            {picks.total}
          </p>
          <ul className="wr-picks-facts">
            <li>{picks.fresherFriendly} fresher-friendly</li>
            <li>{picks.remote} remote</li>
            <li>{picks.payStated} says its pay</li>
          </ul>
        </div>
        <p className="sr-only">{picks.total} picks today.</p>
        <div className="wr-picks-foot">
          <ul className="wr-chips" aria-label="Companies in today's picks">
            {picks.companies.map((c) => (
              <li key={c.name} data-tone={c.tone} title={c.name}>
                <span aria-hidden="true">{c.initial}</span>
                <span className="sr-only">{c.name}</span>
              </li>
            ))}
          </ul>
          <Button asChild variant="lime" size="pill-sm">
            <Link href="/picks">
              Swipe {picks.total}, about {picks.minutes} min
            </Link>
          </Button>
        </div>
      </section>

      <div className="wr-bento wr-area-bento">
        {resume ? (
          <section className="wr-tile wr-tile-sun" aria-labelledby="resume-h">
            <h2 id="resume-h" className="wr-tile-label">
              Your resume
            </h2>
            <p className="wr-mid">
              {resume.passed}
              <span>/{resume.total}</span>
            </p>
            <p className="wr-tile-text">checks pass</p>
            {resume.topFix ? <p className="wr-tile-fix">{resume.topFix}</p> : null}
            <Link className="wr-tile-link" href="/resume">
              Fix it
            </Link>
          </section>
        ) : (
          <section className="wr-tile wr-tile-sun" aria-labelledby="resume-h">
            <h2 id="resume-h" className="wr-tile-label">
              Your resume
            </h2>
            <p className="wr-tile-text">See what a company&apos;s hiring software sees.</p>
            <Link className="wr-tile-link" href="/resume">
              Check my resume
            </Link>
          </section>
        )}

        <section className="wr-tile wr-tile-lime" aria-labelledby="qualify-h">
          <h2 id="qualify-h" className="wr-tile-label">
            You qualify for
          </h2>
          <p className="wr-mid">{qualify.count}</p>
          <p className="wr-tile-text">roles this week</p>
          {qualify.blockedBy ? (
            <p className="wr-tile-fix">
              {qualify.blockedBy.count} more need {qualify.blockedBy.label}
            </p>
          ) : null}
          <Link className="wr-tile-link" href="/jobs?eligible=1">
            See them
          </Link>
        </section>
      </div>

      {drives.length > 0 ? (
        <section className="wr-tile wr-tile-blue wr-area-drives" aria-labelledby="drives-h">
          <h2 id="drives-h" className="wr-tile-label">
            From your placement cell
          </h2>
          <ul className="wr-drives">
            {drives.map((d) => (
              <li key={d.id}>
                <div className="wr-drive-main">
                  <p className="wr-drive-role">{d.role}</p>
                  <p className="wr-drive-co">{d.company}</p>
                  <p className="wr-drive-reason">{d.reason}</p>
                </div>
                <div className="wr-drive-side">
                  <span className="wr-pill" data-status={d.status}>
                    {d.status === "eligible" ? "You qualify" : d.status === "check" ? "Check" : "Not this one"}
                  </span>
                  <span className="wr-countdown">
                    {d.daysLeft === 0 ? "Closes today" : `${d.daysLeft} day${d.daysLeft === 1 ? "" : "s"} left`}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="wr-tile wr-tile-lime wr-area-warm" aria-labelledby="warm-h">
        <h2 id="warm-h" className="wr-tile-label">
          Who you know
        </h2>
        {data.warm && data.warm.companies.length > 0 ? (
          <>
            <ul className="wr-warm-list">
              {data.warm.companies.map((c) => (
                <li key={c.name}>
                  <span className="wr-faces" aria-hidden="true">
                    {c.people.map((p) => (
                      <span key={p.initials}>{p.initials}</span>
                    ))}
                  </span>
                  <span>
                    {c.people.length} {c.people.length === 1 ? "person" : "people"} at {c.name}
                  </span>
                </li>
              ))}
            </ul>
            <p className="wr-tile-fix">From your LinkedIn connections. Only you can see them.</p>
            <Link className="wr-tile-link" href="/network">
              Ask for a referral
            </Link>
          </>
        ) : (
          <>
            <p className="wr-tile-text">See who you know at each company before you apply.</p>
            <p className="wr-tile-fix">Upload your LinkedIn connections file. It stays private to you.</p>
            <Link className="wr-tile-link" href="/network">
              Add my connections
            </Link>
          </>
        )}
      </section>

      <section className="wr-tile wr-tile-cream wr-area-paste" aria-labelledby="paste-h">
        <h2 id="paste-h" className="wr-paste-title">
          Found a job somewhere else?
        </h2>
        <p className="wr-tile-text">Paste it from Naukri, LinkedIn or a WhatsApp forward. We&apos;ll tell you if you qualify and if it looks like a scam.</p>
        <Button asChild variant="outline" size="pill">
          <Link href="/paste">Paste a job</Link>
        </Button>
      </section>

      <section className="wr-feed wr-area-feed" aria-labelledby="feed-h">
        <h2 id="feed-h" className="wr-feed-h">
          While you slept
        </h2>
        <ol>
          {feed.map((f) => (
            <li key={`${f.at}-${f.text}`}>
              <time>{f.at}</time>
              <span>{f.text}</span>
              <span className="wr-pill" data-tag={f.tag}>
                {f.tag === "match" ? "New match" : f.tag === "reply" ? "Reply" : f.tag === "drive" ? "Drive" : "Gone"}
              </span>
            </li>
          ))}
        </ol>
        <p className="wr-feed-note">Nothing goes out without your tap.</p>
      </section>

      <section className="wr-tile wr-tile-ink wr-recap wr-area-recap" aria-labelledby="recap-h">
        <h2 id="recap-h" className="wr-tile-label">
          Your week so far
        </h2>
        <dl className="wr-stats">
          <div>
            <dt>forms handed off</dt>
            <dd>{week.handedOff}</dd>
          </div>
          <div>
            <dt>{week.replies === 1 ? "reply" : "replies"}</dt>
            <dd>{week.replies}</dd>
          </div>
          <div>
            <dt>minutes of typing saved</dt>
            <dd>{week.minutesSaved}</dd>
          </div>
        </dl>
        {week.recapReady ? (
          <Button asChild variant="on-night" size="pill">
            <Link href="/recap">Play your recap</Link>
          </Button>
        ) : null}
      </section>

      <section className="wr-pause wr-area-pause" aria-labelledby="pause-h">
        <h2 id="pause-h">Exams coming up?</h2>
        <p>Pause picks for up to 3 weeks. Your streak waits for you.</p>
        <Button asChild variant="on-night" size="pill-sm">
          <Link href="/you#pause">Pause picks</Link>
        </Button>
      </section>

      <TabBar active="home" />
    </div>
  );
}

function Streak({ days, paused }: { days: number; paused: boolean }) {
  if (days <= 0) return null;
  return (
    <p className="wr-streak" aria-label={paused ? `Streak of ${days} days, paused` : `Streak of ${days} days`}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M12 2c1 3.5 5 5.5 5 10a5 5 0 01-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5.5 1-8.5z" />
      </svg>
      {days} {days === 1 ? "day" : "days"}
      {paused ? <span> paused</span> : null}
    </p>
  );
}
