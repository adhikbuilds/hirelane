"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { Check, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { CardDetails } from "../card/details";
import type { V4Card } from "../card/model";
import { SwipeDeck, type SwipeDeckHandle } from "../card/swipe-deck";
import { useDeckQueue } from "../card/use-deck-queue";
import type { Decision } from "../../landing-v3/stack/physics";
import { ASHA } from "../workflow/asha";
import { PhoneFrame } from "./frame";
import { ReadySheet } from "./ready-sheet";
import { PhoneSheet } from "./sheet";
import { PhoneToast, TOAST_MS } from "./toast";

export type PhoneEvent =
  | { type: "open-ready"; card: V4Card }
  | { type: "send"; card: V4Card; n: number }
  | { type: "pass"; card: V4Card }
  | { type: "undo"; kind: Decision; card: V4Card }
  | { type: "cancel"; card: V4Card };

type Sheet = { kind: "ready" | "details"; slug: string } | null;
type ToastState = { id: number; kind: Decision; card: V4Card; n: number } | null;

/**
 * The hero's mini app. The loop: swipe or tap, approve opens "Ready to send" inside the phone, Send hands off (to
 * nothing: the demo has no network code), a dark toast drains for 4 s with Undo, the next card slides up.
 */
export function Phone({ cards, onEvent }: { cards: V4Card[]; onEvent?: (e: PhoneEvent) => void }) {
  const ev = useRef(onEvent);
  ev.current = onEvent;
  const q = useDeckQueue(cards, { onUndo: (kind, card) => ev.current?.({ type: "undo", kind, card }) });
  const [sheet, setSheet] = useState<Sheet>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<ToastState>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deckRef = useRef<SwipeDeckHandle>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const [live, setLive] = useState("");

  const top = q.remaining[0] ?? null;

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const showToast = useCallback((kind: Decision, card: V4Card, n: number) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast((t) => ({ id: (t?.id ?? 0) + 1, kind, card, n }));
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const closeSheet = useCallback((cancelled = false) => {
    setSheet(null);
    if (cancelled && top) ev.current?.({ type: "cancel", card: top });
    window.setTimeout(() => (returnTo.current?.isConnected ? returnTo.current : null)?.focus({ preventScroll: true }), 0);
  }, [top]);

  const openSheet = useCallback((kind: "ready" | "details", card: V4Card) => {
    returnTo.current = document.activeElement as HTMLElement | null;
    setSheet({ kind, slug: card.slug });
    if (kind === "ready") ev.current?.({ type: "open-ready", card });
    setLive(kind === "ready" ? `Ready to send to ${card.company}.` : `Details for ${card.title}.`);
  }, []);

  const pass = useCallback(
    (vx = 0) => {
      const card = q.commit("pass", vx);
      if (!card) return;
      showToast("pass", card, 0);
      setLive(`Passed ${card.title} at ${card.company}. Press U to undo.`);
      ev.current?.({ type: "pass", card });
    },
    [q, showToast],
  );

  const send = useCallback(() => {
    const card = top;
    if (!card) return;
    q.commit("approve");
    const n = q.tally.approved + 1;
    setSheet(null);
    showToast("approve", card, n);
    setLive(`Handed off to ${card.company}. Number ${n} in this demo. Press U to undo.`);
    ev.current?.({ type: "send", card, n });
    deckRef.current?.focus();
  }, [q, showToast, top]);

  const onRequest = useCallback(
    (kind: Decision, card: V4Card, vx: number): boolean => {
      if (kind === "pass") {
        pass(vx);
        return true;
      }
      openSheet("ready", card);
      return false;
    },
    [pass, openSheet],
  );

  const undo = useCallback(() => {
    if (!q.undoable) return;
    q.undo();
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
    setLive("Undone.");
  }, [q]);

  const sheetCard = sheet ? cards.find((c) => c.slug === sheet.slug) ?? null : null;
  const inQueue = q.remaining.length;

  return (
    <PhoneFrame label="Hirelane demo phone: sample jobs matched to a sample profile">
      <div className="flex items-end justify-between px-5 pt-3 pb-2">
        <h2 className="text-[20px] leading-6 font-extrabold tracking-[-0.02em]">Jobs</h2>
        <p data-testid="queue-count" className="rounded-full bg-[#13201A] px-3 py-1 text-[12px] leading-4 font-bold text-white tabular-nums">
          {inQueue} in queue
        </p>
      </div>
      <p className="px-5 pb-2 text-[12px] leading-4 text-[#55625B]">
        For {ASHA.name}, {ASHA.city} <span className="font-semibold">· {ASHA.label}</span>
      </p>

      <div className="min-h-0 flex-1 px-3" inert={sheet !== null}>
        <SwipeDeck
          ref={deckRef}
          cards={q.remaining}
          exit={q.exit}
          entry={q.entry}
          onRequest={onRequest}
          onUndo={undo}
          onOpen={(c) => openSheet("details", c)}
          active={sheet === null}
          label="Jobs in the demo phone"
          testId="phone-deck"
          emptyState={
            <div data-testid="phone-end" className="grid min-h-[300px] place-content-center gap-4 rounded-[20px] bg-white p-6 text-center shadow-[0_10px_22px_-10px_rgb(19_32_26/0.28)]">
              <p className="text-[18px] leading-6 font-extrabold">That was the queue.</p>
              <p className="text-[14px] leading-5 text-[#55625B]">
                {q.tally.approved} handed off, {q.tally.passed} passed.
              </p>
              <button type="button" onClick={q.restart} className="mx-auto inline-flex h-11 items-center gap-1.5 rounded-xl px-3 text-[14px] font-bold text-[#0F5C45] hover:bg-[#EAF3EC] focus-visible:outline-2 focus-visible:outline-[#0F5C45]">
                <RotateCcw aria-hidden className="size-4" />
                Start over
              </button>
              <Link href="/jobs" className="mx-auto inline-flex h-11 items-center rounded-xl px-3 text-[14px] font-bold text-[#13201A] underline underline-offset-4">
                Browse jobs
              </Link>
            </div>
          }
        />
      </div>

      <div className="flex shrink-0 flex-col gap-3 px-4 pt-1 pb-4" inert={sheet !== null}>
        <div className="flex items-center justify-center gap-7">
          <button
            type="button"
            aria-label="Pass"
            disabled={!top}
            onClick={() => top && onRequest("pass", top, 0)}
            className="grid size-14 place-items-center rounded-full bg-white text-[#E5484D] shadow-[0_6px_16px_-6px_rgb(19_32_26/0.35),inset_0_0_0_1.5px_rgb(229_72_77/0.5)] transition-transform hover:scale-105 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#0F5C45] disabled:opacity-40"
          >
            <X aria-hidden className="size-6" strokeWidth={3} />
          </button>
          <button
            type="button"
            aria-label="Approve"
            disabled={!top}
            onClick={() => top && onRequest("approve", top, 0)}
            className="grid size-16 place-items-center rounded-full bg-[#0F5C45] text-white shadow-[0_10px_22px_-6px_rgb(15_92_69/0.6)] transition-transform hover:scale-105 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#0F5C45] disabled:opacity-40"
          >
            <Check aria-hidden className="size-7" strokeWidth={3} />
          </button>
        </div>
        <div className="h-14">
          <AnimatePresence mode="wait">
            {toast && (
              <PhoneToast
                key={toast.id}
                id={toast.id}
                line={toast.kind === "approve" ? `Handed off to ${toast.card.company}` : `Passed ${toast.card.company}`}
                sub={toast.kind === "approve" ? `#${toast.n} in this demo · nothing was sent` : "Back in your list if you undo"}
                onUndo={undo}
              />
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {sheet?.kind === "ready" && sheetCard && (
          <ReadySheet
            key="ready"
            card={sheetCard}
            answer={answers[sheetCard.slug] ?? ""}
            onAnswer={(v) => setAnswers((a) => ({ ...a, [sheetCard.slug]: v }))}
            onSend={send}
            onClose={() => closeSheet(true)}
          />
        )}
        {sheet?.kind === "details" && sheetCard && (
          <PhoneSheet key="details" testId="details-sheet" title={sheetCard.title} subtitle={sheetCard.company} onClose={() => closeSheet()}>
            <CardDetails
              card={sheetCard}
              onPass={() => {
                setSheet(null);
                pass();
              }}
              onApprove={() => setSheet({ kind: "ready", slug: sheetCard.slug })}
            />
          </PhoneSheet>
        )}
      </AnimatePresence>

      <div role="status" aria-live="polite" data-testid="phone-live" className="sr-only">
        {live}
      </div>
    </PhoneFrame>
  );
}
