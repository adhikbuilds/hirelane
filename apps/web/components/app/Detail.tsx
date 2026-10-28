import Link from "next/link";
import { Button } from "@/components/shadcn/button";
import type { DeckCard } from "@/lib/sample/deck";

function Tick({ ok }: { ok: boolean | "partial" }) {
  return (
    <span className="wr-fit-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        {ok === true ? <path d="M5 12l5 5 9-10" /> : ok === false ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M6 12h12" />}
      </svg>
    </span>
  );
}

/** Full job page: a story, not a spreadsheet (mock genz-a-detail). The action bar is sticky and never covers content. */
export function JobDetail({ card, sample }: { card: DeckCard; sample: boolean }) {
  return (
    <div className="wr-app">
      {sample ? <p className="wr-sample">Sample role. Real pages are built from the company&apos;s own careers page.</p> : null}
      <Link className="wr-back" href="/picks">
        Back to picks
      </Link>

      <section className="wr-job-hero" data-tone={card.tone} aria-labelledby="job-h">
        <header className="wr-deck-co">
          <span className="wr-logo" aria-hidden="true">
            {card.initial}
          </span>
          <div>
            <Link className="wr-pick-co" href={`/co/${card.id}`}>
              {card.company}
            </Link>
            <p className="wr-pick-src">Read from their careers page. {card.postedAgo}.</p>
          </div>
        </header>
        <h1 id="job-h" className="wr-job-title">
          {card.role}
        </h1>
        <ul className="wr-pick-meta">
          <li>{card.city}</li>
          <li>{card.mode}</li>
          <li>{card.shift}</li>
        </ul>
      </section>

      <div className="wr-bento">
        <section className="wr-tile wr-tile-lime" aria-labelledby="mh-h">
          <h2 id="mh-h" className="wr-tile-label">
            Must-haves you meet
          </h2>
          <p className="wr-mid">
            {card.fit.met}
            <span>/{card.fit.total}</span>
          </p>
        </section>
        <section className="wr-tile wr-tile-sun" aria-labelledby="pay-h">
          <h2 id="pay-h" className="wr-tile-label">
            Pay
          </h2>
          <p className="wr-mid wr-mid-word">{card.pay.stated ? card.pay.label : "Not stated"}</p>
          <p className="wr-tile-fix">{card.pay.monthly ?? "We never guess. Ask in the interview."}</p>
        </section>
      </div>

      <section className="wr-tile wr-tile-cream" aria-labelledby="why-h">
        <h2 id="why-h" className="wr-paste-title">
          Why you fit
        </h2>
        <ul className="wr-fit wr-fit-plain">
          {card.fit.lines.map((l) => (
            <li key={l.text} data-status={l.ok === true ? "pass" : l.ok === false ? "fail" : "partial"}>
              <Tick ok={l.ok} />
              <span>
                <strong>{l.text}</strong> <span className="wr-fit-quote">{l.quote}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="wr-elig" data-status="pass">
          You qualify: {card.rules.met} of {card.rules.total} eligibility rules
        </p>
      </section>

      {card.warm ? (
        <section className="wr-tile wr-tile-pink" aria-labelledby="warm-h">
          <h2 id="warm-h" className="wr-paste-title">
            You know someone here
          </h2>
          <p className="wr-deck-warm">
            <span className="wr-faces" aria-hidden="true">
              <span>{card.warm.initials}</span>
            </span>
            {card.warm.who}
          </p>
          <Button asChild variant="outline" size="pill-sm">
            <Link href="/network">Draft a referral ask</Link>
          </Button>
        </section>
      ) : null}

      <section className="wr-tile wr-tile-cream" aria-labelledby="day-h">
        <h2 id="day-h" className="wr-paste-title">
          What the day looks like
        </h2>
        <ul className="wr-deck-list">
          {card.day.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        <h3 className="wr-sub-h">How they hire</h3>
        <ol className="wr-rounds-line">
          {card.rounds.map((r, i) => (
            <li key={r}>
              <span>{i + 1}</span>
              {r}
            </li>
          ))}
        </ol>
      </section>

      <section className="wr-tile wr-tile-ink" aria-labelledby="co-h">
        <h2 id="co-h" className="wr-tile-label">
          About {card.company}
        </h2>
        <p className="wr-tile-text">{card.about}</p>
        <p className="wr-tile-fix">{card.momentum}</p>
        <Link className="wr-tile-link" href={`/co/${card.id}`}>
          See the company
        </Link>
      </section>

      <div className="wr-action-bar" role="group" aria-label="Decide">
        <Button asChild variant="on-night" size="pill-sm">
          <Link href="/picks">Skip</Link>
        </Button>
        <Button asChild variant="lime" size="pill-sm">
          <Link href="/picks">Get it ready</Link>
        </Button>
      </div>
    </div>
  );
}

/** Company page: momentum and people, not analytics (mock genz-a-app-v2). */
export function CompanyPage({ card, roles, sample }: { card: DeckCard; roles: DeckCard[]; sample: boolean }) {
  return (
    <div className="wr-app">
      {sample ? <p className="wr-sample">Sample company page. Counts come from the company&apos;s careers page as we read it.</p> : null}
      <section className="wr-job-hero" data-tone={card.tone} aria-labelledby="co-title">
        <header className="wr-deck-co">
          <span className="wr-logo" aria-hidden="true">
            {card.initial}
          </span>
          <div>
            <h1 id="co-title" className="wr-job-title">
              {card.company}
            </h1>
            <p className="wr-pick-src">{card.about}</p>
          </div>
        </header>
        <div className="wr-drive-actions">
          <Button type="button" variant="lime" size="pill-sm">
            Follow: new roles go to your Home
          </Button>
        </div>
      </section>

      <div className="wr-bento">
        <section className="wr-tile wr-tile-lime" aria-labelledby="mom-h">
          <h2 id="mom-h" className="wr-tile-label">
            Hiring now
          </h2>
          <p className="wr-mid wr-mid-word">{card.momentum}</p>
          <ol className="wr-spark" aria-label="New roles per week, last 8 weeks">
            {[2, 3, 1, 4, 3, 5, 4, 6].map((n, i) => (
              <li key={i} style={{ height: `${n * 14}%` }} title={`${n} new roles`} />
            ))}
          </ol>
        </section>
        <section className="wr-tile wr-tile-pink" aria-labelledby="ppl-h">
          <h2 id="ppl-h" className="wr-tile-label">
            People you know
          </h2>
          {card.warm ? (
            <>
              <p className="wr-mid">1</p>
              <p className="wr-tile-fix">{card.warm.who}</p>
            </>
          ) : (
            <>
              <p className="wr-tile-text">No one yet</p>
              <Link className="wr-tile-link" href="/network">
                Add your connections
              </Link>
            </>
          )}
        </section>
      </div>

      <section className="wr-tile wr-tile-cream" aria-labelledby="open-h">
        <h2 id="open-h" className="wr-paste-title">
          Open for you
        </h2>
        <ul className="wr-role-list">
          {roles.map((r) => (
            <li key={r.id}>
              <Link href={`/pick/${r.id}`}>
                <b>{r.role}</b>
                <span>
                  {r.city}, {r.pay.stated ? r.pay.label : "pay not stated"}
                </span>
              </Link>
              <span className="wr-pill" data-status="eligible">
                You qualify
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
