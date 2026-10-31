"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { postJson, readSet, writeSet } from "@/lib/student/client";
import type { CardData } from "@/lib/student/types";
import { Ic } from "./Icon";
import { GLYPH, RoleCard } from "./RoleCard";

type Kind = "apply" | "skip" | "save";
const UNDO_MS = 4000;
const WIDE_PX = 900;

interface ToastState {
  key: number;
  kind: Kind | "error";
  title: string;
  sub: string;
  /** The application a right swipe created, so Undo can take it back inside the 4 second window. */
  appId: string | null;
  frozen: boolean;
}

interface SwipeOut {
  application: { id: string };
}

const reduced = (): boolean => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * Today's picks as a deck. Drag the card on a phone, press the arrow keys, or use the three buttons (all three work
 * everywhere). Right = apply (a real application with a 4 second undo window when the card has a job), left = skip,
 * up = save, Space = details, Ctrl/Cmd+Z = undo. On a laptop the deck has no dragging: pick from the list and press the buttons.
 */
export function Deck({
  cards,
  variant,
  autoApply,
  address,
  network,
}: {
  cards: CardData[];
  variant: "home" | "picks";
  autoApply: boolean;
  address: string | null;
  /** True when a right swipe really creates an application. False for the sample and before the pilot, where it only marks the card ready. */
  network: boolean;
}) {
  const [i, setI] = useState(0);
  const [done, setDone] = useState<Record<number, Kind>>({});
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [live, setLive] = useState("");
  const hist = useRef<number[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Promise<string | null> | null>(null);
  const cardEl = useRef<HTMLElement | null>(null);
  const deckEl = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x0: number; dx: number } | null>(null);
  const seq = useRef(0);

  const lbl = { apply: autoApply ? "Applied" : "Ready", skip: "Skipped", save: "Saved" } as const;

  // What this student already skipped today stays skipped after a reload; no service stores it, so the toast says "on this device".
  useEffect(() => {
    const skipped = readSet("skipped");
    if (skipped.size === 0) return;
    const marks: Record<number, Kind> = {};
    cards.forEach((c, n) => {
      if (skipped.has(c.id)) marks[n] = "skip";
    });
    if (Object.keys(marks).length > 0) {
      setDone(marks);
      setI(firstOpen(cards.length, marks, -1));
    }
  }, [cards]);

  useEffect(() => {
    const frame = deckEl.current?.closest(".st") as HTMLElement | null;
    if (!frame) return;
    const measure = () => setWide(frame.offsetWidth > WIDE_PX);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(frame);
    return () => ro.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const card = cards[i];
  const showOpen = open || (variant === "picks" && wide);

  const say = (t: ToastState) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(t);
    setLive(t.kind === "apply" ? `${t.title}. Undo available for 4 seconds.` : t.title);
    timer.current = setTimeout(() => setToast((cur) => (cur && cur.key === t.key ? null : cur)), UNDO_MS);
  };

  const commit = useCallback(
    (kind: Kind) => {
      if (!card) return;
      const el = cardEl.current;
      const index = i;
      const w = deckEl.current?.offsetWidth ?? 400;
      const dir = kind === "skip" ? -1 : kind === "apply" ? 1 : 0;
      if (el && !reduced()) {
        el.style.transition = "transform var(--dur-card) var(--ease-out),opacity var(--dur-card) var(--ease-out)";
        if (kind === "apply") {
          const s = el.querySelector<HTMLElement>(".st-stamp:not(.st-skip)");
          if (s) {
            s.style.transition = "opacity 120ms, transform 120ms";
            s.style.opacity = "1";
            s.style.transform = "rotate(-8deg) scale(1)";
          }
        }
        el.style.transform = dir ? `translateX(${dir * 1.2 * w}px) rotate(${dir * 12}deg)` : "translateY(-60%) scale(.9)";
        el.style.opacity = dir ? "1" : "0";
      }
      hist.current.push(index);
      const key = ++seq.current;
      const marks = { ...done, [index]: kind };
      setDone(marks);

      const sub: Record<Kind, string> = {
        apply: autoApply ? "Sends from your Hirelane address in 4 seconds" : "Open their form to submit. Your answers are ready.",
        skip: "Hidden from today’s picks on this device",
        save: "Saved on this device",
      };
      const title = kind === "apply" ? `${lbl.apply}: ${card.role}, ${card.company}` : kind === "skip" ? `Skipped ${card.company}` : `Saved ${card.role}`;
      say({ key, kind, title, sub: sub[kind], appId: null, frozen: false });

      if (kind === "skip") writeSet("skipped", new Set([...readSet("skipped"), card.id]));
      if (kind === "save") writeSet("saved", new Set([...readSet("saved"), card.id]));

      if (kind === "apply" && card.jobId && network) {
        const p = postJson<SwipeOut>("/api/v1/apply/swipe", { jobId: card.jobId }).then((r) => {
          if (r.ok && r.data) {
            setToast((cur) => (cur && cur.key === key ? { ...cur, appId: r.data!.application.id } : cur));
            return r.data.application.id;
          }
          // Roll the card back and say why, in plain words. Nothing was queued.
          hist.current = hist.current.filter((n) => n !== index);
          setDone((d) => {
            const { [index]: _gone, ...rest } = d;
            return rest;
          });
          setI(index);
          say({ key: ++seq.current, kind: "error", title: "That one didn’t go through", sub: r.error === "auto_apply_off" ? "Applying from Hirelane isn’t switched on yet." : "Nothing was sent. Try it again in a moment.", appId: null, frozen: false });
          return null;
        });
        pending.current = p;
      }

      window.setTimeout(
        () => {
          // A swipe refused by the server (or an Undo that came first) has already taken this decision back.
          if (!hist.current.includes(index)) return;
          setI((cur) => (cur === index ? firstOpen(cards.length, marks, index) : cur));
          setOpen(false);
        },
        reduced() ? 0 : 280,
      );
    },
    // `say` and `lbl` are stable in effect: they only read refs and props captured here
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [card, i, done, autoApply, cards.length, network],
  );

  const undo = useCallback(async () => {
    if (!toast || toast.kind === "error") return;
    const index = hist.current.pop();
    if (index === undefined) return;
    if (timer.current) clearTimeout(timer.current);
    if (toast.kind === "apply" && network) {
      const id = toast.appId ?? (await pending.current);
      if (id) {
        const r = await postJson(`/api/v1/apply/applications/${id}/undo`);
        if (!r.ok) {
          hist.current.push(index);
          say({ key: ++seq.current, kind: "error", title: "Too late to take that back", sub: "It has already gone. You can follow it in Tracker.", appId: null, frozen: false });
          return;
        }
      }
    }
    const c = cards[index];
    if (c) {
      const sk = readSet("skipped");
      sk.delete(c.id);
      writeSet("skipped", sk);
      const sv = readSet("saved");
      sv.delete(c.id);
      writeSet("saved", sv);
    }
    setToast(null);
    setDone((d) => {
      const { [index]: _gone, ...rest } = d;
      return rest;
    });
    setI(index);
    setOpen(false);
    deckEl.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, cards, network]);

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      void undo();
      return;
    }
    if (!card) return;
    const m = ({ ArrowLeft: "skip", ArrowRight: "apply", ArrowUp: "save" } as const)[e.key as "ArrowLeft"];
    if (m) {
      e.preventDefault();
      commit(m);
    } else if (e.key === " " && e.target === deckEl.current) {
      e.preventDefault();
      setOpen((o) => !o);
    }
  };

  const stampsOf = (el: HTMLElement) => ({ a: el.querySelector<HTMLElement>(".st-stamp:not(.st-skip)"), s: el.querySelector<HTMLElement>(".st-stamp.st-skip") });
  const handlers: React.HTMLAttributes<HTMLElement> = {
    onPointerDown: (e) => {
      if (wide || (e.target as HTMLElement).closest("button,a")) return;
      drag.current = { x0: e.clientX, dx: 0 };
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.style.transition = "none";
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (!d) return;
      const w = deckEl.current?.offsetWidth ?? 400;
      d.dx = e.clientX - d.x0;
      const el = e.currentTarget as HTMLElement;
      el.style.transform = `translateX(${d.dx}px) rotate(${(d.dx / w) * 12}deg)`;
      const p = Math.min(1, Math.abs(d.dx) / (w * 0.35));
      const { a, s } = stampsOf(el);
      const on = d.dx > 0 ? a : s;
      const off = d.dx > 0 ? s : a;
      if (on) {
        on.style.opacity = String(p);
        on.style.transform = `rotate(${d.dx > 0 ? -8 : 8}deg) scale(${1.08 - 0.08 * p})`;
      }
      if (off) off.style.opacity = "0";
    },
    onPointerUp: (e) => release(e.currentTarget as HTMLElement),
    onPointerCancel: (e) => release(e.currentTarget as HTMLElement),
  };
  function release(el: HTMLElement) {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const w = deckEl.current?.offsetWidth ?? 400;
    if (d.dx > w * 0.35) commit("apply");
    else if (d.dx < -w * 0.35) commit("skip");
    else {
      el.style.transition = "transform var(--dur-enter) var(--ease-out)";
      el.style.transform = "";
      const { a, s } = stampsOf(el);
      if (a) a.style.opacity = "0";
      if (s) s.style.opacity = "0";
    }
  }

  const remaining = cards.length - Object.keys(done).length;
  const position = card ? `${i + 1} of ${cards.length}` : `${cards.length} of ${cards.length}`;
  const bars = useMemo(() => cards.map((c, n) => <i key={c.id} className={n === i && card ? "st-on" : undefined} />), [cards, i, card, done]);

  const body = (
    <>
      <div className="st-sec-h">
        <h2 className={variant === "picks" ? "st-small" : undefined} style={variant === "picks" ? { fontSize: 13 } : undefined}>
          {variant === "picks" ? "Roles you qualify for, today" : "Today’s picks"}
        </h2>
        <span className="st-small st-num">{cards.length === 0 ? "0" : position}</span>
      </div>
      <div className="st-bars" aria-hidden="true">
        {bars}
      </div>
      <div ref={deckEl} className="st-deck" tabIndex={0} aria-label="Today’s picks. Left arrow skips, right arrow applies, up arrow saves." onKeyDown={onKey}>
        <div>
          {card ? (
            <RoleCard
              key={card.id}
              card={card}
              open={showOpen}
              onToggle={() => setOpen((o) => !o)}
              stampLabel={lbl.apply}
              articleRef={(n) => {
                cardEl.current = n;
              }}
              handlers={handlers}
            />
          ) : (
            <div className="st-panel st-emptydeck">
              <div className="st-c-h">{cards.length === 0 ? "No new roles yet." : "That’s today’s picks."}</div>
              <p className="st-ink2">{cards.length === 0 ? "Roles you qualify for show up here each morning. Paste one you found and we’ll check it." : "New roles you qualify for show up here each morning."}</p>
              <p>
                <Link className="st-tlink" href={cards.length === 0 ? "/paste" : "/tracker"}>
                  {cards.length === 0 ? "Paste a job" : "See your Tracker"}
                  <Ic name="arrow" small />
                </Link>
              </p>
            </div>
          )}
        </div>
      </div>
      {card || cards.length > 0 ? (
        <div className="st-deck-acts">
          <button className="st-btn" type="button" disabled={!card} onClick={() => commit("skip")}>
            <Ic name="x" small />
            Skip
          </button>
          <button className="st-btn" type="button" disabled={!card} onClick={() => commit("save")}>
            <Ic name="plus" small />
            Save
          </button>
          <button className="st-btn st-p" type="button" disabled={!card} onClick={() => commit("apply")}>
            <Ic name="check" small />
            {autoApply ? "Apply" : "Get it ready"}
          </button>
        </div>
      ) : null}
      {address ? (
        <p className="st-mode">
          {autoApply ? "Applies from" : "Ready from"} <span className="st-mono">{address}</span>
        </p>
      ) : null}
      <div className="st-toast-slot">
        <p className="st-hint">{remaining > 0 ? "Drag the card, use the buttons, or press the arrow keys." : "Undo with the button above or Ctrl+Z."}</p>
        <div className={`st-toast${toast ? " st-on" : ""}`} role="status" aria-hidden={toast ? undefined : true}>
          <b>{toast?.title}</b>
          <span>{toast?.sub}</span>
          {toast && toast.kind !== "error" ? (
            <button className="st-undo" type="button" onClick={() => void undo()}>
              Undo
            </button>
          ) : null}
          {toast ? <i key={toast.key} className="st-cd" /> : null}
        </div>
      </div>
      <div aria-live="polite" className="st-vh">
        {live}
      </div>
    </>
  );

  if (variant === "home") return <div>{body}</div>;

  return (
    <div className="st-picks">
      <div className="st-plist st-panel" aria-label="Today’s picks">
        {cards.map((c, n) => {
          const d = done[n];
          return (
            <button
              key={c.id}
              type="button"
              className={`st-prow${n === i && card ? " st-sel" : ""}${d ? " st-done" : ""}`}
              aria-current={n === i && card ? "true" : undefined}
              onClick={() => {
                if (d) return;
                setI(n);
                setOpen(false);
                deckEl.current?.focus({ preventScroll: true });
              }}
            >
              <span className="st-t">{c.role}</span>
              <span className="st-st">{d ? lbl[d] : c.pay.stated ? c.pay.headline : "Pay not stated"}</span>
              <span className="st-m">
                {c.company}
                {c.city ? `, ${c.city}` : ""}. {c.verdict}.
              </span>
            </button>
          );
        })}
      </div>
      <div className="st-pdeck">{body}</div>
      {card ? (
        <div className="st-panel st-pside">
          <div className="st-c-h" style={{ padding: "16px 16px 8px" }}>
            Your check for this role
          </div>
          <div className="st-checkp">
            {card.rules.length === 0 ? (
              <div className="st-vrow">
                <span>{card.verdict}</span>
              </div>
            ) : (
              card.rules.map((r) => (
                <div className="st-vrow" key={r.text}>
                  <span className={`st-glyph ${GLYPH[r.status].cls}`}>{GLYPH[r.status].mark}</span>
                  <span>
                    {r.text}
                    {r.note ? <small>{r.note}</small> : null}
                  </span>
                </div>
              ))
            )}
          </div>
          {card.answers || card.rounds ? (
            <div className="st-rows" style={{ borderTop: "1px solid var(--line)" }}>
              {card.answers ? (
                <div className="st-rowlink">
                  <div className="st-rl-main">
                    <div className="st-rl-t">
                      Answers ready: {card.answers.ready} of {card.answers.total}
                    </div>
                    <div className="st-rl-m">{card.answers.ask ? `Needs you: ${card.answers.ask}` : "Nothing needs you before you apply."}</div>
                  </div>
                  {card.answers.ask ? (
                    <Link className="st-btn st-sm" href="/you">
                      Answer
                    </Link>
                  ) : null}
                </div>
              ) : null}
              {card.rounds ? (
                <div className="st-rowlink">
                  <div className="st-rl-main">
                    <div className="st-rl-t">The rounds</div>
                    <div className="st-rl-m">{card.rounds}</div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The next card not yet decided, looking forward from `from` and then from the start; cards.length when none is left. */
function firstOpen(n: number, marks: Record<number, Kind>, from: number): number {
  for (let k = from + 1; k < n; k++) if (!marks[k]) return k;
  for (let k = 0; k < n; k++) if (!marks[k]) return k;
  return n;
}
