import Link from "next/link";
import { SwipeDeck } from "@/components/app/SwipeDeck";
import type { DeckCard } from "@/lib/sample/deck";
import type { HomeData } from "@/lib/sample/home";
import { Chevron, StudentShell } from "./Shell";

/** Student Home, direction A: one greeting, the deck, then short rows that each lead somewhere. */
export function HomeA({ data, deck }: { data: HomeData; deck: DeckCard[] }) {
  const initials = data.firstName.slice(0, 1).toUpperCase();
  return (
    <StudentShell active="home" initials={initials}>
      {data.sample ? <p className="st-sample">Sample student. Real numbers appear once picks are live.</p> : null}
      <div className="st-home">
        <header className="st-wide">
          <h1 className="st-hello">Good morning, {data.firstName}</h1>
          <p className="st-new">
            <b>{deck.length} new roles</b> you qualify for since yesterday
          </p>
        </header>

        <SwipeDeck cards={deck} />

        <div className="st-rail">
          {data.drives.length > 0 ? (
            <section className="st-section" aria-labelledby="dr-h">
              <h2 id="dr-h">
                Drives from your college <Link href="/drives">All drives</Link>
              </h2>
              <ul className="st-rows">
                {data.drives.map((d) => (
                  <li key={d.id}>
                    <Link className="st-row" href="/drives">
                      <span>
                        <b>{d.role}</b>
                        <small>{d.reason}</small>
                      </span>
                      <span className="st-tag" data-tone={d.daysLeft <= 2 ? "warn" : "good"}>
                        {d.daysLeft === 0 ? "Closes today" : `${d.daysLeft} days left`}
                      </span>
                      <Chevron />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {data.resume ? (
            <section className="st-section" aria-labelledby="rs-h">
              <h2 id="rs-h">Your resume</h2>
              <ul className="st-rows">
                <li>
                  <Link className="st-row" href="/resume">
                    <span>
                      <b>
                        {data.resume.passed} of {data.resume.total} checks pass
                      </b>
                      <small>{data.resume.topFix}</small>
                      <span className="st-meter" aria-hidden="true">
                        <i style={{ width: `${(data.resume.passed / data.resume.total) * 100}%` }} />
                      </span>
                    </span>
                    <span className="st-tag" data-tone="warn">
                      Fix next
                    </span>
                    <Chevron />
                  </Link>
                </li>
              </ul>
            </section>
          ) : null}

          <section className="st-section" aria-labelledby="more-h">
            <h2 id="more-h">More ways in</h2>
            <ul className="st-rows">
              {data.warm && data.warm.companies.length > 0 ? (
                <li>
                  <Link className="st-row" href="/network">
                    <span>
                      <b>You know people at {data.warm.companies.length} companies hiring</b>
                      <small>{data.warm.companies.map((c) => c.name).join(", ")}</small>
                    </span>
                    <span className="st-tag" data-tone="good">
                      Ask for a referral
                    </span>
                    <Chevron />
                  </Link>
                </li>
              ) : null}
              <li>
                <Link className="st-row" href="/paste">
                  <span>
                    <b>Found a job somewhere else?</b>
                    <small>Paste it. We check if you qualify and if it looks like a scam.</small>
                  </span>
                  <span />
                  <Chevron />
                </Link>
              </li>
              <li>
                <Link className="st-row" href="/tracker">
                  <span>
                    <b>
                      {data.week.handedOff} applied this week, {data.week.replies} {data.week.replies === 1 ? "reply" : "replies"}
                    </b>
                    <small>See where each one stands</small>
                  </span>
                  {data.week.replies > 0 ? (
                    <span className="st-tag" data-tone="good">
                      New reply
                    </span>
                  ) : (
                    <span />
                  )}
                  <Chevron />
                </Link>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </StudentShell>
  );
}
