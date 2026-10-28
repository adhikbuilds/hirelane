import Link from "next/link";
import { Button } from "@/components/shadcn/button";
import type { CheckAnswer, PickCard } from "@/lib/sample/loop";

function FitIcon({ status }: { status: "pass" | "fail" | "partial" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {status === "pass" ? <path d="M5 12l5 5 9-10" /> : status === "fail" ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M6 12h12" />}
    </svg>
  );
}

/** Today's picks: progress bars, the 45-second card with its fit maths, and a button for every gesture. */
export function SwipeCard({ card, index, total }: { card: PickCard; index: number; total: number }) {
  return (
    <section className="wr-swipe" aria-labelledby="pick-h">
      <div className="wr-swipe-top">
        <h2 className="wr-tile-label">Today&apos;s picks</h2>
        <p className="wr-tile-label">
          {index} of {total}
        </p>
      </div>
      <ol className="acct-bars wr-bars-night" aria-label="Picks progress">
        {Array.from({ length: total }, (_, i) => (
          <li key={i} data-state={i + 1 < index ? "done" : i + 1 === index ? "now" : "todo"} />
        ))}
      </ol>

      <div className="wr-card-deck">
        <article className="wr-pick">
          <header className="wr-pick-head">
            <span className="wr-logo" aria-hidden="true">
              {card.initial}
            </span>
            <div>
              <p className="wr-pick-co">{card.company}</p>
              <p className="wr-pick-src">Read from their careers page {card.readAgo}</p>
            </div>
            <p className="wr-ring" aria-label={`${card.mustHaves.met} of ${card.mustHaves.total} must-haves met`}>
              {card.mustHaves.met}
              <span>/{card.mustHaves.total}</span>
            </p>
          </header>
          <h3 id="pick-h" className="wr-pick-role">
            {card.role}
          </h3>
          <ul className="wr-pick-meta">
            <li>{card.city}</li>
            <li>{card.experience}</li>
            <li>{card.employment}</li>
          </ul>
          <p className="wr-elig" data-status={card.eligibility.status}>
            {card.eligibility.status === "pass"
              ? `You qualify: ${card.eligibility.rulesMet} of ${card.eligibility.rulesTotal} rules`
              : "We couldn't check every rule"}
          </p>
          <ul className="wr-fit">
            {card.fit.map((f) => (
              <li key={f.text} data-status={f.status}>
                <span className="wr-fit-icon">
                  <FitIcon status={f.status} />
                </span>
                <span>
                  <strong>{f.text}</strong>
                  {f.quote ? <span className="wr-fit-quote"> {f.quote}</span> : null}
                </span>
              </li>
            ))}
          </ul>
          <p className="wr-pay">{card.pay ?? "Pay not in the posting. We never guess."}</p>
        </article>
      </div>

      <div className="wr-swipe-actions">
        <form action="#">
          <button type="submit" className="wr-round" data-kind="skip" aria-label="Skip this role">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </form>
        <form action="#">
          <button type="submit" className="wr-round" data-kind="save" aria-label="Save for later">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
            </svg>
          </button>
        </form>
        <form action="#">
          <button type="submit" className="wr-round" data-kind="go" aria-label="Get it ready">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12l5 5 9-10" />
            </svg>
          </button>
        </form>
      </div>
      <p className="wr-swipe-hint">Skip, save or get it ready. Swiping works too.</p>
    </section>
  );
}

/** Check before hand-off: every answer with where it came from; the one we can't know is asked, never guessed. */
export function CheckScreen({ card, answers }: { card: PickCard; answers: CheckAnswer[] }) {
  return (
    <section className="wr-tile wr-tile-cream wr-check" aria-labelledby="check-h">
      <header className="wr-pick-head">
        <div>
          <h2 id="check-h" className="wr-paste-title">
            Ready to fill
          </h2>
          <p className="wr-tile-fix">
            {card.role} at {card.company}
          </p>
        </div>
        <span className="wr-logo" aria-hidden="true">
          {card.initial}
        </span>
      </header>
      <dl className="wr-answers">
        {answers.map((a) => (
          <div key={a.label}>
            <dt>
              {a.label} <span>{a.source}</span>
            </dt>
            <dd>{a.value}</dd>
          </div>
        ))}
      </dl>
      <fieldset className="wr-needs">
        <legend>Needs you: when can you join?</legend>
        <p>We won&apos;t guess this one.</p>
        <div className="wr-needs-opts">
          {["Right away", "In 2 weeks", "After exams"].map((o, i) => (
            <label key={o}>
              <input type="radio" name="start" defaultChecked={i === 0} />
              <span>{o}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="wr-resume-row">
        <span>Resume: Rahul_Sample_Resume.pdf, made with the builder</span>
        <Link href="/resume">Swap</Link>
      </p>
      <Button asChild variant="lime" size="pill">
        <Link href="#handoff">Open {card.company}&apos;s form, answers ready to copy</Link>
      </Button>
      <p className="wr-tile-fix">You press submit on their site. We never do.</p>
    </section>
  );
}

/** Hand-off with a 4-second undo. The ring is pure CSS; the server enforces undo_until. */
export function HandoffToast({ company, weekCount }: { company: string; weekCount: number }) {
  return (
    <section id="handoff" className="wr-toast" role="status" aria-labelledby="toast-h">
      <span className="wr-undo-ring" aria-hidden="true">
        <svg viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="15" />
        </svg>
        <span>4</span>
      </span>
      <div>
        <p id="toast-h" className="wr-toast-title">
          {company} form opened, answers ready
        </p>
        <p className="wr-tile-fix">Number {weekCount} this week, saved in your Tracker</p>
      </div>
      <form action="#">
        <button type="submit" className="acct-linkbtn">
          Undo
        </button>
      </form>
    </section>
  );
}
