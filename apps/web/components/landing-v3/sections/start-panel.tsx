"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, FileText, Lock, RotateCcw, UploadCloud } from "lucide-react";
import { REJECTION_TEXT, validatePdf, type DropRejection } from "../../ui/DropZone";
import { PARSE_FIXTURE, PARSE_STEPS } from "../../landing/resume-drop";
import { Button } from "@/components/shadcn/button";
import { cn } from "@/lib/utils";
import { PANEL, PhotoBackdrop, Rise } from "./panel";
import { WaitlistForm } from "./waitlist-form";

type Stage = "idle" | "parsing" | "done";

/**
 * The resume never leaves the browser: this component has no network code, and the file is read for its first five
 * bytes only (the "%PDF-" header). The card it fills is sample output, labelled as such.
 */
export function StartPanelView({ photoSrc = "/landing/road-1800.jpg" }: { photoSrc?: string }) {
  const reduce = useReducedMotion();
  const [stage, setStage] = useState<Stage>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<DropRejection | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const depth = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  const run = (file: File) => {
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

  const take = async (files: FileList | File[] | null | undefined) => {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;
    if (list.length > 1) return setError("multiple");
    const bad = await validatePdf(list[0]!);
    if (bad) return setError(bad);
    setError(null);
    run(list[0]!);
  };

  const reset = () => {
    if (timer.current) clearInterval(timer.current);
    setStage("idle");
    setStep(0);
    setFileName(null);
    setError(null);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    void take(e.dataTransfer?.files);
  };

  const shown = (i: number) => step > i;
  const pct = Math.min(100, (step / PARSE_STEPS) * 100);

  return (
    <section id="start" aria-labelledby="start-h" className="relative isolate flex min-h-[100svh] scroll-mt-0 flex-col items-center justify-center gap-10 px-4 py-24 sm:px-8">
      <PhotoBackdrop src={photoSrc} scrim={0.55} />
      <Rise>
        <h2 id="start-h" className="t-heading text-center">Start with your resume.</h2>
      </Rise>

      <Rise index={1} className="w-full max-w-[560px]">
        <div role="group" aria-label="Resume" data-stage={stage} data-testid="start-dialog" className={cn(PANEL, "p-6 sm:p-8")}>
          <div className="mb-5 flex items-center gap-2 text-muted-foreground">
            <Lock aria-hidden className="size-4" />
            <span className="t-small font-bold">Stays in this browser</span>
          </div>

          {stage === "idle" ? (
            <div>
              <button
                type="button"
                data-testid="drop-zone"
                onClick={() => input.current?.click()}
                onDragEnter={(e) => {
                  e.preventDefault();
                  depth.current += 1;
                  setOver(true);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDragLeave={() => {
                  depth.current = Math.max(0, depth.current - 1);
                  if (depth.current === 0) setOver(false);
                }}
                onDrop={onDrop}
                aria-describedby={error ? "start-error" : undefined}
                className={cn(
                  "group flex min-h-[220px] w-full cursor-pointer flex-col items-center justify-center gap-4 rounded-[20px] border-2 border-dashed px-6 text-center outline-none",
                  "transition-[background-color,border-color,transform] duration-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring active:scale-[0.99]",
                  over ? "scale-[1.01] border-primary bg-primary/10" : "border-white/25 bg-black/20 hover:border-primary/70 hover:bg-black/30",
                  error && !over && "border-destructive",
                )}
              >
                <span aria-hidden className="grid size-14 place-items-center rounded-full bg-primary/15 text-primary transition-transform duration-200 group-hover:-translate-y-1">
                  <UploadCloud className="size-7" />
                </span>
                <span className="t-statement font-bold">Drop your PDF</span>
                <span className="t-small text-muted-foreground">or choose a file</span>
              </button>
              <input
                ref={input}
                type="file"
                accept="application/pdf,.pdf"
                tabIndex={-1}
                aria-label="Resume PDF"
                className="sr-only"
                onChange={(e) => {
                  void take(e.target.files);
                  e.target.value = "";
                }}
              />
              <p id="start-error" role="alert" className={cn("t-small mt-3 font-bold text-foreground", !error && "sr-only")}>
                {error ? REJECTION_TEXT[error] : ""}
              </p>
            </div>
          ) : (
            <div data-testid="resume-parse" data-ui>
              <div className="flex items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-primary/15 text-primary">
                  {stage === "done" ? <Check aria-hidden className="size-5" /> : <FileText aria-hidden className="size-5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{fileName}</p>
                  <p className="t-small text-muted-foreground">Sample preview. Your file stays on your device and isn&apos;t read.</p>
                </div>
              </div>
              <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
                <motion.div
                  className="h-full origin-left rounded-full bg-primary"
                  initial={false}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: reduce ? 0 : 0.35, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>

              <div className="mt-6 rounded-[20px] bg-black/25 p-5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]">
                <div className="min-h-[56px]">
                  <AnimatePresence>
                    {shown(0) && (
                      <motion.div initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                        <p className="t-statement font-extrabold">
                          <span className="t-small mr-2 rounded-full bg-white/15 px-2 py-0.5 align-middle font-bold uppercase tracking-wide">Sample</span>
                          {PARSE_FIXTURE.name}
                        </p>
                        <p className="t-small text-muted-foreground">{PARSE_FIXTURE.headline}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <div className="mt-4 flex min-h-[32px] flex-wrap gap-2" aria-label="Roles">
                  {shown(1) &&
                    PARSE_FIXTURE.roles.map((r) => (
                      <motion.span key={r} initial={reduce ? false : { opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="t-small rounded-full bg-primary px-3 py-1 font-bold text-primary-foreground">
                        {r}
                      </motion.span>
                    ))}
                </div>
                <ul className="mt-3 flex min-h-[72px] flex-wrap content-start gap-2" data-testid="parse-skills" aria-label="Skills">
                  {PARSE_FIXTURE.skills.map((s, i) =>
                    shown(2 + i) ? (
                      <motion.li
                        key={s}
                        initial={reduce ? false : { opacity: 0, scale: 0.85, y: 6 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        transition={{ type: "spring", stiffness: 420, damping: 26 }}
                        className="t-small rounded-full bg-white/10 px-3 py-1 font-semibold shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)]"
                      >
                        {s}
                      </motion.li>
                    ) : null,
                  )}
                </ul>
              </div>

              <AnimatePresence>
                {stage === "done" && (
                  <motion.div
                    initial={reduce ? false : { opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    className="mt-6"
                  >
                    <p className="t-body font-bold">Accounts open soon. Join early access and we&apos;ll email you once, when they do.</p>
                    <div className="mt-4">
                      <WaitlistForm source="landing" />
                    </div>
                    <Button variant="ghost" size="lg" onClick={reset} className="mt-3 active:scale-95">
                      <RotateCcw aria-hidden /> Try another PDF
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </Rise>
    </section>
  );
}
