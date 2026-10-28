"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DeckCard } from "@/lib/sample/deck";

const COMMIT_PX = 110;
const UNDO_MS = 4000;
const SKIP_REASONS = ["City", "Role", "Pay", "Too senior", "Other"];

type Done = { card: DeckCard; dir: "apply" | "skip" };

/**
 * Today's picks as a real deck: drag (pointer or touch), arrow keys or buttons. Right = get it ready, left = skip
 * with an optional reason, 4-second undo. The only client island on the student app; nothing is ever sent from here.
 */
export function SwipeDeck({ cards }: { cards: DeckCard[] }) {
  const [index, setIndex] = useState(0);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState<"apply" | "skip" | null>(null);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [applied, setApplied] = useState(0);
  const start = useRef<{ x: number; id: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const card = cards[index];
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const commit = useCallback(
    (dir: "apply" | "skip") => {
      if (!card || leaving) return;
      setLeaving(dir);
      setDx(dir === "apply" ? 600 : -600);
      window.setTimeout(
        () => {
          setDone({ card, dir });
          if (dir === "apply") setApplied((n) => n + 1);
          setIndex((i) => i + 1);
          setDx(0);
          setLeaving(null);
          setOpen(false);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setDone(null), UNDO_MS);
        },
        reduced ? 0 : 220,
      );
    },
    [card, leaving, reduced],
  );

  const undo = () => {
    if (!done) return;
    if (timer.current) clearTimeout(timer.current);
    if (done.dir === "apply") setApplied((n) => Math.max(0, n - 1));
    setIndex((i) => Math.max(0, i - 1));
    setDone(null);
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") commit("apply");
    else if (e.key === "ArrowLeft") commit("skip");
    else if (e.key === "ArrowUp") setOpen((o) => !o);
  };

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, a")) return;
    start.current = { x: e.clientX, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!start.current || start.current.id !== e.pointerId) return;
    setDx(e.clientX - start.current.x);
  };
  const onUp = () => {
    if (!start.current) return;
    start.current = null;
    setDragging(false);
    if (dx > COMMIT_PX) commit("apply");
    else if (dx < -COMMIT_PX) commit("skip");
    else setDx(0);
  };

  const progress = Math.max(-1, Math.min(1, dx / COMMIT_PX));

  return (
    <section className="wr-deck" aria-label="Today's picks" tabIndex={0} onKeyDown={onKey}>
      <div className="wr-swipe-top">
        <h2 className="wr-tile-label">Today&apos;s picks</h2>
        <p className="wr-tile-label">
          {Math.min(index + 1, cards.length)} of {cards.length}
          {applied > 0 ? `, ${applied} getting ready` : ""}
        </p>
      </div>
      <ol className="acct-bars wr-bars-night" aria-hidden="true">
        {cards.map((c, i) => (
          <li key={c.id} data-state={i < index ? "done" : i === index ? "now" : "todo"} />
        ))}
      </ol>

      <div className="wr-deck-stack">
        {cards.slice(index + 1, index + 3).map((c, i) => (
          <div key={c.id} className="wr-deck-peek" data-depth={i + 1} data-tone={c.tone} aria-hidden="true" />
        ))}

        {card ? (
          <article
            key={card.id}
            className="wr-deck-card"
            data-tone={card.tone}
            data-dragging={dragging || undefined}
            style={{ transform: `translateX(${dx}px) rotate(${dx / 18}deg)` }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            aria-roledescription="job card"
            aria-labelledby={`role-${card.id}`}
          >
            <span className="wr-stamp" data-kind="apply" style={{ opacity: Math.max(0, progress) }} aria-hidden="true">
              Get it ready
            </span>
            <span className="wr-stamp" data-kind="skip" style={{ opacity: Math.max(0, -progress) }} aria-hidden="true">
              Skip
            </span>

            <header className="wr-deck-co">
              <span className="wr-logo" aria-hidden="true">
                {card.initial}
              </span>
              <div>
                <p className="wr-pick-co">{card.company}</p>
                <p className="wr-pick-src">{card.about}</p>
              </div>
            </header>

            <ul className="wr-deck-signals">
              <li>{card.postedAgo}</li>
              <li>{card.momentum}</li>
            </ul>

            <h3 id={`role-${card.id}`} className="wr-pick-role">
              {card.role}
            </h3>
            <ul className="wr-pick-meta">
              <li>{card.city}</li>
              <li>{card.mode}</li>
              <li>{card.shift}</li>
            </ul>

            <p className="wr-deck-pay" data-stated={card.pay.stated || undefined}>
              <b>{card.pay.label}</b>
              {card.pay.monthly ? <span>{card.pay.monthly}</span> : <span>We never guess pay. Ask in the interview.</span>}
            </p>

            <div className="wr-deck-fit">
              <p className="wr-elig" data-status="pass">
                You qualify: {card.rules.met} of {card.rules.total} rules
              </p>
              <p className="wr-deck-match">
                <b>
                  {card.fit.met} of {card.fit.total}
                </b>{" "}
                must-haves
                <span className="wr-deck-meter" aria-hidden="true">
                  <i style={{ width: `${(card.fit.met / card.fit.total) * 100}%` }} />
                </span>
              </p>
            </div>

            {card.warm ? (
              <p className="wr-deck-warm">
                <span className="wr-faces" aria-hidden="true">
                  <span>{card.warm.initials}</span>
                </span>
                {card.warm.who}
              </p>
            ) : null}

            <button type="button" className="wr-deck-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {open ? "Less" : "Why you fit, the day, the rounds"}
            </button>

            {open ? (
              <div className="wr-deck-detail">
                <ul className="wr-fit">
                  {card.fit.lines.map((l) => (
                    <li key={l.text} data-status={l.ok === true ? "pass" : l.ok === false ? "fail" : "partial"}>
                      <span className="wr-fit-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          {l.ok === true ? <path d="M5 12l5 5 9-10" /> : l.ok === false ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M6 12h12" />}
                        </svg>
                      </span>
                      <span>
                        <strong>{l.text}</strong> <span className="wr-fit-quote">{l.quote}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <h4>What the day looks like</h4>
                <ul className="wr-deck-list">
                  {card.day.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
                <h4>Selection</h4>
                <ol className="wr-deck-rounds">
                  {card.rounds.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ol>
              </div>
            ) : null}

            <p className="wr-deck-effort">
              Your answers are ready. <a href={`/pick/${card.id}`}>Open the full page</a>
            </p>
          </article>
        ) : (
          <div className="wr-deck-empty">
            <h3>That&apos;s today&apos;s picks.</h3>
            <p>New roles you qualify for arrive tomorrow at 9. Meanwhile, paste any job you found to check it.</p>
          </div>
        )}
      </div>

      {card ? (
        <div className="wr-swipe-actions">
          <button type="button" className="wr-round" data-kind="skip" aria-label={`Skip ${card.role}`} onClick={() => commit("skip")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <button type="button" className="wr-round" data-kind="save" aria-label={`More about ${card.role}`} onClick={() => setOpen((o) => !o)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 8v8M8 12h8" />
            </svg>
          </button>
          <button type="button" className="wr-round" data-kind="go" aria-label={`Get ${card.role} ready`} onClick={() => commit("apply")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12l5 5 9-10" />
            </svg>
          </button>
        </div>
      ) : null}
      <p className="wr-swipe-hint">Drag the card, use the buttons, or press the arrow keys.</p>

      {done ? (
        <div className="wr-toast wr-deck-toast" role="status">
          <span className="wr-undo-ring" aria-hidden="true" key={done.card.id + done.dir}>
            <svg viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15" />
            </svg>
            <span>4</span>
          </span>
          <div>
            <p className="wr-toast-title">{done.dir === "apply" ? `${done.card.company}: answers getting ready` : `Skipped ${done.card.company}`}</p>
            {done.dir === "skip" ? (
              <div className="wr-reasons" aria-label="Why? Optional">
                {SKIP_REASONS.map((r) => (
                  <button key={r} type="button" onClick={() => setDone(null)}>
                    {r}
                  </button>
                ))}
              </div>
            ) : (
              <p className="wr-tile-fix">You&apos;ll check every answer before anything opens.</p>
            )}
          </div>
          <button type="button" className="acct-linkbtn" onClick={undo}>
            Undo
          </button>
        </div>
      ) : null}
    </section>
  );
}
