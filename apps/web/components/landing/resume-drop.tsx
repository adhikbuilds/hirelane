"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, FileText, Lock, RotateCcw } from "lucide-react";
import { Button, Chip, DropZone, cn } from "../ui";

/** Fixture output. The file is never read: this is what a parse will look like once accounts arrive (Phase 4). */
export const PARSE_FIXTURE = {
  name: "Asha Verma",
  headline: "Data engineer, 4 years",
  roles: ["Data engineer", "Analytics engineer"],
  skills: ["Python", "PostgreSQL", "Kafka", "Airflow", "dbt", "AWS"],
} as const;

type Stage = "idle" | "parsing" | "done";

/** Steps of the fake parse: 0 name, 1 roles, 2..7 one skill chip each, 8 done. */
export const PARSE_STEPS = 2 + PARSE_FIXTURE.skills.length;

export function ResumeDrop({ compact = false, className }: { compact?: boolean; className?: string }) {
  const reduce = useReducedMotion();
  const [stage, setStage] = useState<Stage>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  const start = (file: File) => {
    if (timer.current) clearInterval(timer.current);
    setFileName(file.name);
    if (reduce) {
      setStep(PARSE_STEPS);
      setStage("done");
      return;
    }
    setStep(0);
    setStage("parsing");
    let n = 0;
    timer.current = setInterval(() => {
      n += 1;
      setStep(n);
      if (n >= PARSE_STEPS) {
        if (timer.current) clearInterval(timer.current);
        setStage("done");
      }
    }, 420);
  };

  const reset = () => {
    if (timer.current) clearInterval(timer.current);
    setStage("idle");
    setStep(0);
    setFileName(null);
  };

  if (stage === "idle") {
    return (
      <DropZone
        className={className}
        compact={compact}
        onFile={start}
        title={compact ? "Drop your resume to try it" : "Drop your resume here"}
        hint="or click to choose a PDF. It stays in your browser: nothing is uploaded."
      />
    );
  }

  const shown = (i: number) => step > i;
  return (
    <div
      data-testid="resume-parse"
      data-stage={stage}
      className={cn("rounded-[16px] border border-line bg-surface p-5 shadow-card", className)}
    >
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-lane-50 text-lane">
          <FileText aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-extrabold tracking-tight">{fileName}</p>
          <p className="text-[13px] text-ink-3">{stage === "parsing" ? "Reading a sample resume..." : "Sample output. Your file was not read or uploaded."}</p>
        </div>
        <Chip tone={stage === "parsing" ? "signal" : "match"} icon={stage === "done" ? <Check aria-hidden className="size-3.5" /> : undefined}>
          {stage === "parsing" ? "Parsing" : "Parsed"}
        </Chip>
      </div>

      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
        <motion.div
          className="h-full rounded-full bg-lane"
          initial={false}
          animate={{ width: `${Math.min(100, (step / PARSE_STEPS) * 100)}%` }}
          transition={{ duration: reduce ? 0 : 0.35, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>

      <dl className="mt-4 grid gap-3 text-[14px]">
        <div className="grid min-h-6 grid-cols-[72px_1fr] items-baseline gap-3">
          <dt className="font-bold text-ink-3">Name</dt>
          <dd>
            <AnimatePresence>
              {shown(0) && (
                <motion.span initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="font-extrabold">
                  {PARSE_FIXTURE.name} <span className="font-medium text-ink-2">• {PARSE_FIXTURE.headline}</span>
                </motion.span>
              )}
            </AnimatePresence>
          </dd>
        </div>
        <div className="grid min-h-7 grid-cols-[72px_1fr] items-baseline gap-3">
          <dt className="font-bold text-ink-3">Roles</dt>
          <dd className="flex flex-wrap gap-1.5">
            {shown(1) &&
              PARSE_FIXTURE.roles.map((r) => (
                <motion.span key={r} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
                  <Chip tone="lane">{r}</Chip>
                </motion.span>
              ))}
          </dd>
        </div>
        <div className="grid min-h-16 grid-cols-[72px_1fr] items-baseline gap-3">
          <dt className="font-bold text-ink-3">Skills</dt>
          <dd className="flex flex-wrap gap-1.5" data-testid="parse-skills">
            {PARSE_FIXTURE.skills.map((s, i) =>
              shown(2 + i) ? (
                <motion.span key={s} initial={{ opacity: 0, scale: 0.85, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 420, damping: 26 }}>
                  <Chip>{s}</Chip>
                </motion.span>
              ) : null,
            )}
          </dd>
        </div>
      </dl>

      <AnimatePresence>
        {stage === "done" && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduce ? 0 : 0.35 }}
            className="mt-4 rounded-[12px] border border-signal/60 bg-signal-50 p-4"
          >
            <p className="flex items-start gap-2 text-[15px] font-bold text-signal-ink">
              <Lock aria-hidden className="mt-1 size-4 shrink-0" />
              <span>Create your account to save this. Coming in the next release.</span>
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button disabled size="md">
                Create your account
              </Button>
              <Button variant="ghost" size="md" onClick={reset} icon={<RotateCcw aria-hidden className="size-4" />}>
                Try another PDF
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
