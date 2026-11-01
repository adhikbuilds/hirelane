"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { postJson, readSet, writeSet } from "@/lib/student/client";
import type { CardData } from "@/lib/student/types";
import { Ic } from "./Icon";
import { GLYPH, RoleCard } from "./RoleCard";

type Kind = "apply" | "skip" | "save";
const UNDO_MS = 4000;

interface ApplyOut {
  application: { id: string };
}

/**
 * Today's picks as a scrollable feed of cards. Each card has its own Skip, Save and Apply buttons; deciding one collapses it
 * to a one-line row with Undo. Apply creates a real application with a 4 second undo window when the card has a job and the
 * pilot is on; after the window the row offers the receipt. On the picks page a desktop side panel shows the rule maths for
 * the selected card. Every control is a button, and one polite live region announces each action.
 */
export function Feed({
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
  /** True when Apply really creates an application. False for the sample and before the pilot, where it only marks the card ready. */
  network: boolean;
}) {
  const [done, setDone] = useState<Record<string, Kind>>({});
  const [sent, setSent] = useState<Record<string, true>>({});
  const [appIds, setAppIds] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [selId, setSelId] = useState<string | null>(null);
  const [live, setLive] = useState("");
  const [problem, setProblem] = useState<{ title: string; sub: string } | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pending = useRef<Record<string, Promise<string | null>>>({});
  const doneRef = useRef(done);
  doneRef.current = done;

  const label = { apply: autoApply ? "Applied" : "Ready", skip: "Skipped", save: "Saved" } as const;

  // What this student already skipped today stays skipped after a reload; no service stores it, so it lives on this device.
  useEffect(() => {
    const skipped = readSet("skipped");
    if (skipped.size === 0) return;
    const marks: Record<string, Kind> = {};
    for (const c of cards) if (skipped.has(c.id)) marks[c.id] = "skip";
    if (Object.keys(marks).length > 0) setDone((d) => ({ ...marks, ...d }));
  }, [cards]);

  useEffect(() => {
    const t = timers.current;
    return () => Object.values(t).forEach(clearTimeout);
  }, []);

  const firstOpen = cards.find((c) => !done[c.id]);
  const sel = cards.find((c) => c.id === selId && !done[c.id]) ?? firstOpen ?? cards[0];
  const left = cards.filter((c) => !done[c.id]).length;

  const decide = useCallback(
    (card: CardData, kind: Kind) => {
      setProblem(null);
      setDone((d) => ({ ...d, [card.id]: kind }));
      setLive(`${label[kind]}: ${card.role} at ${card.company}.${kind === "apply" && autoApply ? " Undo is available for 4 seconds." : " Undo is available."}`);
      if (kind === "skip") writeSet("skipped", new Set([...readSet("skipped"), card.id]));
      if (kind === "save") writeSet("saved", new Set([...readSet("saved"), card.id]));
      if (kind !== "apply" || !autoApply) return;

      timers.current[card.id] = setTimeout(() => setSent((s) => (doneRef.current[card.id] === "apply" ? { ...s, [card.id]: true } : s)), UNDO_MS);
      if (card.jobId && network) {
        const p = postJson<ApplyOut>("/api/v1/apply/swipe", { jobId: card.jobId }).then((r) => {
          if (r.ok && r.data) {
            setAppIds((m) => ({ ...m, [card.id]: r.data!.application.id }));
            return r.data.application.id;
          }
          // Put the card back and say why, in plain words. Nothing was queued.
          clearTimeout(timers.current[card.id]);
          setDone((d) => {
            const { [card.id]: _gone, ...rest } = d;
            return rest;
          });
          setProblem({ title: "That one didn’t go through", sub: r.error === "auto_apply_off" ? "Applying from Hirelane isn’t switched on yet." : "Nothing was sent. Try it again in a moment." });
          setLive("That one didn’t go through. Nothing was sent.");
          return null;
        });
        pending.current[card.id] = p;
      }
    },
    // `label` only depends on autoApply
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [autoApply, network],
  );

  const undo = async (card: CardData) => {
    const kind = done[card.id];
    if (!kind) return;
    clearTimeout(timers.current[card.id]);
    if (kind === "apply" && network && card.jobId) {
      const id = appIds[card.id] ?? (await pending.current[card.id]);
      if (id) {
        const r = await postJson(`/api/v1/apply/applications/${id}/undo`);
        if (!r.ok) {
          setSent((s) => ({ ...s, [card.id]: true }));
          setProblem({ title: "Too late to take that back", sub: "It has already gone. You can follow it in Tracker." });
          setLive("Too late to take that back. It has already gone.");
          return;
        }
      }
    }
    const sk = readSet("skipped");
    sk.delete(card.id);
    writeSet("skipped", sk);
    const sv = readSet("saved");
    sv.delete(card.id);
    writeSet("saved", sv);
    setProblem(null);
    setDone((d) => {
      const { [card.id]: _gone, ...rest } = d;
      return rest;
    });
    setSent((s) => {
      const { [card.id]: _gone, ...rest } = s;
      return rest;
    });
    setSelId(card.id);
    setLive(`Undone: ${card.role} at ${card.company} is back.`);
  };

  const list = (
    <>
      <div className="st-sec-h">
        <h2 className={variant === "picks" ? "st-small" : undefined} style={variant === "picks" ? { fontSize: 13 } : undefined}>
          {variant === "picks" ? "Roles you qualify for, today" : "Today’s picks"}
        </h2>
        <span className="st-small st-num">{left} left</span>
      </div>
      {cards.length === 0 || left === 0 ? (
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
      ) : null}
      {cards.length > 0 ? (
        <div className="st-feed-list">
          {cards.map((c) => {
            const kind = done[c.id];
            if (kind) {
              const receipt = kind === "apply" && autoApply && sent[c.id];
              return (
                <div className="st-fdone" key={c.id} data-card={c.id}>
                  <span>
                    <b>{label[kind]}:</b> {c.role}, {c.company}
                  </span>
                  <span className="st-fdone-tail">
                    {receipt ? (
                      <Link className="st-btn st-sm" href={appIds[c.id] ? `/tracker/${appIds[c.id]}` : "/tracker"}>
                        See receipt
                      </Link>
                    ) : (
                      <>
                        {kind === "apply" && autoApply ? <span className="st-ink2">Sends in 4 seconds</span> : null}
                        <button className="st-btn st-sm" type="button" onClick={() => void undo(c)}>
                          Undo
                        </button>
                      </>
                    )}
                  </span>
                </div>
              );
            }
            const who = `${c.role} at ${c.company}`;
            return (
              <div
                key={c.id}
                className={`st-fitem${sel?.id === c.id ? " st-sel" : ""}`}
                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest("a")) setSelId(c.id);
                }}
                onFocus={() => setSelId(c.id)}
              >
                <RoleCard card={c} open={open[c.id] === true} onToggle={() => setOpen((o) => ({ ...o, [c.id]: !o[c.id] }))} />
                <div className="st-fact">
                  <button className="st-btn" type="button" aria-label={`Skip ${who}`} onClick={() => decide(c, "skip")}>
                    <Ic name="x" small />
                    Skip
                  </button>
                  <button className="st-btn" type="button" aria-label={`Save ${who}`} onClick={() => decide(c, "save")}>
                    <Ic name="plus" small />
                    Save
                  </button>
                  <button className="st-btn st-p" type="button" aria-label={`${autoApply ? "Apply to" : "Get it ready:"} ${who}`} onClick={() => decide(c, "apply")}>
                    <Ic name="check" small />
                    {autoApply ? "Apply" : "Get it ready"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      {problem ? (
        <p className="st-feed-problem" role="alert">
          <b>{problem.title}</b> {problem.sub}
        </p>
      ) : null}
      {address ? (
        <p className="st-mode">
          {autoApply ? "Applies from" : "Ready from"} <span className="st-mono">{address}</span>
        </p>
      ) : null}
      <div aria-live="polite" className="st-vh">
        {live}
      </div>
    </>
  );

  if (variant === "home") return <div>{list}</div>;

  return (
    <div className="st-picks">
      <div className="st-pfeed">{list}</div>
      {sel ? (
        <div className="st-panel st-pside">
          <div className="st-c-h" style={{ padding: "16px 16px 8px" }}>
            Your check for this role
          </div>
          <div className="st-checkp">
            {sel.rules.length === 0 ? (
              <div className="st-vrow">
                <span>{sel.verdict}</span>
              </div>
            ) : (
              sel.rules.map((r) => (
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
          {sel.answers || sel.rounds ? (
            <div className="st-rows" style={{ borderTop: "1px solid var(--line)" }}>
              {sel.answers ? (
                <div className="st-rowlink">
                  <div className="st-rl-main">
                    <div className="st-rl-t">
                      Answers ready: {sel.answers.ready} of {sel.answers.total}
                    </div>
                    <div className="st-rl-m">{sel.answers.ask ? `Needs you: ${sel.answers.ask}` : "Nothing needs you before you apply."}</div>
                  </div>
                  {sel.answers.ask ? (
                    <Link className="st-btn st-sm" href="/you">
                      Answer
                    </Link>
                  ) : null}
                </div>
              ) : null}
              {sel.rounds ? (
                <div className="st-rowlink">
                  <div className="st-rl-main">
                    <div className="st-rl-t">The rounds</div>
                    <div className="st-rl-m">{sel.rounds}</div>
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
