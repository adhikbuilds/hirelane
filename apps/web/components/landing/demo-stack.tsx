"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Check, MapPin, ShieldCheck, X } from "lucide-react";
import { CompanyLogo } from "../brand/CompanyLogo";
import { Button, Chip, MatchRing, UndoBar, cn } from "../ui";
import { matchFixture } from "./demo-model";
import type { DemoJob } from "./types";

type Phase = "idle" | "undo" | "handed";
type Exit = "pass" | "sent";

const QUICK_ANSWERS = ["Immediately", "30 days", "60 days"] as const;

/** Keystrokes aimed at a text field, slider or menu belong to that control, never to the demo. */
function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !("tagName" in el)) return false;
  if (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return true;
  const role = el.getAttribute("role");
  return role === "slider" || role === "combobox" || role === "radio" || role === "textbox";
}

function Kbd({ children, dark }: { children: string; dark?: boolean }) {
  return (
    <kbd className={cn("hidden rounded px-1.5 sm:inline-block text-[11px] font-bold leading-5", dark ? "bg-white/20" : "bg-ink/10")}>{children}</kbd>
  );
}

export function DemoStack({ jobs }: { jobs: DemoJob[] }) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [exit, setExit] = useState<Exit>("pass");
  const [notice, setNotice] = useState("");
  const [needsError, setNeedsError] = useState(false);
  const [done, setDone] = useState(0);
  const noticeRef = useRef<HTMLInputElement>(null);
  const noticeId = useId();
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matches = useMemo(() => jobs.map((j) => matchFixture(j.slug, j.skills, j.payMaxUsdMinor)), [jobs]);
  const job = jobs.length > 0 ? jobs[index % jobs.length]! : null;
  const match = jobs.length > 0 ? matches[index % jobs.length]! : null;

  useEffect(
    () => () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    },
    [],
  );

  const next = useCallback((how: Exit) => {
    setExit(how);
    setNotice("");
    setNeedsError(false);
    setPhase("idle");
    setIndex((i) => i + 1);
  }, []);

  const approve = useCallback(() => {
    if (phase !== "idle") return;
    if (notice.trim() === "") {
      setNeedsError(true);
      noticeRef.current?.focus();
      return;
    }
    setNeedsError(false);
    setPhase("undo");
  }, [phase, notice]);

  const pass = useCallback(() => {
    if (phase !== "idle") return;
    setDone((d) => d + 1);
    next("pass");
  }, [phase, next]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "a") {
        e.preventDefault();
        approve();
      } else if (k === "p") {
        e.preventDefault();
        pass();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [approve, pass]);

  const onSendComplete = useCallback(() => {
    setPhase("handed");
    setDone((d) => d + 1);
    advanceTimer.current = setTimeout(() => next("sent"), reduce ? 900 : 1700);
  }, [next, reduce]);

  if (!job || !match) {
    return (
      <div className="rounded-[16px] border border-line bg-surface p-8 text-center shadow-card">
        <p className="font-extrabold">The demo uses live jobs.</p>
        <p className="mt-1 text-[14px] text-ink-2">It appears after the next ingest run.</p>
      </div>
    );
  }

  const t = reduce ? { duration: 0 } : { type: "spring" as const, stiffness: 300, damping: 30 };
  const variants = {
    enter: { opacity: 0, y: 36, scale: 0.96 },
    center: { opacity: 1, y: 0, scale: 1, x: 0, rotate: 0 },
    leave: (how: Exit) =>
      how === "pass" ? { opacity: 0, x: -160, rotate: -7, transition: { duration: reduce ? 0 : 0.28 } } : { opacity: 0, y: -48, scale: 0.97, transition: { duration: reduce ? 0 : 0.3 } },
  };

  return (
    <section aria-label="Live demo: an application waiting for your approval" data-testid="demo" data-current-slug={job.slug} className="relative mx-auto w-full max-w-[560px]">
      <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[40px] bg-lane/10 blur-3xl" aria-hidden />
      <div className="mb-3 flex items-center justify-between gap-3">
        <span
          data-testid="demo-label"
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-signal/70 bg-signal-50 px-3 text-[13px] font-extrabold text-signal-ink"
        >
          <ShieldCheck aria-hidden className="size-4" />
          Demo: nothing is sent
        </span>
        <span className="text-[13px] font-semibold tabular-nums text-ink-3" aria-live="polite">
          {done} handled • card {(index % jobs.length) + 1} of {jobs.length}
        </span>
      </div>

      <div className="relative">
        <div aria-hidden className="absolute inset-x-5 -bottom-3 top-6 rounded-[16px] border border-line bg-surface/80 shadow-card" />
        <div aria-hidden className="absolute inset-x-2.5 -bottom-1.5 top-3 rounded-[16px] border border-line bg-surface/90 shadow-card" />
        <AnimatePresence mode="popLayout" custom={exit} initial={false}>
          <motion.article
            key={index}
            custom={exit}
            variants={variants}
            initial="enter"
            animate="center"
            exit="leave"
            transition={t}
            data-testid="demo-card"
            data-slug={job.slug}
            data-phase={phase}
            aria-label={`${job.title} at ${job.company}`}
            className="relative rounded-[16px] border border-line bg-surface p-5 shadow-pop sm:p-6"
          >
            <header className="flex items-start gap-3.5">
              <CompanyLogo name={job.company} src={job.logoPath} size={48} />
              <div className="min-w-0 flex-1">
                <h3 className="text-[19px] font-extrabold leading-tight tracking-tight text-ink [text-wrap:balance]">{job.title}</h3>
                <p className="mt-0.5 truncate text-[14px] font-semibold text-ink-2">{job.company}</p>
                <p className="mt-0.5 flex items-center gap-1 text-[13px] text-ink-3">
                  <MapPin aria-hidden className="size-3.5 shrink-0" />
                  <span className="truncate">{job.where}</span>
                </p>
              </div>
              <MatchRing score={match.score} size={64} strokeWidth={6} />
            </header>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Chip tone="lane" className="h-8 text-[14px]">
                {job.payAnnual}
              </Chip>
              {job.payStated && <span className="text-[13px] text-ink-3">stated as {job.payStated}</span>}
            </div>

            <p className="mt-4 text-[14px] font-bold text-ink" data-testid="demo-maths">
              {match.maths}
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Requirements">
              {match.chips.map((c) => (
                <li key={c.label}>
                  <Chip
                    tone={c.met ? "match" : "miss"}
                    icon={c.met ? <Check aria-hidden className="size-3.5" /> : <X aria-hidden className="size-3.5" />}
                    className="max-w-[210px]"
                  >
                    <span className="truncate">{c.label}</span>
                    <span className="sr-only">{c.met ? " matched" : " missing"}</span>
                  </Chip>
                </li>
              ))}
            </ul>

            <div
              data-testid="needs-you"
              className={cn(
                "mt-4 rounded-[12px] border border-l-4 border-line border-l-signal bg-signal-50/60 p-3.5 transition-shadow",
                needsError && "ring-2 ring-miss/50",
              )}
            >
              <label htmlFor={noticeId} className="flex items-center gap-2 text-[14px] font-extrabold">
                <span className="rounded bg-signal px-1.5 text-[11px] font-extrabold leading-5 text-ink">Needs you</span>
                Notice period?
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  id={noticeId}
                  ref={noticeRef}
                  value={notice}
                  onChange={(e) => {
                    setNotice(e.target.value);
                    if (e.target.value.trim()) setNeedsError(false);
                  }}
                  disabled={phase !== "idle"}
                  placeholder="For example, 30 days"
                  maxLength={40}
                  autoComplete="off"
                  aria-describedby={`${noticeId}-hint`}
                  aria-invalid={needsError || undefined}
                  className="h-10 min-w-0 flex-1 basis-40 rounded-[10px] border border-line bg-surface px-3 text-[15px] font-semibold shadow-control placeholder:font-normal placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-lane disabled:opacity-60"
                />
                {QUICK_ANSWERS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={phase !== "idle"}
                    onClick={() => {
                      setNotice(q);
                      setNeedsError(false);
                    }}
                    className="h-8 rounded-full border border-line bg-surface px-3 text-[13px] font-bold text-ink-2 transition-colors hover:border-lane/40 hover:bg-lane-50 hover:text-lane disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
              <p id={`${noticeId}-hint`} role={needsError ? "alert" : undefined} className={cn("mt-2 text-[13px]", needsError ? "font-bold text-[#b91c1c]" : "text-ink-2")}>
                {needsError ? "Answer this first. Hirelane does not guess it." : "Not in your resume, so Hirelane asks instead of guessing."}
              </p>
            </div>

            <AnimatePresence>
              {phase === "handed" && (
                <motion.div
                  key="handed"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: reduce ? 0 : 0.2 }}
                  role="status"
                  data-testid="demo-handed"
                  className="absolute inset-0 grid place-items-center rounded-[16px] bg-surface/95 p-6 text-center backdrop-blur-[2px]"
                >
                  <div>
                    <motion.span
                      initial={{ scale: reduce ? 1 : 0.4 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 380, damping: 18 }}
                      className="mx-auto grid size-14 place-items-center rounded-full bg-match text-white shadow-card"
                    >
                      <Check aria-hidden className="size-7" strokeWidth={3} />
                    </motion.span>
                    <p className="mt-3 text-[19px] font-extrabold tracking-tight">Handed off to {job.company}&apos;s site</p>
                    <p className="mt-1 text-[14px] text-ink-2">In the real product, your approved draft opens on their own form. Here, nothing was sent.</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.article>
        </AnimatePresence>
      </div>

      <div className="mt-5 min-h-[56px]" data-testid="demo-actions">
        {phase === "undo" ? (
          <UndoBar label={`Sending to ${job.company}`} onUndo={() => setPhase("idle")} onComplete={onSendComplete} />
        ) : (
          <div className="flex gap-3">
            <Button variant="secondary" size="lg" className="flex-1 px-3 sm:px-7" onClick={pass} disabled={phase !== "idle"} aria-keyshortcuts="P">
              <X aria-hidden className="size-5" />
              Pass
              <Kbd>P</Kbd>
            </Button>
            <Button size="lg" className="flex-[1.6] px-3 sm:px-7" onClick={approve} disabled={phase !== "idle"} aria-keyshortcuts="A">
              Approve &amp; send
              <ArrowRight aria-hidden className="size-5" />
              <Kbd dark>A</Kbd>
            </Button>
          </div>
        )}
      </div>
      <p className="mt-3 hidden text-center text-[13px] text-ink-3 sm:block">
        Keys: <Kbd>A</Kbd> approve • <Kbd>P</Kbd> pass • <Kbd>U</Kbd> undo. Fixture match, real job.
      </p>
    </section>
  );
}
