"use client";

import { useId, useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/shadcn/button";
import { cn } from "@/lib/utils";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "done" } | { kind: "error"; message: string };

const YEARS = [2025, 2026, 2027, 2028, 2029];

/** Early-access sign-up. Posts an email, an optional graduation year and explicit consent; nothing else. */
export function WaitlistForm({ source = "landing" }: { source?: "landing" | "pricing" | "jobs" }) {
  const id = useId();
  const [state, setState] = useState<State>({ kind: "idle" });

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("consent") !== "on") {
      setState({ kind: "error", message: "Tick the box so we can email you." });
      return;
    }
    const year = f.get("gradYear");
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: f.get("email"), gradYear: year ? Number(year) : null, source, consent: true }),
      });
      if (res.ok) return setState({ kind: "done" });
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setState({ kind: "error", message: body?.error?.message ?? "Could not save, try again." });
    } catch {
      setState({ kind: "error", message: "You look offline. Try again." });
    }
  }

  if (state.kind === "done") {
    return (
      <p role="status" data-testid="waitlist-done" className="t-body flex items-center gap-2 font-bold">
        <Check aria-hidden className="size-5 text-primary" /> You&apos;re on the list. We&apos;ll email you when early access opens.
      </p>
    );
  }

  const field = "h-12 rounded-full bg-white/10 px-4 text-white placeholder:text-white/50 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.15)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary";
  return (
    <form onSubmit={submit} noValidate data-testid="waitlist-form" className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor={`${id}-email`} className="sr-only">Email</label>
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          placeholder="you@college.edu"
          className={cn(field, "min-w-0 flex-1")}
        />
        <label htmlFor={`${id}-year`} className="sr-only">Graduation year (optional)</label>
        <select id={`${id}-year`} name="gradYear" defaultValue="" className={cn(field, "sm:w-40")}>
          <option value="">Grad year</option>
          {YEARS.map((y) => (
            <option key={y} value={y} className="text-black">{y}</option>
          ))}
        </select>
      </div>
      <label className="t-small flex items-start gap-2 text-white/80">
        <input name="consent" type="checkbox" className="mt-0.5 size-4" />
        <span>Email me when early access opens. Only that. Reply to any email to be removed.</span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={state.kind === "sending"} className="active:scale-95">
          {state.kind === "sending" ? "Joining…" : "Get early access"}
        </Button>
        <p role="alert" className={cn("t-small font-bold", state.kind !== "error" && "sr-only")}>
          {state.kind === "error" ? state.message : ""}
        </p>
      </div>
    </form>
  );
}
